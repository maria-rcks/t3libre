const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config();

const pterodactyl = require('./modules/pterodactyl');
const { validateEmail, validateUsername, validatePassword } = require('./modules/validation');
const { loadServerLimits, saveServerLimits } = require('./modules/serverLimits');

const ServerStatus = require('./modules/serverStatus');
const TicketSystem = require('./modules/ticketSystem');
const TicketCommands = require('./modules/ticketCommands');
const StatsCommands = require('./modules/statsCommands');
const RoleManager = require('./modules/roleManager');
const VPSCommands = require('./modules/vpsCommands');
const Monitoring = require('./modules/monitoring');
const HealthChecks = require('./modules/healthChecks');
const BackupScheduler = require('./modules/backupScheduler');
const AlertManager = require('./modules/alertManager');
const TaskScheduler = require('./modules/taskScheduler');
const Maintenance = require('./modules/maintenance');
const TemplateManager = require('./modules/templateManager');
const ResourcePools = require('./modules/resourcePools');
const DbManager = require('./modules/dbManager');
const LegacyCommands = require('./modules/legacyCommands');

const COMMAND_MODULES = [
  { name: 'VPSCommands', module: VPSCommands },
  { name: 'Monitoring', module: Monitoring },
  { name: 'HealthChecks', module: HealthChecks },
  { name: 'AlertManager', module: AlertManager },
  { name: 'TaskScheduler', module: TaskScheduler },
  { name: 'Maintenance', module: Maintenance },
  { name: 'TemplateManager', module: TemplateManager },
  { name: 'ResourcePools', module: ResourcePools },
  { name: 'DbManager', module: DbManager },
  { name: 'LegacyCommands', module: LegacyCommands },
];
const ERROR_TEXT = '❌ An error occurred while running this command.';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PTERODACTYL_API_URL = process.env.PTERODACTYL_API_URL;
const SERVER_CREATION_CHANNEL_ID = process.env.SERVER_CREATION_CHANNEL_ID;
const SERVER_CREATOR_ROLE_ID = process.env.SERVER_CREATOR_ROLE_ID;
const LOCATION_ID = process.env.LOCATION_ID;
const MAX_SERVERS_PER_USER = parseInt(process.env.MAX_SERVERS_PER_USER) || 1;
const DISCORD_SERVICE_DISABLED = String(process.env.DISCORD_SERVICE_DISABLED || '').toLowerCase() === 'true';

