import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeConfiguration } from '../../server/config-advice-engine.ts';

describe('Config Advice Engine', () => {
  it('returns suggestions for a basic app with no config', () => {
    const app = { id: 'test-1', name: 'Test', status: 'stopped' };
    const result = analyzeConfiguration(app, {});
    assert.ok(result.suggestions.length > 0);
    assert.ok(result.summary.total > 0);
  });

  it('flags missing memory limit as critical', () => {
    const app = { id: 'test-2', name: 'Test', status: 'stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const result = analyzeConfiguration(app, {});
    const critical = result.suggestions.filter(s => s.severity === 'critical');
    const memoryIssue = critical.find(s => s.category === 'Application' && s.title.includes('Memory Limit'));
    assert.ok(memoryIssue, 'Should flag missing memory limit');
  });

  it('flags no restart policy', () => {
    const app = { id: 'test-3', name: 'Test', memory_limit: '2G', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const result = analyzeConfiguration(app, {});
    const warnings = result.suggestions.filter(s => s.severity === 'warning');
    const restartIssue = warnings.find(s => s.title.includes('Restart Policy'));
    assert.ok(restartIssue, 'Should flag missing restart policy');
  });

  it('detects missing JVM heap flags', () => {
    const app = { id: 'test-4', name: 'Test', memory_limit: '2G', restart_policy: 'unless-stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const result = analyzeConfiguration(app, {});
    const jvmIssues = result.suggestions.filter(s => s.category === 'JVM');
    assert.ok(jvmIssues.length > 0, 'Should have JVM suggestions');
  });

  it('detects YAML indentation issues', () => {
    const app = { id: 'test-5', name: 'Test', memory_limit: '2G', restart_policy: 'unless-stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const files = { '/config.yml': 'key1: value1\n\tkey2: value2\n  key3: value3' };
    const result = analyzeConfiguration(app, files);
    const yamlIssues = result.suggestions.filter(s => s.category === 'YAML');
    assert.ok(yamlIssues.some(s => s.title.includes('Indentation')), 'Should flag mixed indentation');
  });

  it('detects duplicate YAML keys', () => {
    const app = { id: 'test-6', name: 'Test', memory_limit: '2G', restart_policy: 'unless-stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const files = { '/config.yml': 'key1: value1\nkey1: value2' };
    const result = analyzeConfiguration(app, files);
    const critical = result.suggestions.filter(s => s.severity === 'critical');
    assert.ok(critical.some(s => s.title.includes('Duplicate Keys')), 'Should flag duplicate keys');
  });

  it('detects duplicate properties', () => {
    const app = { id: 'test-7', name: 'Test', memory_limit: '2G', restart_policy: 'unless-stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const files = { '/config.properties': 'key1=value1\nkey1=value2' };
    const result = analyzeConfiguration(app, files);
    const critical = result.suggestions.filter(s => s.severity === 'critical');
    assert.ok(critical.some(s => s.title.includes('Duplicate') && s.category === 'Properties'), 'Should flag duplicate properties');
  });

  it('detects unquoted strings in YAML', () => {
    const app = { id: 'test-8', name: 'Test', memory_limit: '2G', restart_policy: 'unless-stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const files = { '/config.yml': 'key: value: with: colons' };
    const result = analyzeConfiguration(app, files);
    assert.ok(result.suggestions.some(s => s.title.includes('Unquoted')), 'Should flag unquoted strings');
  });

  it('detects CMS GC deprecation', () => {
    const app = { id: 'test-9', name: 'Test', memory_limit: '2G', restart_policy: 'unless-stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const files = { '/start.sh': 'java -XX:+UseConcMarkSweepGC -jar server.jar' };
    const result = analyzeConfiguration(app, files);
    assert.ok(result.suggestions.some(s => s.title.includes('CMS GC')), 'Should flag deprecated CMS GC');
  });

  it('detects missing healthcheck', () => {
    const app = { id: 'test-10', name: 'Test', memory_limit: '2G', restart_policy: 'unless-stopped', ports: [{ hostPort: 25565, containerPort: 25565 }] };
    const result = analyzeConfiguration(app, {});
    assert.ok(result.suggestions.some(s => s.title.includes('Healthcheck')), 'Should flag missing healthcheck');
  });
});
