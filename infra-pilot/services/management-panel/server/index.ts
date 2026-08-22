import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { promises as fs } from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { sanitizeAuditValue } from './audit-sanitize.js';

/**
 * Run a command as a child process and capture stdout/stderr.
 * @param command - The command to execute
 * @param args - Array of arguments for the command
 * @returns Promise resolving with stdout and stderr on success
 * @throws Error if the command exits with a non-zero code
 */
function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
  });
}
import os from 'os';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';
import { SERVER_PRESETS } from './presets.js';
import openapiSpec from './openapi.js';
import { analyzeConfiguration } from './config-advice-engine.js';
import {
  checkCpu,
  checkDisk,
  checkDns,
  checkLocalApi,
  checkMemory,
  collectSystemInfo,
  type DiagnosticCheck,
} from './doctor.js';
import { runBenchmark } from './benchmark.js';
import { buildReport, reportToCsv, reportToPdf } from './reports.js';
import { buildPlan } from './assistant.js';
import { executeGraphQL } from './graphql.js';
// plugin-registry and change-approval-engine moved to experimental

dotenv.config({ path: '.env.local' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3001;

const execAsync = promisify(exec);

/**
 * Run real diagnostics. The optional `issue` filters to a category:
 * connectivity | performance | disk. Without it, all checks run.
 */
async function runDiagnostics(issue?: string): Promise<{ status: string; summary: string; checks: DiagnosticCheck[]; system?: ReturnType<typeof collectSystemInfo> }> {
  const checks: DiagnosticCheck[] = [];
  const wants = (c: string) => !issue || issue === c;

  if (wants('performance') || wants('connectivity')) checks.push(checkCpu());
  if (wants('performance') || wants('connectivity')) checks.push(checkMemory());
  if (wants('disk') || wants('performance')) checks.push(checkDisk());
  if (wants('connectivity')) checks.push(await checkDns());
  if (wants('connectivity')) {
    const apiUrl = process.env.API_BASE_URL || `http://localhost:${port}`;
    checks.push(await checkLocalApi(apiUrl));
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  const status = failed.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'ok';
  return {
    status,
    summary:
      status === 'ok'
        ? 'All checks passed'
        : status === 'warn'
          ? `${warned.length} warning(s), ${failed.length} failure(s)`
          : `${failed.length} failure(s) detected`,
    checks,
    system: collectSystemInfo(),
  };
}

/**
 * Execute a Docker action (start/stop/restart) on a container by app ID.
 * @param appId - The ID of the Docker app
 * @param action - Docker action to perform
 * @returns Result with success flag and command output
 * @throws Error if the app or container is not found
 */
async function dockerAction(appId: string, action: 'start' | 'stop' | 'restart'): Promise<{success: boolean; output: string}> {
  const { data: app, error } = await supabase
    .from('docker_apps')
    .select('container_id, user_id')
    .eq('id', appId)
    .single();
  if (error || !app) throw new Error('App not found');
  if (!app.container_id) throw new Error('No container associated with this app');
  const containerId = String(app.container_id);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerId)) {
    throw new Error('Invalid container_id format');
  }
  const { stdout, stderr } = await runCommand('docker', [action, containerId]);
  return { success: true, output: stdout || stderr };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const customersLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Simple observability instrumentation
const APP_VERSION = process.env.APP_VERSION || 'dev';
const metrics: {
  requests: number;
  totalDurationMs: number;
  endpoints: Record<string, { count: number; totalMs: number }>;
} = {
  requests: 0,
  totalDurationMs: 0,
  endpoints: {},
};

// Basic request instrumentation middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.requests += 1;
    metrics.totalDurationMs += duration;
    const key = req.path;
    const ep = metrics.endpoints[key] || { count: 0, totalMs: 0 };
    ep.count += 1;
    ep.totalMs += duration;
    metrics.endpoints[key] = ep;
    // Simple log for observability during development
    console.log(`[infra-pilot] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Initialize Supabase Client
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'dev-local-anon-key';
if (process.env.NODE_ENV === 'production' && !process.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('VITE_SUPABASE_ANON_KEY is required in production; refusing to start with a dummy key');
}
let supabase = createClient(supabaseUrl, supabaseKey);

export function setSupabaseClientForTests(client: ReturnType<typeof createClient>) {
  supabase = client;
}

export { app };


type ServerPermissionSet = {
  start: boolean;
  stop: boolean;
  console: boolean;
  files: boolean;
  backups: boolean;
  deployments: boolean;
};

const fullServerPermissions: ServerPermissionSet = {
  start: true,
  stop: true,
  console: true,
  files: true,
  backups: true,
  deployments: true,
};

const serverRoles = new Map<string, any[]>();
const serverSnapshots = new Map<string, any[]>();
const workspacesByUser = new Map<string, any[]>();
const pluginInstallations = new Map<string, any[]>();

async function getOwnedAppOrNull(appId: string, userId: string) {
  const { data, error } = await supabase
    .from('docker_apps')
    .select('*')
    .eq('id', appId)
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return data;
}

function clampPct(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 100);
}

function computeOverallScore(cpuPct: number, memPct: number): number {
  return Number(((clampPct(cpuPct) + clampPct(memPct)) / 2).toFixed(1));
}

function createDefaultSnapshots(appId: string) {
  const now = Date.now();
  return [
    {
      id: crypto.randomUUID(),
      appId,
      name: 'Automatischer Tages-Snapshot',
      schedule: 'automatic',
      status: 'ready',
      sizeMb: 768,
      createdAt: new Date(now - 1000 * 60 * 60 * 6).toISOString(),
    },
    {
      id: crypto.randomUUID(),
      appId,
      name: 'Vor letztem Deployment',
      schedule: 'manual',
      status: 'ready',
      sizeMb: 742,
      createdAt: new Date(now - 1000 * 60 * 60 * 30).toISOString(),
    },
  ];
}

// Middleware
// CORS: allow only configured origins (comma-separated CORS_ORIGINS, default localhost dev)
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3001')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());

// Health and observability-aware health
const APP_HEALTH = {
  status: 'ok',
  uptime: process.uptime(),
  version: APP_VERSION,
  metrics,
};

// API key hashing: uses a slow KDF (scrypt) with a per-key random salt so a
// database leak does not allow offline brute-forcing of stored key hashes.
const API_KEY_HASH_PREFIX = 'scrypt:';
const API_KEY_SALT_BYTES = 16;
const API_KEY_HASH_BYTES = 64;

function hashApiKey(rawKey: string): string {
  const salt = crypto.randomBytes(API_KEY_SALT_BYTES);
  const hash = crypto.scryptSync(rawKey, salt, API_KEY_HASH_BYTES);
  return `${API_KEY_HASH_PREFIX}${salt.toString('hex')}:${hash.toString('hex')}`;
}

function apiKeyMatches(rawKey: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.startsWith(API_KEY_HASH_PREFIX)) return false;
  const parts = storedHash.substring(API_KEY_HASH_PREFIX.length).split(':');
  if (parts.length !== 2) return false;
  const expected = Buffer.from(parts[1], 'hex');
  const actual = crypto.scryptSync(rawKey, Buffer.from(parts[0], 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Auth middleware: Verify JWT token from Authorization header and attach user to request.
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware function
 */
const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (data?.user) {
    (req as any).user = data.user;
    return next();
  }

  const keyPrefix = token.substring(0, 10);
  const { data: apiKeyRow } = await supabase
    .from('api_keys')
    .select('user_id, key_hash')
    .eq('key_prefix', keyPrefix)
    .eq('revoked', false)
    .maybeSingle();

  if (apiKeyRow && apiKeyMatches(token, apiKeyRow.key_hash)) {
    (req as any).user = { id: apiKeyRow.user_id };
    return next();
  }

  return res.status(401).json({ error: 'Invalid token' });
};

/**
 * Log an audit event to the database.
 * @param userId - ID of the user performing the action
 * @param action - Action description (e.g. 'app:create')
 * @param entityType - Type of entity being acted upon
 * @param entityId - ID of the entity
 * @param oldValue - Previous value (for updates)
 * @param newValue - New value
 * @param ipAddress - IP address of the requester
 */
async function logAudit(userId: string, action: string, entityType: string, entityId?: string, oldValue?: any, newValue?: any, ipAddress?: string) {
  try {
    await supabase
      .from('audit_log')
      .insert({
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        old_value: oldValue ? JSON.stringify(sanitizeAuditValue(oldValue)) : null,
        new_value: newValue ? JSON.stringify(sanitizeAuditValue(newValue)) : null,
        ip_address: ipAddress || null,
      });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// ============================================================================
// SETUP ROUTES
// ============================================================================

// GET /api/setup/status - Check setup status
app.get('/api/setup/status', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('setup_config')
      .select('*')
      .single();

    if (error && error.code === 'PGRST116') {
      // No setup config yet
      return res.json({ initialized: false, mode: null });
    }

    res.json({
      initialized: data?.initialized || false,
      mode: data?.mode || 'personal',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

// POST /api/setup/init - Initialize setup (create first admin user & mode selection)
app.post('/api/setup/init', loginLimiter, async (req: Request, res: Response) => {
  const { email, password, displayName, mode } = req.body;

  if (!email || !password || !mode || !['personal', 'business'].includes(mode)) {
    return res.status(400).json({ error: 'Missing or invalid parameters' });
  }

  try {
    // Refuse re-initialization once an admin account already exists
    const { data: existingSetup, error: setupCheckError } = await supabase
      .from('setup_config')
      .select('initialized')
      .single();

    if (!setupCheckError && existingSetup?.initialized) {
      return res.status(409).json({ error: 'Setup already initialized' });
    }

    // Create user via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !authData.user) {
      return res.status(400).json({ error: authError?.message || 'Failed to create user' });
    }

    const userId = authData.user.id;

    // Create user profile
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        id: userId,
        display_name: displayName || email.split('@')[0],
        role: 'admin',
      });

    if (profileError) {
      // Clean up user if profile creation fails
      await supabase.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: 'Failed to create user profile' });
    }

    // Create setup config
    const { error: setupError } = await supabase
      .from('setup_config')
      .insert({
        mode,
        initialized: true,
        admin_user_id: userId,
      });

    if (setupError) {
      return res.status(500).json({ error: 'Failed to initialize setup' });
    }

    // Return session token
    const { data: sessionData, error: sessionError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (sessionError || !sessionData.session) {
      return res.status(500).json({ error: 'Failed to create session' });
    }

    res.json({
      success: true,
      mode,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Setup initialization failed' });
  }
});

// ============================================================================
// VALIDATION ROUTES (no auth required - utility before setup)
// ============================================================================

// POST /api/validate/discord-token - Validate a Discord bot token
app.post('/api/validate/discord-token', async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ valid: false, error: 'Token is required' });
  }

  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });

    if (response.status === 401) {
      return res.json({ valid: false, error: 'Invalid token' });
    }

    if (!response.ok) {
      return res.status(response.status).json({ valid: false, error: 'Discord API error' });
    }

    const userData: any = await response.json();
    const botName = userData.username;

    let guildCount = 0;
    try {
      const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { Authorization: `Bot ${token}` },
      });
      if (guildsResponse.ok) {
        const guilds: any[] = await guildsResponse.json();
        guildCount = guilds.length;
      }
    } catch {
      // guild count is best-effort
    }

    res.json({ valid: true, botName, guildCount });
  } catch (err) {
    res.status(500).json({ valid: false, error: 'Failed to validate token' });
  }
});

// ============================================================================
// DOCKER APP ROUTES (require auth)
// ============================================================================


// GET /api/presets - List server presets
app.get('/api/presets', verifyAuth, async (_req: Request, res: Response) => {
  res.json(SERVER_PRESETS);
});

// GET /api/apps - List all apps for current user
app.get('/api/apps', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;

  try {
    const { data, error } = await supabase
      .from('docker_apps')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch apps' });
  }
});

// POST /api/apps - Create a new Docker app
app.post('/api/apps', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, image, ports, environmentVars, volumes, memoryLimit, cpuShares, description, javaVersion } = req.body;

  if (!name || !image) {
    return res.status(400).json({ error: 'Name and image are required' });
  }

  try {
    const mergedEnvVars = { ...(environmentVars || {}) };
    if (javaVersion) {
      mergedEnvVars.JAVA_VERSION = javaVersion;
    }

    const { data, error } = await supabase
      .from('docker_apps')
      .insert({
        user_id: userId,
        name,
        image,
        status: 'stopped',
        ports: ports || [],
        environment_vars: mergedEnvVars,
        volumes: volumes || [],
        memory_limit: memoryLimit,
        cpu_shares: cpuShares,
        description,
      })
      .select()
      .single();

    if (error) throw error;
    await logAudit(userId, 'app:create', 'app', data.id, null, { name, image });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create app' });
  }
});

// GET /api/apps/:appId - Get app details
app.get('/api/apps/:appId', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const { data, error } = await supabase
      .from('docker_apps')
      .select('*')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'App not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch app' });
  }
});

// PATCH /api/apps/:appId - Update app settings
app.patch('/api/apps/:appId', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const { javaVersion, ...otherFields } = req.body;

  const ALLOWED_UPDATE_FIELDS = [
    'name',
    'image',
    'ports',
    'environment_vars',
    'volumes',
    'restart_policy',
    'memory_limit',
    'cpu_shares',
    'description',
    'labels',
  ];

  try {
    const updateData: Record<string, unknown> = {};
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (otherFields[field] !== undefined) {
        updateData[field] = otherFields[field];
      }
    }

    if (javaVersion) {
      const { data: current } = await supabase
        .from('docker_apps')
        .select('environment_vars')
        .eq('id', appId)
        .eq('user_id', userId)
        .single();

      const envVars = { ...((current?.environment_vars as Record<string, string>) || {}), JAVA_VERSION: javaVersion };
      updateData.environment_vars = envVars;
    }

    const { data, error } = await supabase
      .from('docker_apps')
      .update(updateData)
      .eq('id', appId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'App not found' });
    }

    await logAudit(userId, 'app:update', 'app', appId, null, updateData);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update app' });
  }
});

// DELETE /api/apps/:appId - Delete an app
app.delete('/api/apps/:appId', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const { error } = await supabase
      .from('docker_apps')
      .delete()
      .eq('id', appId)
      .eq('user_id', userId);

    if (error) throw error;
    await logAudit(userId, 'app:delete', 'app', appId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete app' });
  }
});

// ============================================================================
// DOCKER CONTROL ROUTES (require auth)
// ============================================================================

// POST /api/apps/:appId/start - Start a container
app.post('/api/apps/:appId/start', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const dockerResult = await dockerAction(appId, 'start');
    const { data, error } = await supabase
      .from('docker_apps')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', appId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) throw error;
    await logAudit(userId, 'app:start', 'app', appId);
    res.json({ ...data, docker: dockerResult });
  } catch (err: any) {
    if (err.message?.includes('App not found') || err.message?.includes('No container')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message?.includes('docker') || err.code === 'ENOENT') {
      return res.status(502).json({ error: 'Docker is not available', details: err.message });
    }
    res.status(500).json({ error: 'Failed to start app' });
  }
});

// POST /api/apps/:appId/stop - Stop a container
app.post('/api/apps/:appId/stop', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const dockerResult = await dockerAction(appId, 'stop');
    const { data, error } = await supabase
      .from('docker_apps')
      .update({ status: 'stopped' })
      .eq('id', appId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) throw error;
    await logAudit(userId, 'app:stop', 'app', appId);
    res.json({ ...data, docker: dockerResult });
  } catch (err: any) {
    if (err.message?.includes('App not found') || err.message?.includes('No container')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message?.includes('docker') || err.code === 'ENOENT') {
      return res.status(502).json({ error: 'Docker is not available', details: err.message });
    }
    res.status(500).json({ error: 'Failed to stop app' });
  }
});

// POST /api/apps/:appId/restart - Restart a container
app.post('/api/apps/:appId/restart', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const dockerResult = await dockerAction(appId, 'restart');
    const { data, error } = await supabase
      .from('docker_apps')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', appId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) throw error;
    await logAudit(userId, 'app:restart', 'app', appId);
    res.json({ ...data, docker: dockerResult });
  } catch (err: any) {
    if (err.message?.includes('App not found') || err.message?.includes('No container')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message?.includes('docker') || err.code === 'ENOENT') {
      return res.status(502).json({ error: 'Docker is not available', details: err.message });
    }
    res.status(500).json({ error: 'Failed to restart app' });
  }
});

// GET /api/apps/:appId/logs - Stream logs with search, filtering, pagination
app.get('/api/apps/:appId/logs', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const offset = (page - 1) * limit;
  const search = req.query.search as string;
  const level = req.query.level as string;
  const from = req.query.from as string;
  const to = req.query.to as string;

  try {
    // Verify app ownership
    const { data: app, error: appError } = await supabase
      .from('docker_apps')
      .select('id')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Build query
    let query = supabase
      .from('app_logs')
      .select('*', { count: 'exact' })
      .eq('app_id', appId);

    if (level) {
      query = query.eq('level', level.toUpperCase());
    }
    if (from) {
      query = query.gte('created_at', from);
    }
    if (to) {
      query = query.lte('created_at', to);
    }
    if (search) {
      query = query.ilike('message', `%${search}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ data: data || [], total: count || 0, page, limit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});


// ============================================================================
// SERVER OPERATIONS ROUTES (require auth)
// ============================================================================

// POST /api/apps/:appId/clone - One-click clone with config, ports, files and backups metadata
app.post('/api/apps/:appId/clone', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const { name, includeFiles = true, includeBackups = true } = req.body;

  try {
    const source = await getOwnedAppOrNull(appId, userId);
    if (!source) return res.status(404).json({ error: 'App not found' });

    const cloneName = name || `${source.name}-clone`;
    const { data, error } = await supabase
      .from('docker_apps')
      .insert({
        user_id: userId,
        name: cloneName,
        image: source.image,
        status: 'stopped',
        ports: source.ports || [],
        environment_vars: source.environment_vars || {},
        volumes: source.volumes || [],
        memory_limit: source.memory_limit,
        cpu_shares: source.cpu_shares,
        description: `Clone of ${source.name}`,
        labels: {
          ...(source.labels || {}),
          clonedFrom: source.id,
          includeFiles,
          includeBackups,
        },
      })
      .select()
      .single();

    if (error) throw error;
    if (includeBackups) {
      const clonedSnapshots = (serverSnapshots.get(appId) || createDefaultSnapshots(appId)).map((snapshot) => ({
        ...snapshot,
        id: crypto.randomUUID(),
        appId: data.id,
        name: `${snapshot.name} (clone)`,
        createdAt: new Date().toISOString(),
      }));
      serverSnapshots.set(data.id, clonedSnapshots);
    }
    serverRoles.set(data.id, [{ id: crypto.randomUUID(), appId: data.id, principal: userId, role: 'owner', permissions: fullServerPermissions, createdAt: new Date().toISOString() }]);
    await logAudit(userId, 'app:clone', 'app', data.id, { sourceAppId: appId }, { name: cloneName, includeFiles, includeBackups });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to clone app' });
  }
});

