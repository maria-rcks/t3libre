const assert = require('assert');

describe('ReportBot Module', () => {
  let ReportBot;

  before(() => {
    ReportBot = require('../../services/discord-service/modules/reportBot');
  });

  it('exports a constructor', () => {
    assert.equal(typeof ReportBot, 'function');
  });

  it('constructs a bot instance', () => {
    const client = { on: () => {}, login: () => {} };
    const bot = new ReportBot(client);
    assert.ok(bot);
    assert.equal(typeof bot.handleCommand, 'function');
    assert.equal(typeof bot.handleButton, 'function');
    assert.equal(typeof bot.initialize, 'function');
    assert.equal(typeof bot.handleSchedule, 'function');
  });

  it('handleCommand returns false for unknown command', () => {
    const client = { on: () => {}, login: () => {} };
    const bot = new ReportBot(client);
    const interaction = { commandName: 'unknown', reply: async () => {} };
    const result = bot.handleCommand(interaction);
    assert.equal(result, false);
  });

  it('handleButton returns false for unknown customId', () => {
    const client = { on: () => {}, login: () => {} };
    const bot = new ReportBot(client);
    const interaction = { customId: 'unknown', reply: async () => {} };
    const result = bot.handleButton(interaction);
    assert.equal(result, false);
  });

  it('initialize sets up cron jobs', () => {
    const client = { on: () => {}, login: () => {} };
    const bot = new ReportBot(client);
    bot.initialize(client);
    assert.ok(bot.client);
  });
});
