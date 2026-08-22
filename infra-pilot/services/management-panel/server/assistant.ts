/**
 * @file Assistant: real execution of infrastructure intents.
 * Parses a natural-language request into a plan, resolves it against real
 * data (docker_apps, deployments) and reports which tools will run.
 * Actual tool execution happens in the route handlers that call the same
 * helpers used by the rest of the API (dockerAction, runBenchmark, ...).
 */

export type AssistantTool =
  | 'start'
  | 'stop'
  | 'restart'
  | 'status'
  | 'logs'
  | 'benchmark'
  | 'deploy';

export interface AssistantAction {
  tool: AssistantTool;
  appId?: string;
  target?: string;
  reason: string;
}

export interface AssistantPlan {
  intent: string;
  requires_approval: boolean;
  actions: AssistantAction[];
  message: string;
}

const TOOL_ALIASES: Record<AssistantTool, string[]> = {
  start: ['start', 'launch', 'boot', 'turn on', 'auf', 'starten', 'hochfahren'],
  stop: ['stop', 'halt', 'shut down', 'kill', 'aus', 'stoppen', 'stopp'],
  restart: ['restart', 'reboot', 'reload', 'neustart', 'neu starten', 'restarten'],
  status: ['status', 'state', 'health', 'läuft', 'running', 'up?', 'funktioniert'],
  logs: ['log', 'logs', 'ausgabe', 'console'],
  benchmark: ['benchmark', 'bench', 'performance', 'messung', 'benchmarken'],
  deploy: ['deploy', 'deployment', 'release', 'installieren', 'deployen'],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findTool(text: string): AssistantTool | null {
  const matches: { tool: AssistantTool; index: number }[] = [];
  for (const [tool, aliases] of Object.entries(TOOL_ALIASES)) {
    for (const alias of aliases as string[]) {
      const index = text.indexOf(alias);
      if (index >= 0) {
        matches.push({ tool: tool as AssistantTool, index });
      }
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.index - b.index);
  return matches[0].tool;
}

const STOPWORDS = new Set([
  'please', 'show', 'what', 'with', 'for', 'the', 'a', 'an', 'and', 'my', 'to',
  'run', 'do', 'get', 'me', 'you', 'can', 'could', 'would', 'want', 'need', 'check', 'now',
]);

function isToolWord(word: string): boolean {
  return Object.values(TOOL_ALIASES).some((aliases) => aliases.includes(word));
}

/**
 * Resolve the target of the request: try app names/ids present in the text,
 * then quoted strings, then a trailing word or UUID.
 */
function resolveTarget(
  text: string,
  apps: { id: string; name: string }[],
): { app?: { id: string; name: string }; rawTarget?: string } {
  const idMatch = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
  if (idMatch) {
    const app = apps.find((a) => a.id === idMatch[0]);
    return app ? { app, rawTarget: idMatch[0] } : { rawTarget: idMatch[0] };
  }

  const byName = apps.find((a) =>
    text.includes(a.name.toLowerCase()),
  );
  if (byName) return { app: byName, rawTarget: byName.name };

  const quoted = text.match(/"([^"]+)"/) || text.match(/'([^']+)'/);
  if (quoted) {
    const rawTarget = quoted[1];
    const app = apps.find(
      (a) => a.id === rawTarget || a.name.toLowerCase() === rawTarget.toLowerCase(),
    );
    return app ? { app, rawTarget } : { rawTarget };
  }

  const words = text.split(' ').filter(
    (w) =>
      w.length > 2 &&
      !isToolWord(w) &&
      !STOPWORDS.has(w) &&
      !apps.some((a) => a.name.toLowerCase() === w),
  );
  for (const word of words) {
    const app = apps.find(
      (a) => a.name.toLowerCase() === word || a.id === word,
    );
    if (app) return { app, rawTarget: word };
  }
  if (words.length === 1) return { rawTarget: words[0] };
  return {};
}

/**
 * Build an execution plan from a request. Pure and unit-testable.
 * The `apps` list comes from the caller (real data).
 */
export function buildPlan(
  request: string,
  apps: { id: string; name: string }[],
): AssistantPlan {
  const text = normalize(request);
  const tool = findTool(text) || 'status';
  const { app, rawTarget } = resolveTarget(text, apps);
  const appId = app ? app.id : rawTarget;
  const unknownTarget = rawTarget && !app && !/^[0-9a-f-]{36}$/.test(rawTarget);

  if (unknownTarget) {
    return {
      intent: tool,
      requires_approval: false,
      actions: [],
      message: `I couldn't find an app named "${rawTarget}". I searched your registered apps.`,
    };
  }
  if (!app && rawTarget && /^[0-9a-f-]{36}$/.test(rawTarget)) {
    return {
      intent: tool,
      requires_approval: true,
      actions: [{ tool, appId, reason: `Run "${tool}" on app ${appId}` }],
      message: `I found an app by id ${appId}. ${tool} will be executed with your approval.`,
    };
  }

  const label = app ? `"${app.name}"` : (rawTarget || 'the system');
  if (tool === 'benchmark' && !app) {
    return {
      intent: 'benchmark',
      requires_approval: true,
      actions: [{ tool: 'benchmark', reason: 'Run a local performance benchmark (10s)' }],
      message: `I can run a local benchmark. It measures CPU, memory and disk for 10 seconds. Approve to continue.`,
    };
  }

  return {
    intent: tool,
    requires_approval: tool !== 'status' && tool !== 'logs',
    actions: [{ tool, appId, reason: `${tool} on ${label}` }],
    message: `Plan: ${tool} on ${label}.`,
  };
}

export { TOOL_ALIASES };