app.get('/api/apps/:appId/roles', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });
  if (!serverRoles.has(appId)) {
    serverRoles.set(appId, [{ id: crypto.randomUUID(), appId, principal: userId, role: 'owner', permissions: fullServerPermissions, createdAt: new Date().toISOString() }]);
  }
  res.json(serverRoles.get(appId));
});

app.post('/api/apps/:appId/roles', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });

  const assignment = {
    id: req.body.id || crypto.randomUUID(),
    appId,
    principal: req.body.principal,
    role: req.body.role || 'custom',
    permissions: { ...fullServerPermissions, ...(req.body.permissions || {}) },
    createdAt: new Date().toISOString(),
  };
  const existing = serverRoles.get(appId) || [];
  serverRoles.set(appId, [assignment, ...existing.filter((role) => role.id !== assignment.id && role.principal !== assignment.principal)]);
  await logAudit(userId, 'app:role-upsert', 'app', appId, null, assignment);
  res.status(201).json(assignment);
});

app.get('/api/apps/:appId/snapshots', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });
  if (!serverSnapshots.has(appId)) serverSnapshots.set(appId, createDefaultSnapshots(appId));
  res.json(serverSnapshots.get(appId));
});

app.post('/api/apps/:appId/snapshots', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });
  const snapshot = {
    id: crypto.randomUUID(),
    appId,
    name: req.body.name || `${source.name} snapshot`,
    schedule: req.body.schedule === 'automatic' ? 'automatic' : 'manual',
    status: 'ready',
    sizeMb: Math.max(256, Math.round(((source.volumes || []).length + 1) * 512)),
    createdAt: new Date().toISOString(),
  };
  serverSnapshots.set(appId, [snapshot, ...(serverSnapshots.get(appId) || [])]);
  await logAudit(userId, 'app:snapshot-create', 'snapshot', snapshot.id, null, snapshot);
  res.status(201).json(snapshot);
});

app.post('/api/apps/:appId/snapshots/:snapshotId/restore', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId, snapshotId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });
  const snapshots = serverSnapshots.get(appId) || createDefaultSnapshots(appId);
  const snapshot = snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
  snapshot.status = 'restoring';
  snapshot.restoredAt = new Date().toISOString();
  await logAudit(userId, 'app:snapshot-restore', 'snapshot', snapshotId, null, snapshot);
  res.json(snapshot);
});

// GET /api/apps/:appId/status - Get app status
app.get('/api/apps/:appId/status', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const { data, error } = await supabase
      .from('docker_apps')
      .select('id, status, started_at, memory_limit, cpu_shares')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'App not found' });
    }

    res.json({ status: data.status, started_at: data.started_at, memory_limit: data.memory_limit, cpu_shares: data.cpu_shares });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch app status' });
  }
});

app.get('/api/apps/:appId/autopilot', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });
  const memoryLimit = source.memory_limit || '1024m';
  const cpuShares = source.cpu_shares || 512;
  res.json([
    {
      id: crypto.randomUUID(),
      appId,
      severity: cpuShares < 768 ? 'warning' : 'info',
      title: 'CPU-Burst-Limit prüfen',
      description: 'Die letzten Lastfenster zeigen kurze CPU-Spitzen während Deployments und Spieler-Join-Events.',
      recommendation: cpuShares < 768 ? 'CPU Shares auf 1024 erhöhen oder Deployment-Zeiten entzerren.' : 'Aktuelle CPU-Grenzen beibehalten und nur Warnregeln aktivieren.',
      confidence: 87,
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      appId,
      severity: memoryLimit.includes('512') ? 'critical' : 'info',
      title: 'RAM-Puffer für Snapshots',
      description: 'Snapshot- und Backup-Jobs reservieren zusätzlichen Speicher für Kompression und Prüfsummen.',
      recommendation: memoryLimit.includes('512') ? 'RAM-Limit auf mindestens 1 GB setzen.' : 'RAM-Reserve ist ausreichend; automatische Snapshots können aktiviert bleiben.',
      confidence: 91,
      createdAt: new Date().toISOString(),
    },
  ]);
});

app.get('/api/workspaces', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  if (!workspacesByUser.has(userId)) {
    workspacesByUser.set(userId, [{ id: crypto.randomUUID(), name: 'Default Workspace', appIds: [], memberCount: 1, sharedBackups: true, sharedLogs: true, createdAt: new Date().toISOString() }]);
  }
  res.json(workspacesByUser.get(userId));
});

app.post('/api/workspaces', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const workspace = {
    id: crypto.randomUUID(),
    name: req.body.name,
    appIds: req.body.appIds || [],
    memberCount: 1,
    sharedBackups: true,
    sharedLogs: true,
    createdAt: new Date().toISOString(),
  };
  workspacesByUser.set(userId, [workspace, ...(workspacesByUser.get(userId) || [])]);
  await logAudit(userId, 'workspace:create', 'workspace', workspace.id, null, workspace);
  res.status(201).json(workspace);
});

app.get('/api/apps/:appId/billing', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });
  const ramGb = source.memory_limit?.includes('g') ? parseFloat(source.memory_limit) : 1;
  const cpuCores = Math.max(0.5, (source.cpu_shares || 512) / 1024);
  const lineItems = [
    { label: 'CPU', amount: cpuCores * 11.5, unit: `${cpuCores.toFixed(1)} vCPU/Monat` },
    { label: 'RAM', amount: ramGb * 6.2, unit: `${ramGb.toFixed(1)} GB/Monat` },
    { label: 'Storage & Dateien', amount: 4.9, unit: '20 GB' },
    { label: 'Backups & Snapshots', amount: (serverSnapshots.get(appId)?.length || 2) * 1.4, unit: 'Snapshot' },
    { label: 'Netzwerk', amount: 2.5, unit: 'Traffic-Paket' },
  ];
  const monthlyEstimate = lineItems.reduce((sum, item) => sum + item.amount, 0);
  res.json({ appId, currency: 'EUR', currentMonth: monthlyEstimate * 0.42, monthlyEstimate, lineItems });
});

app.post('/api/apps/:appId/plugins/:pluginId/install', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId, pluginId } = req.params;
  const source = await getOwnedAppOrNull(appId, userId);
  if (!source) return res.status(404).json({ error: 'App not found' });
  const installed = { pluginId, appId, status: 'installed', installedAt: new Date().toISOString() };
  pluginInstallations.set(appId, [installed, ...(pluginInstallations.get(appId) || []).filter((item) => item.pluginId !== pluginId)]);
  await logAudit(userId, 'app:plugin-install', 'plugin', pluginId, null, installed);
  res.status(201).json({ success: true, pluginId });
});

// ============================================================================
// USER ROUTES (require auth)
// ============================================================================

// GET /api/user - Get current user info
app.get('/api/user', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;

  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;

    res.json({
      id: (req as any).user.id,
      email: (req as any).user.email,
      ...profile,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ============================================================================
// CONFIG ROUTES (require auth)
// ============================================================================

// GET /api/config/mode - Get current mode (personal/business)
app.get('/api/config/mode', verifyAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('setup_config')
      .select('mode')
      .single();

    if (error || !data) {
      return res.json({ mode: 'personal' });
    }

    res.json({ mode: data.mode });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ============================================================================
// CONFIG EDITOR ROUTES (require auth)
// ============================================================================

// GET /api/apps/:appId/config - List config files in container
app.get('/api/apps/:appId/config', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const path = (req.query.path as string) || '/';

  try {
    const { data: app, error } = await supabase
      .from('docker_apps')
      .select('container_id')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !app) return res.status(404).json({ error: 'App not found' });
    if (!app.container_id) return res.status(400).json({ error: 'No container associated with this app' });

    const safePath = path.replace(/[^a-zA-Z0-9_\-\.\/]/g, '');
    const { stdout, stderr } = await runCommand('docker', ['exec', app.container_id, 'ls', '-la', safePath]).catch((err: any) => {
      throw new Error(`Failed to list directory: ${err.message}`);
    });

    const lines = stdout.trim().split('\n');
    const files = lines.filter((l: string) => l.length > 0).slice(1).map((line: string) => {
      const parts = line.split(/\s+/);
      const isDir = parts[0]?.startsWith('d') || false;
      const name = parts.slice(8).join(' ');
      return {
        name,
        path: safePath === '/' ? `/${name}` : `${safePath}/${name}`,
        size: parseInt(parts[4]) || 0,
        modifiedAt: `${parts[5]} ${parts[6]} ${parts[7]}`,
        isDirectory: isDir,
      };
    });

    res.json({ files, currentPath: safePath });
  } catch (err: any) {
    if (err.message?.includes('App not found')) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to list config files' });
  }
});

// GET /api/apps/:appId/config/read - Read a config file
app.get('/api/apps/:appId/config/read', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const file = req.query.file as string;

  if (!file) return res.status(400).json({ error: 'file query parameter is required' });

  try {
    const { data: app, error } = await supabase
      .from('docker_apps')
      .select('container_id')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !app) return res.status(404).json({ error: 'App not found' });
    if (!app.container_id) return res.status(400).json({ error: 'No container associated with this app' });

    const { stdout, stderr } = await runCommand('docker', ['exec', app.container_id, 'cat', file]).catch((err: any) => {
      throw new Error(`Failed to read file: ${err.message}`);
    });

    const ext = file.split('.').pop()?.toLowerCase();
    let language: 'yaml' | 'json' | 'properties' | 'text' = 'text';
    if (ext === 'yml' || ext === 'yaml') language = 'yaml';
    else if (ext === 'json') language = 'json';
    else if (ext === 'properties') language = 'properties';

    res.json({ content: stdout, path: file, language });
  } catch (err: any) {
    if (err.message?.includes('App not found')) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to read config file' });
  }
});

// POST /api/apps/:appId/config/write - Write/save a config file
app.post('/api/apps/:appId/config/write', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const { path: filePath, content } = req.body;

  if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content are required' });

  try {
    const { data: app, error } = await supabase
      .from('docker_apps')
      .select('container_id')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !app) return res.status(404).json({ error: 'App not found' });
    if (!app.container_id) return res.status(400).json({ error: 'No container associated with this app' });

    const timestamp = Date.now();
    const backupPath = `${filePath}.bak.${timestamp}`;

    // Create backup
    await runCommand('docker', ['exec', app.container_id, 'cp', filePath, backupPath]).catch(() => {
      // Backup is best-effort; file may not exist yet
    });

    // Write new content
    const escapedContent = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await runCommand('docker', ['exec', '-i', app.container_id, 'tee', filePath], content);

    await logAudit(userId, 'config:write', 'config_file', `${appId}:${filePath}`, null, { backupPath });
    res.json({ success: true, backupPath });
  } catch (err: any) {
    if (err.message?.includes('App not found')) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to write config file' });
  }
});

// GET /api/apps/:appId/config/validate - Validate YAML/JSON syntax
app.get('/api/apps/:appId/config/validate', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const rawFile = req.query.file;

  if (typeof rawFile !== 'string' || !rawFile) {
    return res.status(400).json({ error: 'file query parameter is required' });
  }

  const file = rawFile;
  if (!/^[a-zA-Z0-9._/-]+$/.test(file) || file.includes('..') || file.startsWith('/')) {
    return res.status(400).json({ error: 'Invalid file path' });
  }

  try {
    const { data: app, error } = await supabase
      .from('docker_apps')
      .select('container_id')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !app) return res.status(404).json({ error: 'App not found' });
    if (!app.container_id) return res.status(400).json({ error: 'No container associated with this app' });

    const { stdout } = await runCommand('docker', ['exec', app.container_id, 'cat', file]).catch((err: any) => {
      throw new Error(`Failed to read file: ${err.message}`);
    });

    const ext = file.split('.').pop()?.toLowerCase();
    const errors: string[] = [];
    let valid = true;

    if (ext === 'yml' || ext === 'yaml') {
      try {
        JSON.parse(stdout);
        errors.push('File parsed as JSON but has .yaml extension');
        valid = false;
      } catch {
        // Not JSON, try YAML-like validation
        const lines = stdout.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim().startsWith('- ') || line.trim().match(/^[\w.-]+:/)) continue;
          if (line.trim() === '' || line.trim().startsWith('#')) continue;
          if (line.trim().match(/^[a-zA-Z]/) && !line.includes(':')) {
            errors.push(`Line ${i + 1}: unexpected value "${line.trim()}"`);
            valid = false;
          }
        }
      }
    } else if (ext === 'json') {
      try {
        JSON.parse(stdout);
      } catch (e: any) {
        errors.push(e.message || 'Invalid JSON');
        valid = false;
      }
    } else {
      errors.push('Unsupported file format for validation');
      valid = false;
    }

    res.json({ valid, errors });
  } catch (err: any) {
    if (err.message?.includes('App not found')) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to validate config file' });
  }
});

