/**
 * Audit log sanitization.
 *
 * Values passed to logAudit may contain secrets (API keys, webhook
 * tokens, environment variables, credentials in URLs). Every value is
 * scrubbed centrally here so no call site can accidentally persist a
 * secret to the audit trail.
 */

const AUDIT_REDACTED = '[redacted]';

const AUDIT_SENSITIVE_KEY = /(token|secret|password|api[_-]?key|key_hash|credential|authorization|webhook_secret|environment|config|url)/i;

/** Hosts whose webhook URLs are secrets by themselves. */
const SECRET_WEBHOOK_HOSTS = new Set(['discord.com', 'hooks.slack.com']);

function redactAuditString(value: string): string {
  if (!value.includes('://')) {
    return value;
  }
  try {
    const url = new URL(value);
    if (SECRET_WEBHOOK_HOSTS.has(url.hostname)) {
      return AUDIT_REDACTED;
    }
    if (url.username || url.password) {
      url.username = AUDIT_REDACTED;
      url.password = AUDIT_REDACTED;
      return url.toString();
    }
  } catch {
    // Not a parseable URL; leave the value untouched.
  }
  return value;
}

/**
 * Recursively redact keys that may carry secrets.
 * @param value - The value to sanitize (typically a request body or partial entity)
 * @param depth - Recursion guard against deeply nested payloads
 */
function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return typeof value === 'string' ? redactAuditString(value) : value;
  }
  if (depth > 4) {
    return AUDIT_REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = AUDIT_SENSITIVE_KEY.test(key)
      ? AUDIT_REDACTED
      : sanitizeAuditValue(val, depth + 1);
  }
  return out;
}

export { sanitizeAuditValue, AUDIT_REDACTED };