const SERVER_TYPES = {
  minecraft: { name: 'Minecraft Server', eggId: process.env.MINECRAFT_EGG_ID, memory: 1024, dockerImage: 'ghcr.io/pterodactyl/yolks:java_17' },
  nodejs: { name: 'Node.js Server', eggId: process.env.NODEJS_EGG_ID, memory: 256, dockerImage: 'ghcr.io/pterodactyl/yolks:nodejs_18' },
  teamspeak: { name: 'TeamSpeak Server', eggId: process.env.TEAMSPEAK_EGG_ID, memory: 256, dockerImage: 'ghcr.io/pterodactyl/yolks:teamspeak' },
  database: { name: 'MySQL Datenbank', eggId: process.env.DATABASE_EGG_ID, memory: 256, dockerImage: 'ghcr.io/pterodactyl/yolks:mysql' },
  python: { name: 'Python Server', eggId: process.env.PYTHON_EGG_ID, memory: 512, dockerImage: 'ghcr.io/pterodactyl/yolks:python_3.10' }
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildIntegrations,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

const userRegistrationState = new Map();

const ticketSystem = new TicketSystem(client);
const ticketCommands = new TicketCommands(ticketSystem);
const statsCommands = new StatsCommands(client);
const roleManager = new RoleManager(client);
const serverStatus = new ServerStatus(client);

async function handleEmailInput(message, userState) {
  if (!validateEmail(message.content)) {
    await message.reply({ content: 'Ungültige E-Mail-Adresse. Bitte gib eine gültige E-Mail-Adresse ein.', ephemeral: true });
    return false;
  }
  userState.data.email = message.content;
  userState.step = 'username';
  const embed = new EmbedBuilder().setTitle('Server-Erstellung').setDescription('E-Mail gespeichert. Bitte gib nun deinen gewünschten Benutzernamen ein:').setColor('#007bff').setFooter({ text: 'Schritt 2 von 3: Benutzername' });
  await message.reply({ embeds: [embed], ephemeral: true });
  return true;
}

async function handleUsernameInput(message, userState) {
  if (!validateUsername(message.content)) {
    await message.reply({ content: 'Ungültiger Benutzername. Der Benutzername muss 3-20 Zeichen lang sein und darf nur Buchstaben, Zahlen und Unterstriche enthalten.', ephemeral: true });
    return false;
  }
  userState.data.username = message.content;
  userState.step = 'password';
  const embed = new EmbedBuilder().setTitle('Server-Erstellung').setDescription('Benutzername gespeichert. Bitte gib nun dein gewünschtes Passwort ein.\n\n**Sicherheitshinweis**: Dein Passwort sollte mindestens 8 Zeichen lang sein und eine Kombination aus Buchstaben, Zahlen und Sonderzeichen enthalten.').setColor('#007bff').setFooter({ text: 'Schritt 3 von 3: Passwort' });
  await message.reply({ embeds: [embed], ephemeral: true });
  return true;
}

async function handlePasswordInput(message, userState) {
  if (!validatePassword(message.content)) {
    await message.reply({ content: 'Passwort zu schwach. Es sollte mindestens 8 Zeichen lang sein und Buchstaben, Zahlen und Sonderzeichen enthalten.', ephemeral: true });
    return false;
  }
  userState.data.password = message.content;
  userState.step = 'processing';
  const embed = new EmbedBuilder().setTitle('Server-Erstellung').setDescription('Alle Informationen gesammelt. Erstelle deinen Account und Server...').setColor('#ffc107').setFooter({ text: 'Wird verarbeitet...' });
  const processingMsg = await message.reply({ embeds: [embed], ephemeral: true });
  return { processingMsg };
}

async function processServerCreation(message, userState, processingMsg) {
  try {
    if (!userState.data.serverType || !SERVER_TYPES[userState.data.serverType]) {
      throw new Error('Ungültiger Server-Typ');
    }
    const userData = {
      username: userState.data.username,
      email: userState.data.email,
      first_name: userState.data.username,
      last_name: 'User',
      password: userState.data.password,
      root_admin: false,
      language: 'en'
    };
    const userResponse = await pterodactyl.createUser(userData);
    const userId = userResponse.id;
    const serverType = userState.data.serverType;
    const serverConfig = SERVER_TYPES[serverType];
    const serverData = {
      name: `${userState.data.username}'s ${serverConfig.name}`,
      user: userId,
      egg: eggId,
      docker_image: serverConfig.dockerImage,
      startup: serverType === 'nodejs' ? 'npm start' : '',
      environment: serverType === 'nodejs' ? { STARTUP_CMD: 'npm start', NODE_VERSION: '18' } : {},
      limits: { memory: serverConfig.memory, swap: 0, disk: 1024, io: 500, cpu: 100 },
      feature_limits: { databases: 0, allocations: 1, backups: 1 },
      allocation: { default: null },
      deploy: { locations: [parseInt(LOCATION_ID, 10)], dedicated_ip: false, port_range: [] }
    };
    const serverResponse = await pterodactyl.createServer(serverData);
    await saveServerLimits(message.author.id, serverResponse.identifier);
    try {
      const member = await message.guild.members.fetch(message.author.id);
      await member.roles.add(SERVER_CREATOR_ROLE_ID);
    } catch (roleError) {
      console.error('[ServerCreation] Error assigning role:', roleError);
    }
    const successEmbed = new EmbedBuilder()
      .setTitle('Server-Erstellung erfolgreich')
      .setDescription(`Dein ${serverConfig.name} wurde erfolgreich erstellt.\n\n**Serverdetails:**\n- Name: ${serverResponse.name}\n- Typ: ${serverConfig.name}\n- Speicher: ${serverConfig.memory} MB\n- Server-ID: ${serverResponse.identifier}\n\nDu kannst dich nun mit deiner E-Mail und dem Passwort im Pterodactyl-Panel anmelden.`)
      .setColor('#28a745');
    await processingMsg.edit({ embeds: [successEmbed] });
  } catch (error) {
    console.error('[ServerCreation] Error during server creation:', error);
    const errorEmbed = new EmbedBuilder()
      .setTitle('Server-Erstellung fehlgeschlagen')
      .setDescription(`Es gab einen Fehler: ${error.message || 'Unbekannter Fehler'}\n\nBitte versuche es später erneut oder kontaktiere einen Administrator.`)
      .setColor('#dc3545');
    await processingMsg.edit({ embeds: [errorEmbed] });
  } finally {
    userRegistrationState.delete(message.author.id);
  }
}

async function registerCommands() {
  const allCommands = [
    { name: 'server', description: 'Server-Verwaltungsbefehle', options: [{ name: 'create', description: 'Erstelle einen neuen Server', type: 1 }] },
    { name: 'setuptickets', description: 'Set up the ticket system in the current channel', type: 1 },
    { name: 'addstaff', description: 'Add a staff member to the current ticket', type: 1, options: [{ name: 'user', description: 'The staff member to add', type: 6, required: true }] },
    { name: 'removestaff', description: 'Remove a staff member from the current ticket', type: 1, options: [{ name: 'user', description: 'The staff member to remove', type: 6, required: true }] },
    { name: 'ticketstats', description: 'View ticket statistics', type: 1 },
    { name: 'serverstats', description: 'View your Minecraft server statistics', type: 1, options: [{ name: 'player', description: 'Player to check stats for (staff only)', type: 6, required: false }] },
    { name: 'leaderboard', description: 'View server statistics leaderboard', type: 1, options: [{ name: 'category', description: 'Leaderboard category', type: 3, required: true, choices: [{ name: 'Players', value: 'players' }, { name: 'Uptime', value: 'uptime' }, { name: 'Playtime', value: 'playtime' }] }] },
    { name: 'status', description: 'Server status commands', type: 1, options: [{ name: 'widget', description: 'Create a status widget', type: 1 }, { name: 'info', description: 'Show live server status', type: 1 }] },
    { name: 'role', description: 'Role management commands', type: 1, options: [{ name: 'info', description: 'Show role hierarchy info', type: 1 }] },
    { name: 'report', description: 'Report bot commands', type: 1, options: [{ name: 'send', description: 'Send a report to this channel', type: 1, options: [{ name: 'type', description: 'Report type', type: 3, required: false, choices: [{ name: 'Executive Summary', value: 'executive-summary' }, { name: 'Cost Report', value: 'cost' }, { name: 'Performance Report', value: 'performance' }, { name: 'Incident Report', value: 'incidents' }] }] }] },
    ...VPSCommands.toSpec(),
    ...Monitoring.toSpec(),
    ...HealthChecks.toSpec(),
    ...AlertManager.toSpec(),
    ...TaskScheduler.toSpec(),
    ...Maintenance.toSpec(),
    ...TemplateManager.toSpec(),
    ...ResourcePools.toSpec(),
    ...DbManager.toSpec(),
    ...LegacyCommands.toSpec(),
  ];
  try {
    await client.application.commands.set(allCommands);
    console.log(`[Commands] ${allCommands.length} slash commands registered.`);
  } catch (error) {
    console.error('[Commands] Error registering commands:', error);
  }
}

client.once('ready', async () => {
  console.log(`[Discord] Bot online as ${client.user.tag}`);
  await registerCommands();
  vpsManager.ensureTables().catch(() => {});
  serverStatus.initialize(client);
  Monitoring.init(client);
  HealthChecks.init(client);
  BackupScheduler.init(client);
  AlertManager.init(client);
  TaskScheduler.init(client).catch((err) => console.error('[TaskScheduler] init failed:', err.message));
  Monitoring.updatePresence().catch(() => {});
});

client.on('guildMemberAdd', async (member) => {
  try {
    serverStatus.handleMemberJoin?.(member);
  } catch (error) {
    console.error('[Discord] Error in guildMemberAdd handler:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    if (interaction.channelId === SERVER_CREATION_CHANNEL_ID && interaction.commandName === 'server') {
      const serverLimits = await loadServerLimits();
      const userServers = serverLimits[interaction.user.id] || [];
      if (userServers.length >= MAX_SERVERS_PER_USER) {
        return interaction.reply({ content: `Du hast bereits die maximale Anzahl von ${MAX_SERVERS_PER_USER} Servern erreicht.`, ephemeral: true });
      }
      const row = new ActionRowBuilder().addComponents(
        Object.entries(SERVER_TYPES).map(([key, type]) =>
          new ButtonBuilder().setCustomId(`servertype_${key}`).setLabel(type.name).setStyle(ButtonStyle.Primary)
        )
      );
      const embed = new EmbedBuilder().setTitle('Server-Erstellung').setDescription('Wähle den Typ des Servers, den du erstellen möchtest:').setColor('#007bff');
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
    for (const entry of COMMAND_MODULES) {
      if (entry.module.isParsed(interaction.commandName)) {
        return entry.module.handle(interaction).catch(async (error) => {
          console.error(`[${entry.name}] ${interaction.commandName} failed:`, error);
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply({ content: ERROR_TEXT });
            } else {
              await interaction.reply({ content: ERROR_TEXT, ephemeral: true });
            }
          } catch (replyError) {
            console.error(`[${entry.name}] error reply failed:`, replyError);
          }
          return null;
        });
      }
    }
    ticketCommands.handleCommand(interaction);
    statsCommands.handleCommand(interaction);
    serverStatus.handleCommand(interaction);
    return;
  }
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('servertype_')) {
      const serverType = interaction.customId.split('_')[1];
      userRegistrationState.set(interaction.user.id, { step: 'email', data: { serverType }, messageId: null });
      const embed = new EmbedBuilder().setTitle('Server-Erstellung').setDescription(`Du hast ${SERVER_TYPES[serverType].name} ausgewählt.\n\nBitte gib deine E-Mail-Adresse ein:`).setColor('#007bff').setFooter({ text: 'Schritt 1 von 3: E-Mail' });
      return interaction.update({ embeds: [embed], components: [] });
    }
    ticketSystem.handleTicketCreate(interaction);
    ticketSystem.handleTicketClose(interaction);
    serverStatus.handleButton(interaction);
    return;
  }
  if (interaction.isModalSubmit()) {
    return;
  }
  if (interaction.isStringSelectMenu()) {
    return;
  }
  if (interaction.isUserSelect()) {
    return;
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    roleManager.handleReaction(reaction, user, true);
  } catch (error) {
    console.error('[Discord] Error in messageReactionAdd handler:', error);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    roleManager.handleReaction(reaction, user, false);
  } catch (error) {
    console.error('[Discord] Error in messageReactionRemove handler:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  try {
    const userState = userRegistrationState.get(message.author.id);
    if (userState) {
      if (message.channelId !== SERVER_CREATION_CHANNEL_ID) return;
      try { await message.delete(); } catch (error) { console.error('[Discord] Error deleting message:', error); }
      switch (userState.step) {
        case 'email': {
          const result = await handleEmailInput(message, userState);
          if (!result.ok) return;
          break;
        }
        case 'username': {
          const result = await handleUsernameInput(message, userState);
          if (!result.ok) return;
          break;
        }
        case 'password': {
          const result = await handlePasswordInput(message, userState);
          if (!result.ok) return;
          await processServerCreation(message, userState, result.processingMsg);
          break;
        }
      }
    }
  } catch (error) {
    console.error('[Discord] Error in messageCreate handler:', error);
  }
});

const WEBHOOK_PORT = parseInt(process.env.CODE_REVIEW_WEBHOOK_PORT, 10) || 3000;
const webhookServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'discord-service', discord: DISCORD_SERVICE_DISABLED || !DISCORD_TOKEN ? 'disabled' : 'enabled' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (error) {
    console.error('[Webhook] Server error:', error);
    res.writeHead(500);
    res.end();
  }
});
webhookServer.listen(WEBHOOK_PORT, () => {
  console.log(`[Webhook] HTTP server listening on port ${WEBHOOK_PORT}`);
});

if (DISCORD_SERVICE_DISABLED || !DISCORD_TOKEN || DISCORD_TOKEN === 'your_discord_bot_token_here') {
  console.log('[Discord] Bot login disabled; webhook and health endpoints remain available.');
} else {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error('[Discord] Login failed:', error.message);
    process.exitCode = 1;
  });
}