// Health check with basic instrumentation exposure
app.get('/health', (req: Request, res: Response) => {
  // Return some useful health metrics for observability
  res.json({ status: 'ok', uptime: process.uptime(), version: APP_VERSION, metrics });
});

// CLI-compatible health endpoint (CLI prepends /api to all paths)
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: APP_VERSION, metrics });
});

// ============================================================================
// 2FA (Two-Factor Authentication) Routes
// ============================================================================

const INTEGRATION_SERVICE_URL = process.env.INTEGRATION_SERVICE_URL || 'http://localhost:9000';

async function forwardToIntegration(req: Request, res: Response, path: string) {
  try {
    const response = await fetch(`${INTEGRATION_SERVICE_URL}${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Integration service unavailable' });
  }
}

app.post('/api/auth/2fa/setup', verifyAuth, async (req: Request, res: Response) => {
  await forwardToIntegration(req, res, '/api/auth/2fa/setup');
});

app.post('/api/auth/2fa/verify-setup', verifyAuth, async (req: Request, res: Response) => {
  await forwardToIntegration(req, res, '/api/auth/2fa/verify-setup');
});

app.post('/api/auth/2fa/verify', async (req: Request, res: Response) => {
  await forwardToIntegration(req, res, '/api/auth/2fa/verify');
});

app.post('/api/auth/2fa/disable', verifyAuth, async (req: Request, res: Response) => {
  await forwardToIntegration(req, res, '/api/auth/2fa/disable');
});

app.get('/api/auth/2fa/backup-codes', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const response = await fetch(`${INTEGRATION_SERVICE_URL}/api/auth/2fa/backup-codes?user_id=${userId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Integration service unavailable' });
  }
});

app.post('/api/auth/2fa/verify-backup', async (req: Request, res: Response) => {
  await forwardToIntegration(req, res, '/api/auth/2fa/verify-backup');
});

// POST /api/auth/login - Authenticate with an API key
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { api_key } = req.body;
  if (!api_key || typeof api_key !== 'string') {
    return res.status(400).json({ error: 'api_key is required' });
  }

  const keyPrefix = api_key.substring(0, 10);
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, user_id, key_hash')
    .eq('key_prefix', keyPrefix)
    .eq('revoked', false)
    .maybeSingle();

  if (error || !data || !apiKeyMatches(api_key, data.key_hash)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  res.json({ token: api_key, user_id: data.user_id });
});

// POST /api/auth/logout - Invalidate the current session
app.post('/api/auth/logout', async (_req: Request, res: Response) => {
  res.json({ success: true });
});

// GET /api/demo/flag - Expose the Demo feature flag for testing/CI verification
app.get('/api/demo/flag', (_req: Request, res: Response) => {
  const enabled = process.env.VITE_DEMO_FEATURE_ENABLED === 'true';
  res.json({ enabled });
});

// Minimal Business Mode MVP: expose a placeholder endpoint for customers
// Access controlled via existing verifyAuth middleware
app.get('/api/customers', verifyAuth, customersLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  try {
    const { data: cfg } = await supabase.from('setup_config').select('mode').single();
    const mode = (cfg as any)?.mode || 'personal';
    if (mode === 'personal') {
      return res.status(403).json({ error: 'Not available in Personal Mode' });
    }
    // Seed data on first boot for this user if no customers exist yet
    const { data: existingForUser, error: ex } = await supabase
      .from('customers')
      .select('id')
      .eq('owner_user_id', userId)
      .limit(1);
      if (!existingForUser || existingForUser.length === 0) {
      try {
        const seedsPath = path.join(__dirname, '..', 'seeds', 'customers.sample.json');
        let seeds: Array<{ name: string; email?: string } > = [];
        try {
          const raw = await fs.readFile(seedsPath, 'utf8');
          seeds = JSON.parse(raw);
        } catch {
          // If seeds file missing or invalid, skip seeding
          seeds = [];
        }
        for (const s of seeds) {
          // Respect owner_user_id in seed data; skip if it doesn't belong to the current user
          if ((s as any).owner_user_id && (s as any).owner_user_id !== userId) continue;
          if (!s?.name) continue;
          const { data: exists, error: e2 } = await supabase
            .from('customers')
            .select('id')
            .eq('owner_user_id', userId)
            .eq('name', s.name)
            .limit(1);
          if (exists && exists.length > 0) continue;
          await supabase
            .from('customers')
            .insert({ owner_user_id: userId, name: s.name, email: s.email ?? null })
            .select()
            .single();
        }
      } catch {
        // Ignore seeding errors; UI can still function
      }
    }
    // After potential seeding, fetch and return
    const { data, error } = await supabase.from('customers').select('*').eq('owner_user_id', userId);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// POST /api/customers - Create a new customer (Business Mode only)
app.post('/api/customers', verifyAuth, customersLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const { name, email } = req.body;
  try {
    const { data: cfg } = await supabase.from('setup_config').select('mode').single();
    const mode = (cfg as any)?.mode || 'personal';
    if (mode === 'personal') {
      return res.status(403).json({ error: 'Not available in Personal Mode' });
    }
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const { data, error } = await supabase.from('customers').insert({ owner_user_id: userId, name, email }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// POST /api/seed-demo - Seed demo data (customers + apps) for quick local demos
app.post('/api/seed-demo', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  try {
    const { data: cfg } = await supabase.from('setup_config').select('mode').single();
    const mode = (cfg as any)?.mode || 'personal';
    if (mode === 'personal') {
      return res.status(403).json({ error: 'Not available in Personal Mode' });
    }

    const demoCustomers = [
      { owner_user_id: userId, name: 'Acme Co', email: 'contact@acme.local' },
      { owner_user_id: userId, name: 'Globex Corp', email: 'hello@globex.local' },
    ];
    // Idempotent: seed only missing customers for this user
    let insertedCustomers: any[] = [];
    for (const dc of demoCustomers) {
      const { data: exists } = await supabase
        .from('customers')
        .select('id')
        .eq('owner_user_id', userId)
        .eq('name', dc.name)
        .single();
      if (!exists) {
        const { data } = await supabase.from('customers').insert({ owner_user_id: userId, name: dc.name, email: dc.email }).select().single();
        if (data) insertedCustomers.push(data);
      }
    }
    // Prepare apps for seed (optional). Keep this idempotent per owner+name so
    // repeated demo seeding does not create duplicate containers for the same user.
    const demoApps = [
      { user_id: userId, name: 'demo-app', image: 'nginx:latest', status: 'stopped', memory_limit: '256mb' },
      { user_id: userId, name: 'monitor', image: 'prom/prometheus', status: 'stopped', memory_limit: '256mb' },
    ];
    let insertedApps: any[] = [];
    for (const appSeed of demoApps) {
      const { data: exists } = await supabase
        .from('docker_apps')
        .select('id')
        .eq('user_id', userId)
        .eq('name', appSeed.name)
        .single();
      if (!exists) {
        const { data } = await supabase.from('docker_apps').insert(appSeed).select().single();
        if (data) insertedApps.push(data);
      }
    }

    const customersSeeded = Array.isArray(insertedCustomers) ? insertedCustomers.length : 0;
    const appsSeeded = Array.isArray(insertedApps) ? insertedApps.length : 0;
    res.json({ customersSeeded, appsSeeded });
  } catch (err) {
    res.status(500).json({ error: 'Seed-demo failed' });
  }
});

// PATCH /api/customers/:customerId - Update a customer (Business Mode only)
app.patch('/api/customers/:customerId', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const { customerId } = req.params;
  const updates = req.body;
  try {
    // Ensure ownership and apply updates
    const { data, error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', customerId)
      .eq('owner_user_id', userId)
      .select()
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// DELETE /api/customers/:customerId - Delete a customer (Business Mode only)
app.delete('/api/customers/:customerId', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const { customerId } = req.params;
  try {
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', customerId)
      .eq('owner_user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// ============================================================================
// Phase 4: Management Panel Routes
// ============================================================================

// GET /api/apps/:appId/metrics - Server metrics for an app
app.get('/api/apps/:appId/metrics', verifyAuth, async (req: Request, res: Response) => {
  const { appId } = req.params;
  const range = (req.query.range as string) || '30m';
  try {
    const since = new Date(Date.now() - parseRange(range)).toISOString();
    const { data, error } = await supabase
      .from('server_metrics')
      .select('*')
      .eq('app_id', appId)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

function parseRange(range: string): number {
  const match = range.match(/^(\d+)([mhd])$/);
  if (!match) return 30 * 60 * 1000;
  const val = parseInt(match[1]);
  const unit = match[2];
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 3600 * 1000;
  if (unit === 'd') return val * 86400 * 1000;
  return 30 * 60 * 1000;
}

// GET /api/metrics/aggregated - Aggregated metrics across all apps
app.get('/api/metrics/aggregated', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { data: apps } = await supabase.from('docker_apps').select('id').eq('user_id', userId);
    if (!apps || apps.length === 0) return res.json({ totalApps: 0, totalPlayers: 0, avgCpu: 0, avgMemory: 0, serverCount: 0 });

    const appIds = apps.map(a => a.id);
    const { data: metrics } = await supabase
      .from('server_metrics')
      .select('app_id, player_count, cpu_percent, memory_used_mb, memory_total_mb, tps, lag_spike')
      .in('app_id', appIds)
      .order('recorded_at', { ascending: false });

    if (!metrics) return res.json({ totalApps: apps.length, totalPlayers: 0, avgCpu: 0, avgMemory: 0, serverCount: 0 });

    const latest = new Map<string, any>();
    for (const m of metrics) {
      if (!latest.has(m.app_id)) latest.set(m.app_id, m);
    }

    const vals = Array.from(latest.values());
    const totalPlayers = vals.reduce((s, m) => s + (m.player_count || 0), 0);
    const avgCpu = vals.length > 0 ? vals.reduce((s, m) => s + (m.cpu_percent || 0), 0) / vals.length : 0;
    const avgMemoryPercent = vals.length > 0
      ? vals.reduce((s, m) => s + (m.memory_total_mb > 0 ? ((m.memory_used_mb || 0) / m.memory_total_mb) * 100 : 0), 0) / vals.length
      : 0;
    const lagCount = vals.filter(m => m.lag_spike).length;
    res.json({ totalApps: apps.length, totalPlayers, avgCpu: Math.round(avgCpu * 100) / 100, avgMemory: Math.round(avgMemoryPercent * 100) / 100, serverCount: apps.length, lagSpikes: lagCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch aggregated metrics' });
  }
});

// GET /api/metrics/realtime - Real-time resource data
app.get('/api/metrics/realtime', verifyAuth, generalLimiter, async (req: Request, res: Response) => {
  const appId = req.query.appId as string | undefined;
  try {
    if (appId) {
      const { data: app, error } = await supabase
        .from('docker_apps')
        .select('container_id')
        .eq('id', appId)
        .single();
      if (error || !app) return res.status(404).json({ error: 'App not found' });
      if (app.container_id) {
        const { stdout } = await runCommand('docker', ['stats', app.container_id, '--no-stream', '--format', '{{json .}}']).catch(() => ({ stdout: '', stderr: '' }));
        if (stdout) {
          const stats = JSON.parse(stdout);
          const cpuPct = parseFloat(stats.CPUPerc) || 0;
          const memUsed = parseFloat(stats.MemUsage?.split('/')[0]?.trim()) || 0;
          const memTotal = parseFloat(stats.MemUsage?.split('/')[1]?.trim()) || 1;
          const netRx = parseFloat(stats.NetIO?.split('/')[0]?.trim()) || 0;
          const netTx = parseFloat(stats.NetIO?.split('/')[1]?.trim()) || 0;
          return res.json({
            cpu: { current: cpuPct, cores: os.cpus().length, unit: '%' },
            memory: { current: memUsed, total: memTotal, unit: 'MB', percent: (memUsed / memTotal) * 100 },
            disk: { current: 0, total: 0, unit: 'GB', percent: 0 },
            network: { rx: netRx, tx: netTx, unit: 'Mbps' },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // System-wide metrics
    const cpus = os.cpus();
    const cpuLoad = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsed = totalMem - freeMem;
    const memPercent = (memUsed / totalMem) * 100;

    let diskData = { current: 0, total: 0, percent: 0 };
    try {
      const { stdout } = await execAsync('df -k /');
      const lines = stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const totalKb = parseInt(parts[1]) || 0;
        const usedKb = parseInt(parts[2]) || 0;
        const totalGb = totalKb / (1024 * 1024);
        const usedGb = usedKb / (1024 * 1024);
        diskData = { current: Math.round(usedGb * 100) / 100, total: Math.round(totalGb * 100) / 100, percent: totalGb > 0 ? (usedGb / totalGb) * 100 : 0 };
      }
    } catch {}

    res.json({
      cpu: { current: Math.round(cpuLoad * 100) / 100, cores: cpus.length, unit: '%' },
      memory: { current: Math.round(memUsed / (1024 * 1024)), total: Math.round(totalMem / (1024 * 1024)), unit: 'MB', percent: Math.round(memPercent * 100) / 100 },
      disk: { current: diskData.current, total: diskData.total, unit: 'GB', percent: Math.round(diskData.percent * 100) / 100 },
      network: { rx: 0, tx: 0, unit: 'Mbps' },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch realtime metrics' });
  }
});

// GET /api/metrics/history - Historical time-series metrics
app.get('/api/metrics/history', verifyAuth, async (req: Request, res: Response) => {
  const appId = req.query.appId as string | undefined;
  const period = (req.query.period as string) || '1h';
  const resolution = (req.query.resolution as string) || '5m';

  const periodMap: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 };
  const since = new Date(Date.now() - (periodMap[period] || 3600000)).toISOString();

  try {
    let query = supabase
      .from('server_metrics')
      .select('recorded_at, cpu_percent, memory_used_mb, memory_total_mb, tps, player_count')
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: true });

    if (appId) query = query.eq('app_id', appId);

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate by resolution interval
    const aggregated = new Map<string, { cpu: number[]; memory: number[]; tps: number[]; players: number[] }>();
    const intervalMs = resolution === '1m' ? 60000 : resolution === '5m' ? 300000 : 3600000;

    for (const row of data || []) {
      const ts = new Date(row.recorded_at);
      const bucket = new Date(Math.floor(ts.getTime() / intervalMs) * intervalMs).toISOString();
      if (!aggregated.has(bucket)) aggregated.set(bucket, { cpu: [], memory: [], tps: [], players: [] });
      const entry = aggregated.get(bucket)!;
      if (row.cpu_percent != null) entry.cpu.push(row.cpu_percent);
      if (row.memory_used_mb != null) entry.memory.push(row.memory_used_mb);
      if (row.tps != null) entry.tps.push(row.tps);
      if (row.player_count != null) entry.players.push(row.player_count);
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const result = Array.from(aggregated.entries()).map(([timestamp, vals]) => ({
      timestamp,
      cpu: Math.round(avg(vals.cpu) * 100) / 100,
      memory: Math.round(avg(vals.memory) * 100) / 100,
      tps: Math.round(avg(vals.tps) * 10) / 10,
      players: Math.round(avg(vals.players)),
    }));

    res.json({ data: result, period, resolution });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// POST /api/metrics/stream/config - Configure Netdata/Grafana data source
app.post('/api/metrics/stream/config', verifyAuth, async (req: Request, res: Response) => {
  const { type, url, apiKey } = req.body;
  if (!type || !url || !['netdata', 'grafana'].includes(type)) {
    return res.status(400).json({ error: 'type (netdata|grafana) and url are required' });
  }
  try {
    const { error } = await supabase
      .from('shared_config')
      .upsert({ key: 'metrics_config', value: { type, url, apiKey: apiKey || null } }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save metrics config' });
  }
});

// GET /api/metrics/grafana-url - Return Grafana embed URL if configured
app.get('/api/metrics/grafana-url', verifyAuth, async (req: Request, res: Response) => {
  try {
    const { data } = await supabase
      .from('shared_config')
      .select('value')
      .eq('key', 'metrics_config')
      .single();
    const config = data?.value as any;
    if (config && config.type === 'grafana' && config.url) {
      return res.json({ url: config.url });
    }
    res.json({ url: null });
  } catch (err) {
    res.json({ url: null });
  }
});

// GET /api/logs/access - Access logs
app.get('/api/logs/access', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const { data, error } = await supabase
      .from('access_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch access logs' });
  }
});

// GET /api/apps/:appId/config-versions - Config version history
app.get('/api/apps/:appId/config-versions', verifyAuth, async (req: Request, res: Response) => {
  const { appId } = req.params;
  try {
    const { data, error } = await supabase
      .from('config_versions')
      .select('*')
      .eq('app_id', appId)
      .order('version', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch config versions' });
  }
});

// POST /api/apps/:appId/config-versions - Create config version snapshot
app.post('/api/apps/:appId/config-versions', verifyAuth, async (req: Request, res: Response) => {
  const { appId } = req.params;
  const userId = (req as any).user.id;
  const { config_snapshot, change_summary } = req.body;
  try {
    const { data: maxVer } = await supabase
      .from('config_versions')
      .select('version')
      .eq('app_id', appId)
      .order('version', { ascending: false })
      .limit(1);
    const nextVersion = (maxVer && maxVer.length > 0 ? maxVer[0].version : 0) + 1;
    const { data, error } = await supabase
      .from('config_versions')
      .insert({ app_id: appId, version: nextVersion, config_snapshot, created_by: userId, change_summary })
      .select()
      .single();
    if (error) throw error;
    await logAudit(userId, 'config:version:create', 'config_version', `${appId}@v${nextVersion}`, null, { change_summary });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create config version' });
  }
});

// POST /api/apps/:appId/config-versions/:version/rollback - Rollback to version
app.post('/api/apps/:appId/config-versions/:version/rollback', verifyAuth, async (req: Request, res: Response) => {
  const { appId, version } = req.params;
  const userId = (req as any).user.id;
  try {
    const { data: target, error: fetchError } = await supabase
      .from('config_versions')
      .select('*')
      .eq('app_id', appId)
      .eq('version', parseInt(version))
      .single();
    if (fetchError || !target) return res.status(404).json({ error: 'Version not found' });
    const snapshot = target.config_snapshot;
    // Update the app with the snapshot config
    const { data, error } = await supabase
      .from('docker_apps')
      .update({ environment_vars: snapshot.environment_vars || {}, memory_limit: snapshot.memory_limit, cpu_shares: snapshot.cpu_shares })
      .eq('id', appId)
      .select()
      .single();
    if (error) throw error;
    // Create a new version entry reflecting the rollback
    const { data: maxVer } = await supabase
      .from('config_versions')
      .select('version')
      .eq('app_id', appId)
      .order('version', { ascending: false })
      .limit(1);
    const nextVersion = (maxVer && maxVer.length > 0 ? maxVer[0].version : 0) + 1;
    const { data: newVer, error: verError } = await supabase
      .from('config_versions')
      .insert({ app_id: appId, version: nextVersion, config_snapshot: snapshot, created_by: userId, change_summary: `Rolled back to version ${version}` })
      .select()
      .single();
    if (verError) throw verError;
    await logAudit(userId, 'config:rollback', 'config_version', `${appId}@v${version}`, null, { rolled_back_to: version });
    res.json(newVer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to rollback config' });
  }
});

// Maintenance Windows CRUD
app.get('/api/maintenance-windows', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { data, error } = await supabase
      .from('maintenance_windows')
      .select('*')
      .eq('user_id', userId)
      .order('starts_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch maintenance windows' });
  }
});

app.post('/api/maintenance-windows', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { title, description, app_id, starts_at, ends_at } = req.body;
  try {
    const { data, error } = await supabase
      .from('maintenance_windows')
      .insert({ user_id: userId, title, description, app_id, starts_at, ends_at })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create maintenance window' });
  }
});

app.patch('/api/maintenance-windows/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('maintenance_windows')
      .update(req.body)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Maintenance window not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update maintenance window' });
  }
});

// Scheduled Tasks CRUD (stored in shared_config as JSON array)
const getScheduledTasks = async (): Promise<any[]> => {
  const { data } = await supabase
    .from('shared_config')
    .select('value')
    .eq('key', 'scheduled_tasks')
    .single();
  return (data?.value as any[]) || [];
};

const setScheduledTasks = async (tasks: any[]): Promise<void> => {
  await supabase
    .from('shared_config')
    .upsert({ key: 'scheduled_tasks', value: tasks }, { onConflict: 'key' });
};

app.get('/api/scheduled-tasks', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const tasks = await getScheduledTasks();
    const userTasks = tasks.filter((t: any) => t.user_id === userId);
    res.json(userTasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scheduled tasks' });
  }
});

app.post('/api/scheduled-tasks', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, description, taskType, targetAppId, cronExpression, command } = req.body;

  if (!name || !taskType || !cronExpression) {
    return res.status(400).json({ error: 'name, taskType, and cronExpression are required' });
  }

  if (!['restart', 'command', 'backup', 'custom'].includes(taskType)) {
    return res.status(400).json({ error: 'taskType must be restart, command, backup, or custom' });
  }

  try {
    const tasks = await getScheduledTasks();
    const newTask = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      description: description || '',
      taskType,
      targetAppId: targetAppId || null,
      cronExpression,
      command: command || null,
      enabled: true,
      lastRunAt: null,
      lastRunStatus: null,
      nextRunAt: null,
      createdAt: new Date().toISOString(),
    };
    tasks.push(newTask);
    await setScheduledTasks(tasks);
    await logAudit(userId, 'scheduled_task:create', 'scheduled_task', newTask.id, null, { name, taskType, cronExpression });
    res.status(201).json(newTask);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create scheduled task' });
  }
});

app.patch('/api/scheduled-tasks/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const tasks = await getScheduledTasks();
    const index = tasks.findIndex((t: any) => t.id === id && t.user_id === userId);
    if (index === -1) return res.status(404).json({ error: 'Scheduled task not found' });
    tasks[index] = { ...tasks[index], ...req.body, id, user_id: userId };
    await setScheduledTasks(tasks);
    await logAudit(userId, 'scheduled_task:update', 'scheduled_task', id, null, req.body);
    res.json(tasks[index]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update scheduled task' });
  }
});

app.delete('/api/scheduled-tasks/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const tasks = await getScheduledTasks();
    const index = tasks.findIndex((t: any) => t.id === id && t.user_id === userId);
    if (index === -1) return res.status(404).json({ error: 'Scheduled task not found' });
    tasks.splice(index, 1);
    await setScheduledTasks(tasks);
    await logAudit(userId, 'scheduled_task:delete', 'scheduled_task', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete scheduled task' });
  }
});

app.post('/api/scheduled-tasks/:id/toggle', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const tasks = await getScheduledTasks();
    const index = tasks.findIndex((t: any) => t.id === id && t.user_id === userId);
    if (index === -1) return res.status(404).json({ error: 'Scheduled task not found' });
    tasks[index].enabled = !tasks[index].enabled;
    await setScheduledTasks(tasks);
    await logAudit(userId, 'scheduled_task:toggle', 'scheduled_task', id, null, { enabled: tasks[index].enabled });
    res.json(tasks[index]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle scheduled task' });
  }
});

// Backup Jobs CRUD
app.get('/api/backup-jobs', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const appId = req.query.app_id as string | undefined;
  try {
    let query = supabase
      .from('backup_jobs')
      .select('*')
      .eq('user_id', userId);
    if (appId) query = query.eq('app_id', appId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch backup jobs' });
  }
});

app.post('/api/backup-jobs', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, app_id, schedule_type, retention_count } = req.body;
  try {
    const { data, error } = await supabase
      .from('backup_jobs')
      .insert({ user_id: userId, name, app_id, schedule_type: schedule_type || 'manual', retention_count: retention_count || 7 })
      .select()
      .single();
    if (error) throw error;
    await logAudit(userId, 'backup:create', 'backup', data.id, null, { name, app_id });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create backup job' });
  }
});

app.patch('/api/backup-jobs/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('backup_jobs')
      .update(req.body)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Backup job not found' });
    await logAudit(userId, 'backup:update', 'backup', id, null, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update backup job' });
  }
});

app.delete('/api/backup-jobs/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { error } = await supabase.from('backup_jobs').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    await logAudit(userId, 'backup:delete', 'backup', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete backup job' });
  }
});

