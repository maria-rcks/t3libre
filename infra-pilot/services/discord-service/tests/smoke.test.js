'use strict';

const test = require('node:test');
const assert = require('node:assert');

const modules = {
  validation: require('../modules/validation'),
  roleManager: require('../modules/roleManager'),
  serverLimits: require('../modules/serverLimits'),
  serverStatus: require('../modules/serverStatus'),
  statsCommands: require('../modules/statsCommands'),
  ticketCommands: require('../modules/ticketCommands'),
  ticketSystem: require('../modules/ticketSystem'),
  pterodactyl: require('../modules/pterodactyl'),
};

test('all service modules load without crashing', () => {
  for (const [name, mod] of Object.entries(modules)) {
    assert.ok(mod, `${name} did not export anything`);
    assert.ok(['function', 'object'].includes(typeof mod), `${name} should export a module API`);
  }
});

test('validation exports the documented helpers', () => {
  const { validateEmail, validateUsername, validatePassword } = modules.validation;
  assert.strictEqual(typeof validateEmail, 'function');
  assert.strictEqual(typeof validateUsername, 'function');
  assert.strictEqual(typeof validatePassword, 'function');
});

test('validation rejects invalid input', () => {
  const { validateEmail, validateUsername, validatePassword } = modules.validation;
  assert.strictEqual(validateEmail('user@example.com'), true);
  assert.strictEqual(validateEmail('not-an-email'), false);
  assert.strictEqual(validateUsername('valid_user_1'), true);
  assert.strictEqual(validateUsername('x'), false);
  assert.strictEqual(validateUsername('in valid'), false);
  assert.strictEqual(validatePassword(''), false);
  assert.strictEqual(validatePassword('short'), false);
});

test('roleManager exposes a RoleManager type', () => {
  const RoleManager = modules.roleManager;
  assert.strictEqual(typeof RoleManager, 'function');
  const manager = new RoleManager({});
  assert.strictEqual(typeof manager.handleReaction, 'function');
});
