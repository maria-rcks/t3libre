import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pluginRegistry from '../../server/plugin-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PLUGINS_FILE = path.join(__dirname, '..', '..', 'server', 'plugins.json');

describe('Plugin Registry', () => {
  before(async () => {
    // Clean up test file
    try { await fs.unlink(TEST_PLUGINS_FILE); } catch {}
  });

  after(async () => {
    try { await fs.unlink(TEST_PLUGINS_FILE); } catch {}
  });

  it('returns initial plugin list with installed status', async () => {
    const plugins = await pluginRegistry.listPlugins();
    assert.ok(Array.isArray(plugins));
    assert.ok(plugins.length > 0);
    plugins.forEach(p => {
      assert.ok(p.id);
      assert.ok(p.name);
      assert.ok(p.version);
    });
  });

  it('gets a specific plugin by id', async () => {
    const plugins = await pluginRegistry.listPlugins();
    const first = plugins[0];
    const plugin = await pluginRegistry.getPlugin(first.id);
    assert.ok(plugin);
    assert.equal(plugin.id, first.id);
    assert.equal(plugin.name, first.name);
  });

  it('returns null for non-existent plugin', async () => {
    const plugin = await pluginRegistry.getPlugin('non-existent-id');
    assert.equal(plugin, null);
  });

  it('installs a plugin for an app', async () => {
    const plugins = await pluginRegistry.listPlugins();
    const first = plugins[0];
    await pluginRegistry.installPlugin(first.id, 'test-app', 'test-user');
    const updated = await pluginRegistry.listPlugins();
    const installed = updated.find(p => p.id === first.id);
    assert.ok(installed!.installed);
  });

  it('uninstalls a plugin from an app', async () => {
    const plugins = await pluginRegistry.listPlugins();
    const first = plugins[0];
    await pluginRegistry.uninstallPlugin(first.id, 'test-app');
    const updated = await pluginRegistry.listPlugins();
    const uninstalled = updated.find(p => p.id === first.id);
    assert.equal(uninstalled!.installed, false);
  });

  it('publishes a new plugin', async () => {
    const newPlugin = {
      id: 'test-new-plugin',
      name: 'Test Plugin',
      description: 'A test plugin',
      version: '1.0.0',
      author: 'Tester',
      category: 'performance',
      tags: ['test'],
      downloads: 0,
      iconUrl: '',
      homepage: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const published = await pluginRegistry.publishPlugin(newPlugin);
    assert.equal(published.name, 'Test Plugin');

    const plugins = await pluginRegistry.listPlugins();
    const found = plugins.find(p => p.id === 'test-new-plugin');
    assert.ok(found);
    assert.equal(found!.name, 'Test Plugin');
  });
});