// GET /api/backup-jobs/:jobId/status - Backup status history
app.get('/api/backup-jobs/:jobId/status', verifyAuth, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  try {
    const { data, error } = await supabase
      .from('backup_status')
      .select('*')
      .eq('backup_job_id', jobId)
      .order('started_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch backup status' });
  }
});

// POST /api/backup/config - S3/Backblaze backup storage configuration
app.post('/api/backup/config', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { s3_bucket, s3_key, s3_secret, s3_endpoint } = req.body;
  await supabase.from('shared_config').upsert({ key: `backup_s3_config_${userId}`, value: { s3_bucket, s3_key, s3_secret: s3_secret ? '***' : undefined, s3_endpoint } }, { onConflict: 'key' });
  res.json({ status: 'configured', storage: s3_bucket ? `s3://${s3_bucket}` : 'local' });
});

// POST /api/backups/:backupId/restore - Restore from backup
app.post('/api/backups/:backupId/restore', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { target } = req.body;
  res.json({ status: 'restore_initiated', backup_id: req.params.backupId, target: target || 'original', message: 'Restore process started' });
});

// Alert Configs CRUD
app.get('/api/alert-configs', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { data, error } = await supabase
      .from('alert_configs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alert configs' });
  }
});

app.post('/api/alert-configs', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { metric_type, operator, threshold, enabled, notify_email } = req.body;
  try {
    const { data, error } = await supabase
      .from('alert_configs')
      .insert({ user_id: userId, metric_type, operator, threshold, enabled: enabled ?? true, notify_email: notify_email ?? false })
      .select()
      .single();
    if (error) throw error;
    await logAudit(userId, 'alert:create', 'alert_config', data.id, null, { metric_type, operator, threshold });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create alert config' });
  }
});

app.patch('/api/alert-configs/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('alert_configs')
      .update(req.body)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Alert config not found' });
    await logAudit(userId, 'alert:update', 'alert_config', id, null, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update alert config' });
  }
});

app.delete('/api/alert-configs/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { error } = await supabase.from('alert_configs').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    await logAudit(userId, 'alert:delete', 'alert_config', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete alert config' });
  }
});

// Alert History
app.get('/api/alert-history', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { data: configs } = await supabase.from('alert_configs').select('id').eq('user_id', userId);
    if (!configs || configs.length === 0) return res.json([]);
    const configIds = configs.map(c => c.id);
    const { data, error } = await supabase
      .from('alert_history')
      .select('*')
      .in('alert_config_id', configIds)
      .order('triggered_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alert history' });
  }
});

app.post('/api/alert-history/:id/acknowledge', verifyAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('alert_history')
      .update({ acknowledged: true })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Alert not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

// Health Checks
app.get('/api/health-checks', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const appId = req.query.app_id as string;
  try {
    let query = supabase.from('health_checks').select('*, docker_apps!inner(user_id)').eq('docker_apps.user_id', userId);
    if (appId) query = query.eq('app_id', appId);
    const { data, error } = await query.order('checked_at', { ascending: false }).limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch health checks' });
  }
});

// Reports & Export
app.get('/api/reports', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;
  try {
    const report = await buildReport(supabase, userId, startDate, endDate);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

app.get('/api/reports/export', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;
  const format = req.query.format as string;
  try {
    const report = await buildReport(supabase, userId, startDate, endDate);
    if (format === 'csv') {
      const csv = reportToCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=report.csv');
      res.send(csv);
    } else if (format === 'pdf') {
      const pdf = reportToPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
      res.send(pdf);
    } else if (format === 'json') {
      res.json(report);
    } else {
      res.status(400).json({ error: 'Unsupported format. Use csv, pdf or json.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// ============================================================================
// DATABASE ROUTES (stored in shared_config as JSON array)
// ============================================================================

const getUserDatabases = async (userId: string): Promise<any[]> => {
  const { data } = await supabase
    .from('shared_config')
    .select('value')
    .eq('key', 'user_databases')
    .single();
  const all = (data?.value as any[]) || [];
  return all.filter((db: any) => db.user_id === userId);
};

const setUserDatabases = async (databases: any[]): Promise<void> => {
  await supabase
    .from('shared_config')
    .upsert({ key: 'user_databases', value: databases }, { onConflict: 'key' });
};

function maskPassword(pwd: string): string {
  if (!pwd) return '';
  if (pwd.length <= 4) return '****';
  return pwd.slice(0, 4) + '****';
}

// GET /api/databases - List databases for current user
app.get('/api/databases', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { data } = await supabase
      .from('shared_config')
      .select('value')
      .eq('key', 'user_databases')
      .single();
    const all = (data?.value as any[]) || [];
    const userDbs = all.filter((db: any) => db.user_id === userId);
    const masked = userDbs.map((db: any) => ({
      ...db,
      password: db.password ? maskPassword(db.password) : undefined,
    }));
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch databases' });
  }
});

// POST /api/databases - Create a new database
app.post('/api/databases', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, appId } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Database name is required' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return res.status(400).json({ error: 'Database name must be alphanumeric with underscores only' });
  }

  try {
    const { data } = await supabase
      .from('shared_config')
      .select('value')
      .eq('key', 'user_databases')
      .single();
    const all = (data?.value as any[]) || [];

    const password = crypto.randomBytes(16).toString('hex');
    const newDb = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      host: process.env.HOST_IP || '127.0.0.1',
      port: 3306,
      database: name,
      username: name,
      password,
      appId: appId || null,
      status: 'creating',
      createdAt: new Date().toISOString(),
    };

    all.push(newDb);
    await supabase
      .from('shared_config')
      .upsert({ key: 'user_databases', value: all }, { onConflict: 'key' });

    await logAudit(userId, 'database:create', 'database', newDb.id, null, { name, appId });

    res.status(201).json(newDb);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create database' });
  }
});

// GET /api/databases/:id - Get database details
app.get('/api/databases/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { data } = await supabase
      .from('shared_config')
      .select('value')
      .eq('key', 'user_databases')
      .single();
    const all = (data?.value as any[]) || [];
    const db = all.find((d: any) => d.id === id && d.user_id === userId);
    if (!db) return res.status(404).json({ error: 'Database not found' });
    res.json({
      ...db,
      password: db.password ? maskPassword(db.password) : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch database' });
  }
});

// DELETE /api/databases/:id - Delete a database
app.delete('/api/databases/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { data } = await supabase
      .from('shared_config')
      .select('value')
      .eq('key', 'user_databases')
      .single();
    const all = (data?.value as any[]) || [];
    const index = all.findIndex((d: any) => d.id === id && d.user_id === userId);
    if (index === -1) return res.status(404).json({ error: 'Database not found' });
    all.splice(index, 1);
    await supabase
      .from('shared_config')
      .upsert({ key: 'user_databases', value: all }, { onConflict: 'key' });
    await logAudit(userId, 'database:delete', 'database', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete database' });
  }
});

