import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIT_REDACTED,
  sanitizeAuditValue,
} from '../../server/audit-sanitize.ts';

describe('audit sanitization', () => {
  it('redacts token, secret and password keys', () => {
    const sanitized = sanitizeAuditValue({
      name: 'webhook',
      token: 'abc123',
      webhookSecret: 'xyz',
      nested: { apiKey: 'k-1', password: 'pw' },
    }) as Record<string, unknown>;
    assert.equal(sanitized.name, 'webhook');
    assert.equal(sanitized.token, AUDIT_REDACTED);
    assert.equal(sanitized.webhookSecret, AUDIT_REDACTED);
    assert.deepEqual(sanitized.nested, { apiKey: AUDIT_REDACTED, password: AUDIT_REDACTED });
  });

  it('redacts environment variables blocks', () => {
    const sanitized = sanitizeAuditValue({
      environment_vars: { DB_PASSWORD: 'secret', API_TOKEN: 't' },
      name: 'app',
    }) as Record<string, unknown>;
    assert.equal(sanitized.environment_vars, AUDIT_REDACTED);
    assert.equal(sanitized.name, 'app');
  });

  it('redacts notification channel config blocks', () => {
    const sanitized = sanitizeAuditValue({
      name: 'alerts',
      config: { webhookUrl: 'https://discord.com/api/webhooks/123/TOKEN' },
    }) as Record<string, unknown>;
    assert.equal(sanitized.config, AUDIT_REDACTED);
    assert.equal(sanitized.name, 'alerts');
  });

  it('redacts credentials embedded in URLs', () => {
    const sanitized = sanitizeAuditValue({
      repoUrl: 'https://user:pass@github.com/me/repo.git',
    }) as Record<string, unknown>;
    assert.ok(String(sanitized.repoUrl).includes(AUDIT_REDACTED));
    assert.ok(!String(sanitized.repoUrl).includes('user:pass'));
  });

  it('redacts secret webhook URLs entirely', () => {
    const sanitized = sanitizeAuditValue({
      url: 'https://discord.com/api/webhooks/123/TOKEN',
    }) as Record<string, unknown>;
    assert.equal(sanitized.url, AUDIT_REDACTED);
  });

  it('keeps benign payloads untouched', () => {
    const payload = { name: 'task', cronExpression: '0 * * * *', enabled: true };
    assert.deepEqual(sanitizeAuditValue(payload), payload);
  });

  it('guards against deeply nested payloads', () => {
    let nested: unknown = { value: 'leaf' };
    for (let i = 0; i < 10; i++) {
      nested = { child: nested };
    }
    const sanitized = sanitizeAuditValue(nested) as Record<string, unknown>;
    let node = sanitized;
    for (let depth = 0; depth < 5; depth++) {
      assert.ok(node && typeof node === 'object');
      node = (node as Record<string, unknown>).child as Record<string, unknown>;
    }
    assert.equal(node, AUDIT_REDACTED);
  });
});
