import { createClient, Session } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};
const supabaseUrl = (env.VITE_SUPABASE_URL || 'http://localhost:54321') as string;
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY || 'dev-local-anon-key') as string;
if (env.PROD && !env.VITE_SUPABASE_ANON_KEY) {
  console.error('[infra-pilot] VITE_SUPABASE_ANON_KEY is not set in production; authentication will not work.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Auth helper functions
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function onAuthStateChange(callback: (session: Session | null) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return subscription;
}

export function getAccessToken(): string | null {
  return localStorage.getItem('sb_access_token');
}

export function setAccessToken(token: string) {
  localStorage.setItem('sb_access_token', token);
}

export function clearAccessToken() {
  localStorage.removeItem('sb_access_token');
}

const INTEGRATION_API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

export async function verify2FA(tempToken: string, code: string): Promise<string> {
  const res = await fetch(`${INTEGRATION_API}/api/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ temp_token: tempToken, totp_code: code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '2FA verification failed');
  return data.token;
}

export async function setup2FA(userId: string): Promise<{ secret: string; uri: string; qr_code_url: string }> {
  const res = await fetch(`${INTEGRATION_API}/api/auth/2fa/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '2FA setup failed');
  return data;
}

export async function verify2FASetup(userId: string, token: string): Promise<boolean> {
  const res = await fetch(`${INTEGRATION_API}/api/auth/2fa/verify-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, token }),
  });
  const data = await res.json();
  return data.success === true;
}

export async function disable2FA(userId: string, password: string): Promise<boolean> {
  const res = await fetch(`${INTEGRATION_API}/api/auth/2fa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, password }),
  });
  const data = await res.json();
  return data.success === true;
}

export async function get2FABackupCodes(userId: string): Promise<string[]> {
  const res = await fetch(`${INTEGRATION_API}/api/auth/2fa/backup-codes?user_id=${userId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get backup codes');
  return data.backup_codes || [];
}