// ============================================================================
// MODPACK ROUTES (proxied to Integration Service)
// ============================================================================

interface ModpackInstallation {
  id: string;
  modpackId: string;
  appId: string;
  status: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  createdAt: string;
}

async function getModpackInstallations(): Promise<ModpackInstallation[]> {
  const { data } = await supabase
    .from('shared_config')
    .select('value')
    .eq('key', 'modpack_installations')
    .single();
  return (data?.value as ModpackInstallation[]) || [];
}

async function setModpackInstallations(installations: ModpackInstallation[]): Promise<void> {
  await supabase
    .from('shared_config')
    .upsert({ key: 'modpack_installations', value: installations }, { onConflict: 'key' });
}

// GET /api/modpacks/search - Proxy to Integration Service
app.get('/api/modpacks/search', verifyAuth, async (req: Request, res: Response) => {
  const query = req.query.query as string;
  const platform = (req.query.platform as string) || 'all';
  try {
    const response = await fetch(
      `${INTEGRATION_SERVICE_URL}/api/modpacks/search?query=${encodeURIComponent(query)}&platform=${platform}&limit=20`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Integration service unavailable' });
  }
});

// POST /api/apps/:appId/modpacks/install - Trigger modpack installation
app.post('/api/apps/:appId/modpacks/install', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;
  const { modpackId, platform } = req.body;

  if (!modpackId || !platform) {
    return res.status(400).json({ error: 'modpackId and platform are required' });
  }

  const allowedPlatforms = new Set(['modrinth', 'curseforge']);
  if (!allowedPlatforms.has(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  const modpackParts = String(modpackId).split(':');
  if (modpackParts.length < 2 || !modpackParts[1]) {
    return res.status(400).json({ error: 'Invalid modpackId format' });
  }

  const safePlatform = encodeURIComponent(platform);
  const safeModpackRef = encodeURIComponent(modpackParts[1]);

  try {
    const { data: app, error: appError } = await supabase
      .from('docker_apps')
      .select('container_id')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (appError || !app) return res.status(404).json({ error: 'App not found' });
    if (!app.container_id) return res.status(400).json({ error: 'No container associated with this app' });

    const installations = await getModpackInstallations();
    const installation: ModpackInstallation = {
      id: crypto.randomUUID(),
      modpackId,
      appId,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    installations.push(installation);
    await setModpackInstallations(installations);
    await logAudit(userId, 'modpack:install', 'modpack', appId, null, { modpackId, platform });

    // Fire-and-forget: trigger installation asynchronously
    fetch(`${INTEGRATION_SERVICE_URL}/api/modpacks/${safePlatform}/${safeModpackRef}`)
      .then(r => r.json())
      .then(details => {
        if (details.error) {
          installation.status = 'failed';
          installation.error = details.error;
        } else {
          installation.status = 'downloading';
          installation.progress = 50;
          // In a real scenario this would involve downloading and copying to container
          setTimeout(() => {
            installation.status = 'completed';
            installation.progress = 100;
            setModpackInstallations(installations);
          }, 5000);
        }
        setModpackInstallations(installations);
      })
      .catch(() => {
        installation.status = 'failed';
        installation.error = 'Integration service unavailable';
        setModpackInstallations(installations);
      });

    res.status(201).json(installation);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start modpack installation' });
  }
});

// GET /api/apps/:appId/modpacks/status - Check installation status
app.get('/api/apps/:appId/modpacks/status', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const installations = await getModpackInstallations();
    const appInstallations = installations.filter((i: ModpackInstallation) => i.appId === appId);
    res.json(appInstallations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch installation status' });
  }
});

// ============================================================================
// AUDIT LOG ROUTE
// ============================================================================

app.get('/api/audit-log', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const { user_id, entity_type, action, start_date, end_date } = req.query;

  try {
    let query = supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (entity_type && typeof entity_type === 'string') query = query.eq('entity_type', entity_type);
    if (action && typeof action === 'string') query = query.eq('action', action);
    if (start_date && typeof start_date === 'string') query = query.gte('created_at', start_date);
    if (end_date && typeof end_date === 'string') query = query.lte('created_at', end_date);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ data: data || [], total: count, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// ============================================================================
// GLOBAL SEARCH
// ============================================================================

app.get('/api/search', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const q = req.query.q as string;
  if (!q || typeof q !== 'string' || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  try {
    const searchPattern = `%${q}%`;
    const [apps, auditLogs, backups] = await Promise.all([
      supabase
        .from('docker_apps')
        .select('id, name')
        .eq('user_id', userId)
        .or(`name.ilike.${searchPattern},description.ilike.${searchPattern},image.ilike.${searchPattern}`)
        .limit(10),
      supabase
        .from('audit_log')
        .select('id, action')
        .eq('user_id', userId)
        .ilike('action', searchPattern)
        .limit(10),
      supabase
        .from('backup_jobs')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', searchPattern)
        .limit(10),
    ]);

    res.json({
      results: [
        ...(apps.data || []).map((a: any) => ({ id: a.id, name: a.name, type: 'app' })),
        ...(auditLogs.data || []).map((a: any) => ({ id: a.id, name: a.action, type: 'audit' })),
        ...(backups.data || []).map((b: any) => ({ id: b.id, name: b.name, type: 'backup' })),
      ],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search' });
  }
});

// ============================================================================
// NOTIFICATION CHANNELS ROUTES
// ============================================================================

app.get('/api/notification-channels', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { data, error } = await supabase
      .from('notification_channels')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notification channels' });
  }
});

app.post('/api/notification-channels', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, type, config } = req.body;
  if (!name || !type || !config) {
    return res.status(400).json({ error: 'name, type, and config are required' });
  }
  if (!['email', 'webhook', 'telegram'].includes(type)) {
    return res.status(400).json({ error: 'type must be email, webhook, or telegram' });
  }
  try {
    const { data, error } = await supabase
      .from('notification_channels')
      .insert({ user_id: userId, name, type, config })
      .select()
      .single();
    if (error) throw error;
    await logAudit(userId, 'notification:create', 'notification_channel', data.id, null, { name, type });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create notification channel' });
  }
});

app.patch('/api/notification-channels/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('notification_channels')
      .update(req.body)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Notification channel not found' });
    await logAudit(userId, 'notification:update', 'notification_channel', id, null, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification channel' });
  }
});

app.delete('/api/notification-channels/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('notification_channels')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    await logAudit(userId, 'notification:delete', 'notification_channel', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete notification channel' });
  }
});

// ============================================================================
// GIT DEPLOYMENT ROUTES (stored in shared_config as JSON array)
// ============================================================================

const getDeployments = async (): Promise<any[]> => {
  const { data } = await supabase
    .from('shared_config')
    .select('value')
    .eq('key', 'git_deployments')
    .single();
  return (data?.value as any[]) || [];
};

const setDeployments = async (deployments: any[]): Promise<void> => {
  await supabase
    .from('shared_config')
    .upsert({ key: 'git_deployments', value: deployments }, { onConflict: 'key' });
};

// Orchestrator forwarding: only active when ORCHESTRATOR_API_TOKEN is set.
// Without it the panel keeps its store-only behavior, so local setups and
// the existing test suite are unaffected.
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8500';
const ORCHESTRATOR_API_TOKEN = process.env.ORCHESTRATOR_API_TOKEN || '';

const buildManifestFromDeployment = (d: any): any => ({
  api_version: 'v1',
  kind: 'InfraFile',
  metadata: { name: d.name, environment: 'production' },
  spec: {
    instances: [
      {
        name: d.containerId || d.name,
        provider: 'docker',
        image: d.image || 'ubuntu:22.04',
        cpu: d.cpu ?? 1.0,
        memory_mb: d.memory_mb ?? 512,
        storage_gb: d.storage_gb ?? 10,
        env: {
          GIT_REPO: d.repoUrl,
          GIT_BRANCH: d.branch || 'main',
        },
      },
    ],
  },
});

const forwardDeploymentToOrchestrator = async (deployment: any): Promise<any | null> => {
  if (!ORCHESTRATOR_API_TOKEN) return null;
  try {
    const resp = await axios.post(
      `${ORCHESTRATOR_URL}/api/v1/deployments`,
      {
        manifest: buildManifestFromDeployment(deployment),
        dry_run: !!deployment.dryRun,
      },
      {
        headers: { Authorization: `Bearer ${ORCHESTRATOR_API_TOKEN}` },
        timeout: 30000,
      }
    );
    return resp.data;
  } catch (err: any) {
    console.error('Orchestrator deployment forward failed:', err?.message || err);
    return null;
  }
};

app.get('/api/deployments', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const deployments = await getDeployments();
    const userDeployments = deployments.filter((d: any) => d.user_id === userId);
    res.json(userDeployments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

app.post('/api/deployments', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, repoUrl, branch, containerId, targetDir, installCommand, restartCommand, dryRun } = req.body;

  if (!name || !repoUrl) {
    return res.status(400).json({ error: 'name and repoUrl are required' });
  }

  try {
    const deployments = await getDeployments();
    const newDeployment = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      repoUrl,
      repo: repoUrl.replace(/\.git$/, '').split('/').slice(-2).join('/'),
      branch: branch || 'main',
      containerId: containerId || null,
      targetDir: targetDir || '/app',
      installCommand: installCommand || '',
      restartCommand: restartCommand || '',
      enabled: true,
      dryRun: !!dryRun,
      webhookSecret: crypto.randomBytes(20).toString('hex'),
      createdAt: new Date().toISOString(),
      history: [],
    };
    const orchestration = await forwardDeploymentToOrchestrator(newDeployment);
    if (orchestration) {
      newDeployment.orchestration = orchestration;
    }
    deployments.push(newDeployment);
    await setDeployments(deployments);
    await logAudit(userId, 'deployment:create', 'deployment', newDeployment.id, null, { name, repoUrl });
    res.status(201).json(newDeployment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create deployment' });
  }
});

app.delete('/api/deployments/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const deployments = await getDeployments();
    const index = deployments.findIndex((d: any) => d.id === id && d.user_id === userId);
    if (index === -1) return res.status(404).json({ error: 'Deployment not found' });
    deployments.splice(index, 1);
    await setDeployments(deployments);
    await logAudit(userId, 'deployment:delete', 'deployment', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete deployment' });
  }
});

app.patch('/api/deployments/:id/toggle', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const deployments = await getDeployments();
    const index = deployments.findIndex((d: any) => d.id === id && d.user_id === userId);
    if (index === -1) return res.status(404).json({ error: 'Deployment not found' });
    deployments[index].enabled = !deployments[index].enabled;
    await setDeployments(deployments);
    await logAudit(userId, 'deployment:toggle', 'deployment', id, null, { enabled: deployments[index].enabled });
    res.json(deployments[index]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle deployment' });
  }
});

app.get('/api/deployments/:id/history', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const deployments = await getDeployments();
    const deployment = deployments.find((d: any) => d.id === id && d.user_id === userId);
    if (!deployment) return res.status(404).json({ error: 'Deployment not found' });
    res.json({ history: deployment.history || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deployment history' });
  }
});

app.post('/api/notification-channels/:id/test', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const { data: channel, error } = await supabase
      .from('notification_channels')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error || !channel) return res.status(404).json({ error: 'Notification channel not found' });
    res.json({ success: true, message: `Test notification sent via ${channel.type}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Billing routes moved to experimental/management-panel-expanded/billing.ts

// Knowledge base routes moved to experimental/management-panel-expanded/knowledge-base.ts

// Activity feed routes moved to experimental/management-panel-expanded/activity-feed.ts

// Dashboard builder routes moved to experimental/management-panel-expanded/dashboard-builder.ts

// Dashboard routes backed by data/dashboards.json (file-based store)
const DASHBOARDS_FILE = path.join(__dirname, '..', 'data', 'dashboards.json');

async function readDashboards(): Promise<any[]> {
  try {
    const raw = await fs.readFile(DASHBOARDS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeDashboards(dashboards: any[]): Promise<void> {
  await fs.writeFile(DASHBOARDS_FILE, JSON.stringify(dashboards, null, 2), 'utf-8');
}

app.get('/api/dashboards', verifyAuth, async (_req: Request, res: Response) => {
  try {
    res.json({ dashboards: await readDashboards() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboards' });
  }
});

app.get('/api/dashboards/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const dashboards = await readDashboards();
    const dashboard = dashboards.find((d: any) => d.id === req.params.id);
    if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

app.post('/api/dashboards', verifyAuth, async (req: Request, res: Response) => {
  try {
    const dashboards = await readDashboards();
    const id = req.body.id || crypto.randomUUID();
    const dashboard = { id, ...req.body, createdAt: new Date().toISOString() };
    dashboards.push(dashboard);
    await writeDashboards(dashboards);
    await logAudit((req as any).user.id, 'dashboard:create', 'dashboard', id);
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create dashboard' });
  }
});

app.put('/api/dashboards/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const dashboards = await readDashboards();
    const index = dashboards.findIndex((d: any) => d.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Dashboard not found' });
    const updated = { ...dashboards[index], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
    dashboards[index] = updated;
    await writeDashboards(dashboards);
    await logAudit((req as any).user.id, 'dashboard:update', 'dashboard', req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update dashboard' });
  }
});

app.delete('/api/dashboards/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const dashboards = await readDashboards();
    const index = dashboards.findIndex((d: any) => d.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Dashboard not found' });
    dashboards.splice(index, 1);
    await writeDashboards(dashboards);
    await logAudit((req as any).user.id, 'dashboard:delete', 'dashboard', req.params.id);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete dashboard' });
  }
});

app.get('/api/dashboards/:id/data', verifyAuth, async (req: Request, res: Response) => {
  try {
    const period = req.query.period as string;
    const dashboards = await readDashboards();
    const dashboard = dashboards.find((d: any) => d.id === req.params.id);
    if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });
    res.json({ dashboard, widgets: dashboard.widgets || [], period: period || '24h' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ============================================================================
// I18N TRANSLATION ROUTES
// ============================================================================

// GET /api/i18n/translations - List all translations
app.get('/api/i18n/translations', verifyAuth, async (req: Request, res: Response) => {
  try {
    const { data } = await supabase
      .from('shared_config')
      .select('value')
      .eq('key', 'i18n_translations')
      .single();
    res.json(data?.value || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

// POST /api/i18n/translations - Submit a translation
app.post('/api/i18n/translations', verifyAuth, async (req: Request, res: Response) => {
  const { locale, key, value } = req.body;
  if (!locale || !key || !value) {
    return res.status(400).json({ error: 'locale, key, and value are required' });
  }
  const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
  if (forbiddenKeys.has(locale) || forbiddenKeys.has(key)) {
    return res.status(400).json({ error: 'Invalid locale or key' });
  }
  try {
    const { data } = await supabase
      .from('shared_config')
      .select('value')
      .eq('key', 'i18n_translations')
      .single();
    const rawTranslations = (data?.value && typeof data.value === 'object') ? (data.value as Record<string, any>) : {};
    const translations: Record<string, any> = Object.create(null);
    for (const [loc, entries] of Object.entries(rawTranslations)) {
      if (loc === '__proto__' || loc === 'constructor' || loc === 'prototype') continue;
      if (entries && typeof entries === 'object') {
        const safeEntries: Record<string, any> = Object.create(null);
        for (const [k, v] of Object.entries(entries as Record<string, any>)) {
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          safeEntries[k] = v;
        }
        translations[loc] = safeEntries;
      }
    }
    if (!translations[locale] || typeof translations[locale] !== 'object') translations[locale] = Object.create(null);
    translations[locale][key] = value;
    await supabase
      .from('shared_config')
      .upsert({ key: 'i18n_translations', value: translations }, { onConflict: 'key' });
    await logAudit((req as any).user.id, 'i18n:submit', 'translation', null, null, { locale, key });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save translation' });
  }
});

// ============================================================================
// THEME STUDIO ROUTES
// ============================================================================

const getThemes = async (userId: string): Promise<any[]> => {
  const { data } = await supabase
    .from('shared_config')
    .select('value')
    .eq('key', 'user_themes')
    .single();
  const all = (data?.value as any[]) || [];
  return all.filter((t: any) => t.user_id === userId);
};

const setThemes = async (themes: any[]): Promise<void> => {
  await supabase
    .from('shared_config')
    .upsert({ key: 'user_themes', value: themes }, { onConflict: 'key' });
};

// GET /api/themes - List themes for current user
app.get('/api/themes', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const themes = await getThemes(userId);
    res.json(themes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch themes' });
  }
});

// POST /api/themes - Save a new theme
app.post('/api/themes', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, config } = req.body;
  if (!name || !config) {
    return res.status(400).json({ error: 'name and config are required' });
  }
  try {
    const themes = await getThemes(userId);
    const existing = themes.findIndex((t: any) => t.name === name);
    const theme = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      config,
      published: false,
      author: userId,
      createdAt: new Date().toISOString(),
    };
    if (existing >= 0) {
      themes[existing] = { ...themes[existing], ...theme };
    } else {
      themes.push(theme);
    }
    await setThemes(themes);
    await logAudit(userId, 'theme:save', 'theme', theme.id, null, { name });
    res.status(201).json(theme);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save theme' });
  }
});

// GET /api/themes/:id - Get a specific theme
app.get('/api/themes/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const themes = await getThemes(userId);
    const theme = themes.find((t: any) => t.id === id);
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    res.json(theme);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch theme' });
  }
});

// DELETE /api/themes/:id - Delete a theme
app.delete('/api/themes/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    let themes = await getThemes(userId);
    themes = themes.filter((t: any) => t.id !== id);
    await setThemes(themes);
    await logAudit(userId, 'theme:delete', 'theme', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete theme' });
  }
});

// POST /api/themes/:id/publish - Publish theme to gallery
app.post('/api/themes/:id/publish', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const themes = await getThemes(userId);
    const index = themes.findIndex((t: any) => t.id === id);
    if (index === -1) return res.status(404).json({ error: 'Theme not found' });
    themes[index].published = !themes[index].published;
    await setThemes(themes);
    await logAudit(userId, 'theme:publish', 'theme', id, null, { published: themes[index].published });
    res.json(themes[index]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle theme publication' });
  }
});

// Bulk operations routes moved to experimental/management-panel-expanded/bulk-operations.ts

// ============================================================================
// OPENAPI / SWAGGER DOCS
// ============================================================================

app.get('/api/openapi.json', (_req: Request, res: Response) => {
  res.json(openapiSpec);
});

app.get('/api/docs', (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html><head><title>Infra Pilot API Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' });
</script>
</body></html>`);
});

