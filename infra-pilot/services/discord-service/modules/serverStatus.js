/**
 * @file Server status widget for the Discord bot.
 * Displays live system information (CPU, RAM, uptime) with auto-refresh.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const si = require('systeminformation');

/** @constant {number} */
const WIDGET_UPDATE_INTERVAL_MS = 30000;
/** @constant {Array<string>} */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

class ServerStatus {
    /**
     * @param {import('discord.js').Client} client
     */
    constructor(client) {
        this.client = client;
        /** @type {Map<string, Object>} */
        this.widgets = new Map();
        /** @type {Map<string, NodeJS.Timeout>} */
        this.updateIntervals = new Map();
    }

    /**
     * Initialize all registered status widgets.
     * @param {import('discord.js').Client} client
     * @returns {void}
     */
    initialize(client) {
        for (const [channelId] of this.widgets) {
            this.startWidgetUpdate(channelId);
        }
    }

    /**
     * Route a /status subcommand interaction.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleCommand(interaction) {
        if (interaction.commandName !== 'status') return;

        const sub = interaction.options.getSubcommand();
        if (sub === 'widget') {
            await this.createWidget(interaction);
        } else if (sub === 'info') {
            await this.showStatus(interaction);
        }
    }

    /**
     * Create a live status widget in the current channel.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async createWidget(interaction) {
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            return interaction.reply({ content: '❌ Du benötigst Administrator-Rechte.', ephemeral: true });
        }

        await interaction.deferReply();

        const embed = await this.createStatusEmbed();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_status')
                .setLabel('Refresh')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔄')
        );

        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
        this.widgets.set(interaction.channelId, { messageId: msg.id, channelId: interaction.channelId });
        this.startWidgetUpdate(interaction.channelId);

        await interaction.editReply({ content: '✅ Status-Widget erstellt!', ephemeral: true });
    }

    /**
     * Start the periodic update interval for a widget.
     * @param {string} channelId
     * @returns {void}
     */
    startWidgetUpdate(channelId) {
        if (this.updateIntervals.has(channelId)) {
            clearInterval(this.updateIntervals.get(channelId));
        }
        const interval = setInterval(() => this.updateWidget(channelId), WIDGET_UPDATE_INTERVAL_MS);
        this.updateIntervals.set(channelId, interval);
    }

    /**
     * Update a single widget with fresh system data.
     * @param {string} channelId
     * @returns {Promise<void>}
     */
    async updateWidget(channelId) {
        const config = this.widgets.get(channelId);
        if (!config) return;

        try {
            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel) return;

            const msg = await channel.messages.fetch(config.messageId).catch(() => null);
            if (!msg) {
                this.widgets.delete(channelId);
                clearInterval(this.updateIntervals.get(channelId));
                return;
            }

            const embed = await this.createStatusEmbed();
            await msg.edit({ embeds: [embed] });
        } catch (e) {
            console.error(`[ServerStatus] Widget update error for ${channelId}:`, e.message);
        }
    }

    /**
     * Create a status embed with current system information.
     * @returns {Promise<import('discord.js').EmbedBuilder>}
     */
    async createStatusEmbed() {
        try {
            const [cpu, mem, os, load, time] = await Promise.all([
                si.cpu(),
                si.mem(),
                si.osInfo(),
                si.currentLoad(),
                si.time()
            ]);

            const uptime = this.formatUptime(time.uptime);

            return new EmbedBuilder()
                .setTitle('🖥️ Server Status')
                .setColor('#6C5CE7')
                .addFields([
                    { name: 'CPU', value: `${cpu.manufacturer} ${cpu.brand}\nAuslastung: ${load.currentLoad.toFixed(1)}%`, inline: true },
                    { name: 'RAM', value: `Belegt: ${this.formatBytes(mem.used)}\nGesamt: ${this.formatBytes(mem.total)}`, inline: true },
                    { name: 'System', value: `${os.platform} ${os.release}`, inline: true },
                    { name: 'Uptime', value: uptime, inline: true },
                    { name: 'Online since', value: time.timezone, inline: true }
                ])
                .setFooter({ text: 'Aktualisiert alle 30s' })
                .setTimestamp();
        } catch (e) {
            console.error('[ServerStatus] Error creating status embed:', e.message);
            return new EmbedBuilder()
                .setTitle('❌ Status-Fehler')
                .setDescription('Konnte Systeminformationen nicht abrufen.')
                .setColor('#ff0000');
        }
    }

    /**
     * Show a one-shot status embed.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async showStatus(interaction) {
        await interaction.deferReply();
        const embed = await this.createStatusEmbed();
        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * Handle the refresh button interaction.
     * @param {import('discord.js').ButtonInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleButton(interaction) {
        if (interaction.customId !== 'refresh_status') return;
        await interaction.deferUpdate();
        await this.updateWidget(interaction.channelId);
    }

    /**
     * Format bytes into a human-readable string.
     * @param {number} bytes
     * @returns {string}
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + BYTE_UNITS[i];
    }

    /**
     * Convert seconds into a human-readable uptime string.
     * @param {number} seconds
     * @returns {string}
     */
    formatUptime(seconds) {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0) parts.push(`${h}h`);
        parts.push(`${m}m`);
        return parts.join(' ');
    }
}

module.exports = ServerStatus;
