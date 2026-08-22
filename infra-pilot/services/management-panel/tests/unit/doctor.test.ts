import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkCpu,
  checkDisk,
  checkDns,
  checkLocalApi,
  checkMemory,
  collectSystemInfo,
} from '../../server/doctor.ts';

describe('doctor diagnostics', () => {
  it('reports real memory usage', () => {
    const check = checkMemory();
    assert.ok(['ok', 'warn', 'fail'].includes(check.status), check.status);
    assert.ok(check.value, 'has a value');
    assert.equal(check.name, 'Memory');
  });

  it('reports cpu with a percentage', () => {
    const check = checkCpu();
    assert.ok(['ok', 'warn'].includes(check.status), check.status);
    assert.match(check.value || '', /%/);
  });

  it('reports disk usage for a real path', () => {
    const check = checkDisk();
    assert.ok(['ok', 'warn', 'fail'].includes(check.status), check.status);
    assert.match(check.value || '', /%/);
  });

  it('fails gracefully when the disk target does not exist', () => {
    const check = checkDisk('Z:\\definitely-not-a-drive');
    assert.equal(check.status, 'warn');
  });

  it('resolves DNS via the injected resolver', async () => {
    const check = await checkDns('example.com', async (name) => {
      assert.equal(name, 'example.com');
      return ['93.184.216.34'];
    });
    assert.equal(check.status, 'ok');
    assert.match(check.detail || '', /1 address/);
  });

  it('reports DNS failures via the injected resolver', async () => {
    const check = await checkDns('example.com', async () => {
      throw new Error('ENOTFOUND');
    });
    assert.equal(check.status, 'fail');
    assert.match(check.detail || '', /ENOTFOUND/);
  });

  it('checks the local API through the injected ping', async () => {
    const check = await checkLocalApi('http://localhost:1', async () => ({ ok: true }));
    assert.equal(check.status, 'ok');
  });

  it('fails when the API is unreachable', async () => {
    const check = await checkLocalApi('http://localhost:1', async () => {
      throw new Error('ECONNREFUSED');
    });
    assert.equal(check.status, 'fail');
    assert.match(check.detail || '', /ECONNREFUSED/);
  });

  it('collects system info with real values', () => {
    const info = collectSystemInfo();
    assert.ok(info.hostname.length > 0);
    assert.ok(info.cpus.cores >= 1);
    assert.ok(info.memory.total_gb.length > 0);
    assert.ok(info.uptime_hours >= 0);
  });
});