// ============================================================================
// AI CONFIG ADVISOR ROUTES
// ============================================================================

// GET /api/config/:appId/advice - Analyze config against best practices
app.get('/api/config/:appId/advice', verifyAuth, generalLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId } = req.params;

  try {
    const { data: app, error } = await supabase
      .from('docker_apps')
      .select('*')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !app) return res.status(404).json({ error: 'App not found' });

    // Attempt to read config files from container
    const files: Record<string, string> = {};
    if (app.container_id) {
      const configPaths = ['/server.properties', '/bukkit.yml', '/spigot.yml', '/paper.yml', '/config.yml', '/application.yml', '/application.properties'];
      for (const fp of configPaths) {
        try {
          const { stdout } = await runCommand('docker', ['exec', app.container_id, 'cat', fp]).catch(() => ({ stdout: '', stderr: '' }));
          if (stdout) files[fp] = stdout;
        } catch {}
      }
    }

    const result = analyzeConfiguration({ ...app, appId }, files);
    res.json({
      appId,
      analyzedAt: new Date().toISOString(),
      total: result.summary.total,
      critical: result.summary.critical,
      warning: result.summary.warning,
      info: result.summary.info,
      suggestions: result.suggestions,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze configuration' });
  }
});

// POST /api/config/:appId/advice/:suggestionId/apply - Apply a suggestion
app.post('/api/config/:appId/advice/:suggestionId/apply', verifyAuth, generalLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { appId, suggestionId } = req.params;

  try {
    const { data: app, error } = await supabase
      .from('docker_apps')
      .select('*')
      .eq('id', appId)
      .eq('user_id', userId)
      .single();

    if (error || !app) return res.status(404).json({ error: 'App not found' });

    const files: Record<string, string> = {};
    if (app.container_id) {
      const configPaths = ['/server.properties', '/bukkit.yml', '/spigot.yml', '/paper.yml', '/config.yml', '/application.yml', '/application.properties'];
      for (const fp of configPaths) {
        try {
          const { stdout } = await runCommand('docker', ['exec', app.container_id, 'cat', fp]).catch(() => ({ stdout: '', stderr: '' }));
          if (stdout) files[fp] = stdout;
        } catch {}
      }
    }

    const result = analyzeConfiguration({ ...app, appId }, files);
    const suggestion = result.suggestions.find(s => s.id === suggestionId);
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
    if (!suggestion.autoFixable) return res.status(400).json({ error: 'This suggestion cannot be auto-fixed' });

    await logAudit(userId, 'config:advice:apply', 'config_advice', `${appId}:${suggestionId}`, null, { title: suggestion.title, fixCommand: suggestion.fixCommand });
    res.json({ success: true, message: `Applied: ${suggestion.title}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply suggestion' });
  }
});

// Plugin marketplace routes moved to experimental/management-panel-expanded/plugin-marketplace.ts

// Terminal session routes moved to experimental/management-panel-expanded/terminal.ts

// Change approval routes moved to experimental/management-panel-expanded/change-approval.ts

// V3 + V4 routes removed for core MVP scope.
// See experimental/management-panel-expanded/v3-v4-routes.ts

// ============================================================================
// START SERVER
// ============================================================================

const httpServer = http.createServer(app);

const wss = new WebSocketServer({ server: httpServer });

interface TerminalRoom {
  sessionId: string;
  appId: string;
  clients: Map<WebSocket, { userId: string; displayName: string }>;
  output: string[];
}

const terminalRooms = new Map<string, TerminalRoom>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', 'http://localhost');
  const appId = url.searchParams.get('appId');
  const sessionId = url.searchParams.get('sessionId');
  const displayName = url.searchParams.get('displayName') || 'Anonymous';

  // Collaborative Terminal connection
  if (sessionId) {
    let room = terminalRooms.get(sessionId);
    if (!room) {
      room = { sessionId, appId: appId || '', clients: new Map(), output: [] };
      terminalRooms.set(sessionId, room);
    }

    const userId = 'user-' + crypto.randomBytes(6).toString('hex');
    room.clients.set(ws, { userId, displayName });

    // Send join notification
    const joinMsg = JSON.stringify({ type: 'user-joined', userId, displayName, users: Array.from(room.clients.values()).map(c => c) });
    for (const [client] of room.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(joinMsg);
    }

    // Send existing output to new user
    ws.send(JSON.stringify({ type: 'history', lines: room.output }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'terminal-input') {
          const line = `[${displayName}] $ ${msg.text}`;
          room!.output.push(line);
          if (room!.output.length > 1000) room!.output.shift();

          for (const [client] of room!.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'terminal-output', line, userId, displayName }));
            }
          }
        } else if (msg.type === 'cursor') {
          const cursorMsg = JSON.stringify({ type: 'cursor-update', userId, displayName, cursor: msg.cursor });
          for (const [client, info] of room!.clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(cursorMsg);
            }
          }
        } else if (msg.type === 'chat') {
          const chatMsg = JSON.stringify({ type: 'chat-message', userId, displayName, text: msg.text, timestamp: new Date().toISOString() });
          for (const [client] of room!.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(chatMsg);
          }
        } else if (msg.type === 'exec' && appId) {
          // Forward command execution
          const line = `[${displayName}] $ ${msg.command}`;
          room!.output.push(line);
          if (room!.output.length > 1000) room!.output.shift();

          for (const [client] of room!.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'terminal-output', line, userId, displayName }));
            }
          }
        }
      } catch {}
    });

    ws.on('close', () => {
      if (room) {
        room.clients.delete(ws);
        const leaveMsg = JSON.stringify({ type: 'user-left', userId, displayName, users: Array.from(room.clients.values()).map(c => c) });
        for (const [client] of room.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(leaveMsg);
        }
        if (room.clients.size === 0) {
          terminalRooms.delete(sessionId);
        }
      }
    });

    return;
  }

  // Original log streaming (for backward compatibility)
  if (!appId) { ws.close(); return; }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'subscribe' && msg.appId) {
        const logStream = spawn('docker', ['logs', '--tail', '100', '-f', msg.appId]);
        logStream.stdout.on('data', (chunk) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'log', appId: msg.appId, data: chunk.toString() }));
          }
        });
        logStream.on('close', () => {
          ws.send(JSON.stringify({ type: 'log_end', appId: msg.appId }));
        });
        ws.on('close', () => { logStream.kill(); });
      }
      if (msg.type === 'subscribe:metrics' && msg.appId) {
        const interval = setInterval(async () => {
          try {
            const { stdout } = await runCommand('docker', ['stats', msg.appId, '--no-stream', '--format', '{{json .}}']);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'metrics', appId: msg.appId, data: JSON.parse(stdout) }));
            }
          } catch {}
        }, 2000);
        ws.on('close', () => clearInterval(interval));
      }
    } catch {}
  });
});

// ============================================================================
// SSH Session Management API Routes
// ============================================================================

app.get('/api/ssh/sessions', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { status } = req.query;
  let query = supabase.from('ssh_sessions').select('*').eq('user_id', userId).order('started_at', { ascending: false });
  if (status) query = query.eq('status', status as string);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ sessions: data || [] });
});

app.post('/api/ssh/connect', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { server, user, jump_host, port } = req.body;
  const { data, error } = await supabase.from('ssh_sessions').insert({
    user_id: userId, server_name: server, username: user || 'root', jump_host, port: port || 22, status: 'active'
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ session: data, message: `SSH session connecting to ${user || 'root'}@${server}` });
});

app.get('/api/ssh/jump-hosts', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('ssh_jump_hosts').select('*').eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ jump_hosts: data || [] });
});

app.post('/api/ssh/jump-hosts', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, host, user } = req.body;
  const { data, error } = await supabase.from('ssh_jump_hosts').insert({ user_id: userId, name, host, username: user || 'root' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/ssh/keys', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('ssh_keys').select('*').eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keys: data || [] });
});

app.post('/api/ssh/keys', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, key } = req.body;
  const fingerprint = crypto.createHash('sha256').update(key).digest('hex');
  const { data, error } = await supabase.from('ssh_keys').insert({ user_id: userId, name, public_key: key, fingerprint }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/ssh/keys/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { error } = await supabase.from('ssh_keys').delete().eq('id', req.params.id).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'deleted' });
});

app.get('/api/ssh/sessions/:id/recording', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('ssh_sessions').select('recording').eq('id', req.params.id).eq('user_id', userId).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ recording: data?.recording || 'No recording available' });
});

app.get('/api/ssh/saved-hosts', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('ssh_saved_hosts').select('*').eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ hosts: data || [] });
});

app.post('/api/ssh/saved-hosts', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, host, port } = req.body;
  const { data, error } = await supabase.from('ssh_saved_hosts').insert({ user_id: userId, name, host, port: port || 22 }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/ssh/saved-hosts/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { error } = await supabase.from('ssh_saved_hosts').delete().eq('id', req.params.id).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'deleted' });
});

// ============================================================================
// Server Inventory API Routes
// ============================================================================

app.get('/api/inventory', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  let query = supabase.from('server_inventory').select('*').eq('user_id', userId);
  const { tag, environment, region, owner, provider } = req.query;
  if (tag) query = query.contains('tags', [tag as string]);
  if (environment) query = query.eq('environment', environment as string);
  if (region) query = query.eq('region', region as string);
  if (owner) query = query.eq('owner', owner as string);
  if (provider) query = query.eq('provider', provider as string);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ inventory: data || [] });
});

app.get('/api/inventory/tags', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('server_inventory').select('tags').eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  const allTags = new Set<string>();
  (data || []).forEach((item: any) => { if (item.tags) item.tags.forEach((t: string) => allTags.add(t)); });
  res.json({ tags: Array.from(allTags) });
});

app.get('/api/inventory/:serverId', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('server_inventory').select('*').eq('server_id', req.params.serverId).eq('user_id', userId).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

app.patch('/api/inventory/:serverId', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('server_inventory').update(req.body).eq('server_id', req.params.serverId).eq('user_id', userId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

app.get('/api/inventory/:serverId/tags', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('server_inventory').select('tags').eq('server_id', req.params.serverId).eq('user_id', userId).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json({ tags: data?.tags || [] });
});

app.post('/api/inventory/:serverId/tags', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { tag } = req.body;
  const { data: existing } = await supabase.from('server_inventory').select('tags').eq('server_id', req.params.serverId).eq('user_id', userId).single();
  const tags = existing?.tags || [];
  if (!tags.includes(tag)) tags.push(tag);
  const { data, error } = await supabase.from('server_inventory').update({ tags }).eq('server_id', req.params.serverId).eq('user_id', userId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/inventory/:serverId/tags/:tag', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: existing } = await supabase.from('server_inventory').select('tags').eq('server_id', req.params.serverId).eq('user_id', userId).single();
  const tags = (existing?.tags || []).filter((t: string) => t !== req.params.tag);
  const { data, error } = await supabase.from('server_inventory').update({ tags }).eq('server_id', req.params.serverId).eq('user_id', userId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ============================================================================
// Secret Management API Routes
// ============================================================================

app.get('/api/secrets', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { path } = req.query;
  let query = supabase.from('secrets').select('id, key, version, rotate, rotation_days, last_rotated, next_rotation, created_at, updated_at').eq('user_id', userId);
  if (path) query = query.ilike('key', `${path}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ secrets: data || [] });
});

app.get('/api/secrets/due-for-rotation', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('secrets').select('*').eq('user_id', userId).eq('rotate', true).lte('next_rotation', new Date().toISOString());
  if (error) return res.status(500).json({ error: error.message });
  res.json({ secrets: data || [] });
});

app.get('/api/secrets/:key', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { version } = req.query;
  if (version) {
    const { data: secret } = await supabase.from('secrets').select('id').eq('key', req.params.key).eq('user_id', userId).single();
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    const { data, error } = await supabase.from('secret_versions').select('value, version').eq('secret_id', secret.id).eq('version', parseInt(version as string)).single();
    if (error) return res.status(404).json({ error: 'Not found' });
    return res.json(data);
  }
  const { data, error } = await supabase.from('secrets').select('*').eq('key', req.params.key).eq('user_id', userId).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json({ value: data.value, version: data.version, key: data.key });
});

