/**
 * CLI Bridge Middleware
 *
 * Adds a `req.cli` property to Express requests, allowing route handlers
 * to invoke `ipilot` CLI commands and get parsed JSON results.
 *
 * Import in index.ts:
 *   import { cliMiddleware } from './cli-bridge-middleware.js';
 *   app.use(cliMiddleware);
 *
 * Then in any route:
 *   const result = await req.cli('server list');
 */
import { Request, Response, NextFunction } from 'express';
import { cli, CliResult } from './cli-bridge.js';

declare global {
  namespace Express {
    interface Request {
      cli: (command: string) => CliResult;
    }
  }
}

export function cliMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.cli = (command: string) => cli(command);
  next();
}

/**
 * Example route replacements demonstrating CLI-first architecture.
 *
 * Replace your existing route handlers with these to delegate to the CLI.
 * Each route calls `ipilot <command> --output json` and returns the result.
 */

// Example: Replace app.get('/api/servers', ...)
//   import { cli } from './cli-bridge.js';
//   app.get('/api/servers', verifyAuth, async (req, res) => {
//     const result = cli('server list');
//     if (result.success) return res.json(result.data);
//     return res.status(500).json({ error: result.error });
//   });

// Example: Replace app.get('/api/servers/:id/logs', ...)
//   app.get('/api/servers/:id/logs', verifyAuth, async (req, res) => {
//     const result = cli(`logs fetch "${req.params.id}" --lines ${req.query.lines || 50}`);
//     if (result.success) return res.json(result.data);
//     return res.status(500).json({ error: result.error });
//   });

// Example: Replace app.get('/api/backups', ...)
//   app.get('/api/backups', verifyAuth, async (req, res) => {
//     const result = cli(`backup list${req.query.server ? ` "${req.query.server}"` : ''}`);
//     if (result.success) return res.json(result.data);
//     return res.status(500).json({ error: result.error });
//   });

// Example: Replace app.get('/api/health', ...)
//   app.get('/api/health', async (req, res) => {
//     const result = cli('health');
//     if (result.success) return res.json(result.data);
//     return res.json({ status: 'unhealthy' });
//   });