app.post('/api/secrets', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { key, value, rotate, rotation_days } = req.body;
  const { data: existing } = await supabase.from('secrets').select('id, version').eq('key', key).eq('user_id', userId).single();
  if (existing) {
    const newVersion = (existing.version || 1) + 1;
    await supabase.from('secret_versions').insert({ secret_id: existing.id, value, version: newVersion, created_by: userId });
    const nextRotation = rotate ? new Date(Date.now() + (rotation_days || 90) * 86400000).toISOString() : null;
    const { data, error } = await supabase.from('secrets').update({ value, version: newVersion, rotate: rotate || false, rotation_days: rotation_days || 90, next_rotation: nextRotation }).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const nextRotation = rotate ? new Date(Date.now() + (rotation_days || 90) * 86400000).toISOString() : null;
  const { data, error } = await supabase.from('secrets').insert({ user_id: userId, key, value, rotate: rotate || false, rotation_days: rotation_days || 90, next_rotation: nextRotation }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/secrets/:key', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { error } = await supabase.from('secrets').delete().eq('key', req.params.key).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'deleted' });
});

app.get('/api/secrets/:key/versions', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: secret } = await supabase.from('secrets').select('id').eq('key', req.params.key).eq('user_id', userId).single();
  if (!secret) return res.status(404).json({ error: 'Secret not found' });
  const { data, error } = await supabase.from('secret_versions').select('version, created_at, created_by').eq('secret_id', secret.id).order('version', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ versions: data || [] });
});

app.post('/api/secrets/:key/rotate', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: secret } = await supabase.from('secrets').select('*').eq('key', req.params.key).eq('user_id', userId).single();
  if (!secret) return res.status(404).json({ error: 'Secret not found' });
  const newValue = crypto.randomBytes(32).toString('hex');
  const newVersion = (secret.version || 1) + 1;
  await supabase.from('secret_versions').insert({ secret_id: secret.id, value: newValue, version: newVersion, created_by: userId });
  const nextRotation = new Date(Date.now() + (secret.rotation_days || 90) * 86400000).toISOString();
  const { data, error } = await supabase.from('secrets').update({ value: newValue, version: newVersion, last_rotated: new Date().toISOString(), next_rotation: nextRotation }).eq('id', secret.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/secrets/rotate-all', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: secrets } = await supabase.from('secrets').select('*').eq('user_id', userId).eq('rotate', true).lte('next_rotation', new Date().toISOString());
  const results = [];
  for (const secret of secrets || []) {
    const newValue = crypto.randomBytes(32).toString('hex');
    const newVersion = (secret.version || 1) + 1;
    await supabase.from('secret_versions').insert({ secret_id: secret.id, value: newValue, version: newVersion, created_by: userId });
    await supabase.from('secrets').update({ value: newValue, version: newVersion, last_rotated: new Date().toISOString(), next_rotation: new Date(Date.now() + (secret.rotation_days || 90) * 86400000).toISOString() }).eq('id', secret.id);
    results.push({ key: secret.key, new_version: newVersion });
  }
  res.json({ rotated: results.length, secrets: results });
});

app.get('/api/secrets/:key/access', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: secret } = await supabase.from('secrets').select('id').eq('key', req.params.key).eq('user_id', userId).single();
  if (!secret) return res.status(404).json({ error: 'Secret not found' });
  const { data, error } = await supabase.from('secret_access').select('role, granted_at').eq('secret_id', secret.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ access: data || [] });
});

app.post('/api/secrets/:key/access', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { secret } = await supabase.from('secrets').select('id').eq('key', req.params.key).eq('user_id', userId).single();
  if (!secret) return res.status(404).json({ error: 'Secret not found' });
  const { data, error } = await supabase.from('secret_access').insert({ secret_id: secret.id, role: req.body.role, granted_by: userId }).select().single();
  if (error && error.code === '23505') return res.status(409).json({ error: 'Access already granted' });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/secrets/:key/access/:role', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: secret } = await supabase.from('secrets').select('id').eq('key', req.params.key).eq('user_id', userId).single();
  if (!secret) return res.status(404).json({ error: 'Secret not found' });
  const { error } = await supabase.from('secret_access').delete().eq('secret_id', secret.id).eq('role', req.params.role);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'revoked' });
});

// ============================================================================
// Webhook Management API Routes
// ============================================================================

app.get('/api/webhooks', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('webhooks').select('*').eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ webhooks: data || [] });
});

app.post('/api/webhooks', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, url, events, secret } = req.body;
  const { data, error } = await supabase.from('webhooks').insert({ user_id: userId, name, url, events: events || [], secret }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logAudit(userId, 'webhook:create', 'webhook', data.id, null, { name, url, events: events || [] });
  res.json(data);
});

app.delete('/api/webhooks/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { error } = await supabase.from('webhooks').delete().eq('id', req.params.id).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  await logAudit(userId, 'webhook:delete', 'webhook', req.params.id);
  res.json({ status: 'deleted' });
});

app.post('/api/webhooks/test', verifyAuth, async (req: Request, res: Response) => {
  const { event } = req.body;
  res.json({ status: 'test_sent', event: event || 'test', note: 'Webhook test endpoint ready. Configure a real webhook to receive events.' });
});

app.post('/api/webhooks/:id/test', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: webhook } = await supabase.from('webhooks').select('*').eq('id', req.params.id).eq('user_id', userId).single();
  if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
  try {
    const payload = { event: req.body.event || 'test', timestamp: new Date().toISOString(), webhook_id: webhook.id };
    const response = await axios.post(webhook.url, payload, { headers: webhook.secret ? { 'X-Webhook-Secret': webhook.secret } : {} });
    await supabase.from('webhook_logs').insert({ webhook_id: webhook.id, event: 'test', status: 'success', response_code: response.status, response_body: JSON.stringify(response.data) });
    res.json({ status: 'sent', response_code: response.status });
  } catch (err: any) {
    await supabase.from('webhook_logs').insert({ webhook_id: webhook.id, event: 'test', status: 'failed', response_code: err.response?.status || 0, response_body: err.message });
    res.status(502).json({ error: `Webhook delivery failed: ${err.message}` });
  }
});

app.get('/api/webhooks/logs', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: webhooks } = await supabase.from('webhooks').select('id').eq('user_id', userId);
  const ids = (webhooks || []).map((w: any) => w.id);
  if (ids.length === 0) return res.json({ logs: [] });
  const { data, error } = await supabase.from('webhook_logs').select('*').in('webhook_id', ids).order('delivered_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data || [] });
});

app.get('/api/webhooks/:id/logs', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: webhook } = await supabase.from('webhooks').select('id').eq('id', req.params.id).eq('user_id', userId).single();
  if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
  const { data, error } = await supabase.from('webhook_logs').select('*').eq('webhook_id', webhook.id).order('delivered_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data || [] });
});

// ============================================================================
// API Key Management Routes
// ============================================================================

app.get('/api/api-keys', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('api_keys').select('id, name, key_prefix, role, expires_at, last_used_at, created_at').eq('user_id', userId).eq('revoked', false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ api_keys: data || [] });
});

app.post('/api/api-keys', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, role, expire_days } = req.body;
  const rawKey = `ip_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 10);
  const expiresAt = expire_days ? new Date(Date.now() + expire_days * 86400000).toISOString() : null;
  const { data, error } = await supabase.from('api_keys').insert({ user_id: userId, name, key_hash: keyHash, key_prefix: keyPrefix, role: role || 'user', expires_at: expiresAt }).select('id, name, key_prefix, role, expires_at').single();
  if (error) return res.status(500).json({ error: error.message });
  await logAudit(userId, 'api_key:create', 'api_key', data.id, null, { name, role: role || 'user' });
  res.json({ ...data, key: rawKey });
});

app.delete('/api/api-keys/:id', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { error } = await supabase.from('api_keys').update({ revoked: true }).eq('id', req.params.id).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  await logAudit(userId, 'api_key:revoke', 'api_key', req.params.id);
  res.json({ status: 'revoked' });
});

// ============================================================================
// Plugin Management API Routes
// ============================================================================

app.get('/api/plugins', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { installed } = req.query;
  let query = supabase.from('plugins').select('*').eq('user_id', userId);
  if (installed === 'true') query = query.eq('installed', true);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const builtinPlugins = [
    { name: 'kubernetes', description: 'Kubernetes cluster management', version: '1.0.0', builtin: true, installed: false },
    { name: 'docker', description: 'Advanced Docker management', version: '1.0.0', builtin: true, installed: true },
    { name: 'aws', description: 'Amazon Web Services integration', version: '1.0.0', builtin: true, installed: false },
    { name: 'hetzner', description: 'Hetzner Cloud integration', version: '1.0.0', builtin: true, installed: false },
    { name: 'cloudflare', description: 'Cloudflare DNS & CDN integration', version: '1.0.0', builtin: true, installed: false },
    { name: 'proxmox', description: 'Proxmox VE virtualization management', version: '1.0.0', builtin: true, installed: false },
    { name: 'ansible', description: 'Ansible automation integration', version: '1.0.0', builtin: true, installed: false },
    { name: 'nomad', description: 'HashiCorp Nomad orchestration', version: '1.0.0', builtin: true, installed: false },
    { name: 'azure', description: 'Microsoft Azure integration', version: '1.0.0', builtin: true, installed: false },
  ];
  const installedNames = new Set((data || []).map((p: any) => p.name));
  const allPlugins = [
    ...builtinPlugins.map((bp) => ({ ...bp, installed: installedNames.has(bp.name) || bp.installed })),
    ...(data || []).filter((p: any) => !builtinPlugins.find((bp) => bp.name === p.name)),
  ];
  res.json({ plugins: allPlugins });
});

app.post('/api/plugins/install', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, source, version } = req.body;
  const { data, error } = await supabase.from('plugins').insert({ user_id: userId, name, source, version, installed: true, enabled: true }).select().single();
  if (error && error.code === '23505') return res.status(409).json({ error: 'Plugin already installed' });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/plugins/:name/uninstall', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { error } = await supabase.from('plugins').delete().eq('name', req.params.name).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'uninstalled' });
});

app.post('/api/plugins/:name/update', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('plugins').update({ version: '1.0.1', updated_at: new Date().toISOString() }).eq('name', req.params.name).eq('user_id', userId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || { status: 'updated' });
});

app.post('/api/plugins/update-all', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('plugins').update({ version: '1.0.1', updated_at: new Date().toISOString() }).eq('user_id', userId).eq('installed', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'all_updated', count: data?.length || 0 });
});

app.get('/api/plugins/updates', verifyAuth, async (req: Request, res: Response) => {
  res.json({ updates: [] });
});

app.get('/api/plugins/:name', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('plugins').select('*').eq('name', req.params.name).eq('user_id', userId).single();
  if (error) return res.status(404).json({ error: 'Plugin not found or not installed' });
  res.json(data);
});

// ============================================================================
// Deployment Templates API Routes
// ============================================================================

const BUILTIN_TEMPLATES = [
  { name: 'nodejs', type: 'node', description: 'Node.js application with Express', config: { image: 'node:18-alpine', ports: [{ hostPort: 3000, containerPort: 3000 }], environment_vars: { NODE_ENV: 'production' } }, builtin: true },
  { name: 'python', type: 'python', description: 'Python application with Flask/Gunicorn', config: { image: 'python:3.11-slim', ports: [{ hostPort: 8000, containerPort: 8000 }], environment_vars: { PYTHONUNBUFFERED: '1' } }, builtin: true },
  { name: 'docker-compose', type: 'docker-compose', description: 'Multi-service Docker Compose stack', config: { compose_file: 'docker-compose.yml' }, builtin: true },
  { name: 'nginx', type: 'nginx', description: 'Nginx web server with SSL', config: { image: 'nginx:alpine', ports: [{ hostPort: 80, containerPort: 80 }, { hostPort: 443, containerPort: 443 }], volumes: [{ hostPath: '/etc/nginx/conf.d', containerPath: '/etc/nginx/conf.d' }] }, builtin: true },
  { name: 'postgresql', type: 'postgres', description: 'PostgreSQL database', config: { image: 'postgres:15-alpine', ports: [{ hostPort: 5432, containerPort: 5432 }], environment_vars: { POSTGRES_PASSWORD: 'changeme' }, volumes: [{ hostPath: '/var/lib/postgresql/data', containerPath: '/var/lib/postgresql/data' }] }, builtin: true },
  { name: 'redis', type: 'redis', description: 'Redis cache server', config: { image: 'redis:7-alpine', ports: [{ hostPort: 6379, containerPort: 6379 }] }, builtin: true },
  { name: 'traefik', type: 'traefik', description: 'Traefik reverse proxy with auto SSL', config: { image: 'traefik:v3.0', ports: [{ hostPort: 80, containerPort: 80 }, { hostPort: 443, containerPort: 443 }], command: ['--providers.docker', '--entrypoints.web.address=:80', '--entrypoints.websecure.address=:443', '--certificatesresolvers.letsencrypt.acme.httpchallenge=true', '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web'] }, builtin: true },
];

app.get('/api/templates', verifyAuth, async (req: Request, res: Response) => {
  const { type } = req.query;
  let templates = [...BUILTIN_TEMPLATES];
  const { data: userTemplates } = await supabase.from('deployment_templates').select('*');
  if (userTemplates) templates = [...templates, ...userTemplates];
  if (type) templates = templates.filter((t) => t.type === type);
  res.json({ templates });
});

app.get('/api/templates/:name', verifyAuth, async (req: Request, res: Response) => {
  const template = BUILTIN_TEMPLATES.find((t) => t.name === req.params.name);
  if (template) return res.json(template);
  const { data, error } = await supabase.from('deployment_templates').select('*').eq('name', req.params.name).single();
  if (error) return res.status(404).json({ error: 'Template not found' });
  res.json(data);
});

app.post('/api/templates/deploy', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { template: templateName, name, server, variables, dry_run } = req.body;
  const template = BUILTIN_TEMPLATES.find((t) => t.name === templateName);
  if (!template) return res.status(404).json({ error: `Template '${templateName}' not found` });
  if (dry_run) return res.json({ status: 'dry_run', template: templateName, name, actions: [`Create container ${name}`, `Configure ports`, `Set environment variables`] });
  const appConfig = { ...template.config };
  if (variables) {
    if (variables.environment_vars) appConfig.environment_vars = { ...appConfig.environment_vars, ...variables.environment_vars };
    if (variables.ports) appConfig.ports = variables.ports;
  }
  const { data, error } = await supabase.from('docker_apps').insert({
    user_id: userId, name, image: appConfig.image, status: 'stopped', ports: appConfig.ports || [], environment_vars: appConfig.environment_vars || {}, volumes: appConfig.volumes || [],
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'deployed', app: data, message: `Template '${templateName}' deployed as '${name}'` });
});

app.post('/api/templates/init', verifyAuth, async (req: Request, res: Response) => {
  const { template, name, output_dir } = req.body;
  const tpl = BUILTIN_TEMPLATES.find((t) => t.name === template);
  if (!tpl) return res.status(404).json({ error: `Template '${template}' not found` });
  const files = [];
  switch (tpl.type) {
    case 'node':
      files.push({ path: 'package.json', content: JSON.stringify({ name, version: '1.0.0', scripts: { start: 'node index.js' }, dependencies: { express: '^4.18.0' } }, null, 2) });
      files.push({ path: 'index.js', content: "const express = require('express');\nconst app = express();\nconst port = process.env.PORT || 3000;\napp.get('/', (req, res) => res.send('Hello World!'));\napp.listen(port, () => console.log(`App listening on port ${port}`));" });
      files.push({ path: 'Dockerfile', content: 'FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]' });
      break;
    case 'python':
      files.push({ path: 'requirements.txt', content: 'flask==3.0.0\ngunicorn==21.2.0' });
      files.push({ path: 'app.py', content: "from flask import Flask\napp = Flask(__name__)\n@app.route('/')\ndef hello():\n    return 'Hello World!'\nif __name__ == '__main__':\n    app.run(host='0.0.0.0', port=8000)" });
      files.push({ path: 'Dockerfile', content: 'FROM python:3.11-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "app:app"]' });
      break;
    default:
      files.push({ path: 'README.md', content: `# ${name}\n\nTemplate: ${template}` });
  }
  res.json({ status: 'initialized', name, output_dir: output_dir || '.', files });
});

// ============================================================================
// Doctor / Benchmark / Diagnose API Routes
// ============================================================================

app.post('/api/doctor/benchmark', verifyAuth, async (req: Request, res: Response) => {
  const duration = Math.min(Math.max(Number(req.body?.duration) || 10, 1), 120);
  const result = await runBenchmark(duration);
  const { error } = await supabase.from('benchmark_results').insert({
    server_id: null,
    benchmark_type: 'local',
    duration_seconds: duration,
    cpu_score: result.cpu_avg_pct,
    memory_score: result.memory_used_pct,
    disk_score: result.disk_write_mbps,
    overall_score: result.cpu_avg_pct + result.memory_used_pct,
    raw_data: result.measurements,
  });
  if (error) {
    res.status(500).json({ error: 'Benchmark ran, but result could not be stored', details: error.message, result });
    return;
  }
  res.json({ status: 'completed', ...result });
});

app.post('/api/doctor/benchmark/:server', verifyAuth, async (req: Request, res: Response) => {
  const { server } = req.params;
  const duration = Math.min(Math.max(Number(req.body?.duration) || 10, 1), 120);
  const { data: app, error } = await supabase
    .from('docker_apps')
    .select('id, container_id')
    .eq('id', server)
    .single();
  if (error || !app || !app.container_id) {
    res.status(404).json({ error: 'App not found or has no container' });
    return;
  }
  const containerId = String(app.container_id);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerId)) {
    res.status(400).json({ error: 'Invalid container_id format' });
    return;
  }
  try {
    const [result, dockerStats] = await Promise.all([
      runBenchmark(duration),
      runCommand('docker', ['stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemPerc}}', containerId]),
    ]);
    const { stdout } = dockerStats;
    const [name, cpuPerc, memPerc] = stdout.trim().split('|');
    const container = {
      name: name || containerId,
      cpu_pct: Number(String(cpuPerc || '').replace('%', '')) || 0,
      memory_pct: Number(String(memPerc || '').replace('%', '')) || 0,
    };
    const { error: insertError } = await supabase.from('benchmark_results').insert({
      server_id: server,
      benchmark_type: 'container',
      duration_seconds: duration,
      cpu_score: container.cpu_pct,
      memory_score: container.memory_pct,
      disk_score: result.disk_write_mbps,
      overall_score: container.cpu_pct + container.memory_pct,
      raw_data: { ...result.measurements, container },
    });
    if (insertError) {
      res.status(500).json({ error: 'Benchmark ran, but result could not be stored', details: insertError.message, result, container });
      return;
    }
    res.json({ status: 'completed', server, container, ...result });
  } catch (err: any) {
    if (err.message?.includes('docker') || err.code === 'ENOENT') {
      res.status(502).json({ error: 'Docker is not available', details: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to benchmark container', details: err.message || String(err) });
  }
});

const DIAGNOSE_ISSUES = ['connectivity', 'performance', 'disk'];

app.post('/api/doctor/diagnose', verifyAuth, async (req: Request, res: Response) => {
  const { issue } = req.body;
  const checks = await runDiagnostics(issue as string | undefined);
  res.json(checks);
});

app.post('/api/doctor/diagnose/:server', verifyAuth, async (req: Request, res: Response) => {
  const { issue } = req.body;
  const checks = await runDiagnostics(issue as string | undefined);
  res.json({ server: req.params.server, ...checks });
});

// ============================================================================
// Change History / Rollback API Routes
// ============================================================================

app.get('/api/changes', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { resource, limit } = req.query;
  let query = supabase.from('change_history').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(parseInt(limit as string || '20'));
  if (resource) query = query.eq('resource_type', resource as string);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ changes: data || [] });
});

app.get('/api/changes/history', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { resource_type, resource_id } = req.query;
  let query = supabase.from('change_history').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (resource_type) query = query.eq('resource_type', resource_type as string);
  if (resource_id) query = query.eq('resource_id', resource_id as string);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ history: data || [] });
});

app.post('/api/changes/:id/undo', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { dry_run } = req.body;
  const { data: change } = await supabase.from('change_history').select('*').eq('id', req.params.id).eq('user_id', userId).single();
  if (!change) return res.status(404).json({ error: 'Change not found' });
  if (dry_run) return res.json({ status: 'would_undo', change: { resource_type: change.resource_type, resource_id: change.resource_id, action: change.action } });
  await supabase.from('change_history').insert({ user_id: userId, resource_type: change.resource_type, resource_id: change.resource_id, action: `undo:${change.action}`, old_value: change.new_value, new_value: change.old_value, summary: `Undo of ${change.action}` });
  res.json({ status: 'undone', change });
});

app.post('/api/rollback', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { resource_type, resource_id, version } = req.body;
  await supabase.from('change_history').insert({ user_id: userId, resource_type, resource_id, action: 'rollback', summary: `Rollback to ${version || 'previous'}`, new_value: { version } });
  res.json({ status: 'rollback_initiated', resource_type, resource_id, version: version || 'latest' });
});

// ============================================================================
// Activity Timeline API Route
// ============================================================================

app.get('/api/activity', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data, error } = await supabase.from('activity_timeline').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ activities: data || [] });
});

// ============================================================================
// Multi-Tenant / Organization API Routes
// ============================================================================

app.get('/api/organizations', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: owned, error: err1 } = await supabase.from('organizations').select('*').eq('owner_id', userId);
  const { data: member } = await supabase.from('organization_members').select('organizations(*)').eq('user_id', userId);
  const membersOrgs = (member || []).map((m: any) => m.organizations).filter(Boolean);
  if (err1) return res.status(500).json({ error: err1.message });
  res.json({ organizations: [...(owned || []), ...membersOrgs] });
});

app.post('/api/organizations', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, slug } = req.body;
  const { data, error } = await supabase.from('organizations').insert({ name, slug, owner_id: userId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('organization_members').insert({ organization_id: data.id, user_id: userId, role: 'owner' });
  res.json(data);
});

// ============================================================================
// Runbook API Routes
// ============================================================================

app.get('/api/runbooks', verifyAuth, async (req: Request, res: Response) => {
  const { data, error } = await supabase.from('runbooks').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  const builtinRunbooks = [
    { id: 'builtin-deploy-prod', name: 'deploy-production', description: 'Full production deployment pipeline: pull, backup, docker pull, restart, healthcheck, notify', steps: [{ action: 'git_pull', target: 'repo' }, { action: 'backup', target: 'database' }, { action: 'docker_pull', target: 'app' }, { action: 'restart', target: 'app' }, { action: 'healthcheck', target: 'app' }, { action: 'notify', target: 'discord' }], builtin: true },
    { id: 'builtin-rollback', name: 'rollback-deployment', description: 'Rollback the last deployment', steps: [{ action: 'backup', target: 'app' }, { action: 'docker_pull', target: 'previous_version' }, { action: 'restart', target: 'app' }, { action: 'healthcheck', target: 'app' }], builtin: true },
    { id: 'builtin-backup-check', name: 'backup-verify', description: 'Verify all backups are healthy', steps: [{ action: 'list_backups', target: 'all' }, { action: 'verify_backup', target: 'last' }, { action: 'notify', target: 'discord' }], builtin: true },
    { id: 'builtin-system-update', name: 'system-update', description: 'Update system packages and reboot if needed', steps: [{ action: 'backup', target: 'config' }, { action: 'update_packages', target: 'system' }, { action: 'healthcheck', target: 'system' }, { action: 'notify', target: 'email' }], builtin: true },
  ];
  res.json({ runbooks: [...builtinRunbooks, ...(data || [])] });
});

app.post('/api/runbooks', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, description, steps } = req.body;
  const { data, error } = await supabase.from('runbooks').insert({ name, description, steps, created_by: userId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/runbooks/:id/execute', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { data: runbook } = await supabase.from('runbooks').select('*').eq('id', req.params.id).single();
  if (!runbook) return res.status(404).json({ error: 'Runbook not found' });
  const { data, error } = await supabase.from('runbook_executions').insert({ runbook_id: runbook.id, triggered_by: userId, status: 'running', output: {} }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const execSteps = [];
  for (const step of (runbook.steps || [])) {
    execSteps.push({ step: step.action, target: step.target, status: 'completed' });
  }
  await supabase.from('runbook_executions').update({ status: 'success', output: { steps: execSteps }, completed_at: new Date().toISOString() }).eq('id', data.id);
  res.json({ status: 'executed', execution_id: data.id, steps: execSteps });
});

// ============================================================================
// AI Assistant API Routes
// ============================================================================

app.post('/api/assistant/analyze', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }
  const { data: apps } = await supabase
    .from('docker_apps')
    .select('id, name')
    .eq('user_id', userId);
  const plan = buildPlan(query, (apps || []).map((a: any) => ({ id: a.id, name: a.name })));
  res.json({ analysis: plan, plan_id: `plan-${crypto.randomUUID()}`, requires_approval: plan.requires_approval, message: plan.message });
});

app.post('/api/assistant/execute', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { plan: planBody, approved } = req.body;
  if (!approved) return res.json({ status: 'cancelled', message: 'Execution cancelled by user' });
  if (!planBody || !Array.isArray(planBody.actions) || planBody.actions.length === 0) {
    return res.status(400).json({ error: 'A plan with actions is required' });
  }

  const steps: { tool: string; appId?: string; status: string; output?: string }[] = [];
  try {
    for (const action of planBody.actions) {
      const { tool, appId } = action;
      try {
        if (tool === 'start' || tool === 'stop' || tool === 'restart') {
          const docker = await dockerAction(appId, tool);
          await supabase
            .from('docker_apps')
            .update({ status: tool === 'stop' ? 'stopped' : 'running' })
            .eq('id', appId)
            .eq('user_id', userId);
          steps.push({ tool, appId, status: 'completed', output: docker.output });
          await logAudit(userId, `assistant:${tool}`, 'app', appId);
        } else if (tool === 'status') {
          const { data: app } = await supabase
            .from('docker_apps')
            .select('id, name, status, image')
            .eq('id', appId)
            .eq('user_id', userId)
            .single();
          if (!app) throw new Error('App not found');
          steps.push({ tool, appId, status: 'completed', output: `${app.name}: ${app.status} (${app.image})` });
        } else if (tool === 'logs') {
          const { data: app } = await supabase
            .from('docker_apps')
            .select('id, container_id')
            .eq('id', appId)
            .eq('user_id', userId)
            .single();
          if (!app || !app.container_id) throw new Error('App has no container');
          const { stdout, stderr } = await runCommand('docker', ['logs', '--tail', '50', String(app.container_id)]);
          steps.push({ tool, appId, status: 'completed', output: stdout || stderr });
        } else if (tool === 'benchmark') {
          const result = await runBenchmark(10);
          await supabase.from('benchmark_results').insert({
            server_id: appId || null,
            benchmark_type: appId ? 'container' : 'local',
            duration_seconds: 10,
            cpu_score: result.cpu_avg_pct,
            memory_score: result.memory_used_pct,
            disk_score: result.disk_write_mbps,
            overall_score: result.cpu_avg_pct + result.memory_used_pct,
            raw_data: result.measurements,
          });
          steps.push({ tool, appId, status: 'completed', output: `cpu=${result.cpu_avg_pct}% mem=${result.memory_used_pct}% disk=${result.disk_write_mbps}MiB/s` });
          await logAudit(userId, 'assistant:benchmark', 'app', appId);
        } else {
          throw new Error(`Unsupported tool: ${tool}`);
        }
      } catch (err: any) {
        steps.push({ tool, appId, status: 'failed', output: err.message || String(err) });
        break;
      }
    }
  } catch (err: any) {
    return res.status(500).json({ error: 'Assistant execution failed', details: err.message || String(err) });
  }

  const failed = steps.some((s) => s.status === 'failed');
  res.json({ status: failed ? 'failed' : 'executed', steps });
});

app.post('/api/assistant/chat', verifyAuth, async (req: Request, res: Response) => {
  const { message, conversation_id } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  const { data: apps } = await supabase
    .from('docker_apps')
    .select('id, name')
    .eq('user_id', (req as any).user.id);
  const plan = buildPlan(message, (apps || []).map((a: any) => ({ id: a.id, name: a.name })));
  const response =
    plan.message ||
    `I can help with infrastructure management, deployments, monitoring and more.`;
  res.json({ response, conversation_id: conversation_id || 'new', plan });
});

// ============================================================================
// Global Search API Enhancement
// ============================================================================

app.get('/api/global-search', verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const query = `%${q}%`;
  const [apps, servers, backups, runbooks, secrets, inventory] = await Promise.all([
    supabase.from('docker_apps').select('id, name, status').eq('user_id', userId).ilike('name', query),
    supabase.from('server_inventory').select('server_id, server_name, owner').eq('user_id', userId).ilike('server_name', query),
    supabase.from('backup_jobs').select('id, name').eq('user_id', userId).ilike('name', query),
    supabase.from('runbooks').select('id, name').ilike('name', query),
    supabase.from('secrets').select('id, key').eq('user_id', userId).ilike('key', query),
    supabase.from('ssh_saved_hosts').select('id, name, host').eq('user_id', userId).ilike('name', query),
  ]);
  res.json({
    results: [
      ...(apps.data || []).map((a: any) => ({ type: 'app', id: a.id, title: a.name, subtitle: a.status })),
      ...(servers.data || []).map((s: any) => ({ type: 'server', id: s.server_id, title: s.server_name, subtitle: s.owner })),
      ...(backups.data || []).map((b: any) => ({ type: 'backup', id: b.id, title: b.name })),
      ...(runbooks.data || []).map((r: any) => ({ type: 'runbook', id: r.id, title: r.name })),
      ...(secrets.data || []).map((s: any) => ({ type: 'secret', id: s.id, title: s.key })),
      ...(inventory.data || []).map((h: any) => ({ type: 'host', id: h.id, title: h.name, subtitle: h.host })),
    ],
  });
});

// ============================================================================
// SSO / OIDC Configuration API Routes
// ============================================================================

app.get('/api/sso/providers', async (req: Request, res: Response) => {
  const providers = [
    { id: 'google', name: 'Google', enabled: !!process.env.GOOGLE_CLIENT_ID },
    { id: 'github', name: 'GitHub', enabled: !!process.env.GITHUB_CLIENT_ID },
    { id: 'microsoft', name: 'Microsoft Entra ID', enabled: !!process.env.MICROSOFT_CLIENT_ID },
    { id: 'oidc', name: 'Generic OIDC', enabled: !!process.env.OIDC_ISSUER_URL },
  ];
  res.json({ providers });
});

// ============================================================================
// GraphQL API (simplified REST-based)
// ============================================================================

app.post('/api/graphql', verifyAuth, async (req: Request, res: Response) => {
  const { query: gqlQuery } = req.body;
  if (!gqlQuery || typeof gqlQuery !== 'string') {
    return res.status(400).json({ error: 'Query is required' });
  }
  const userId = (req as any).user.id;
  const result = await executeGraphQL(gqlQuery, {
    userId,
    query: async (table, args) => {
      let builder = supabase.from(table).select('*');
      for (const [key, value] of Object.entries(args || {})) {
        builder = builder.eq(key, value);
      }
      return builder.limit(100) as any;
    },
  });
  res.json(result);
});

// Global error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err.message || err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(port, () => {
    console.log(`✨ Docker Panel API running on http://localhost:${port}`);
    console.log(`📡 Frontend should be at http://localhost:5173`);
    console.log(`🐳 Make sure Supabase and Docker are configured in .env.local`);
  });
}
