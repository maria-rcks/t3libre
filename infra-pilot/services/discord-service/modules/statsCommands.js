/**
 * @file Minecraft server statistics commands for the Discord bot.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');
require('dotenv').config();

/** @constant {number} */
const LEADERBOARD_LIMIT = 10;
/** @constant {Array<string>} */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

class StatsCommands {
    /**
     * @param {import('discord.js').Client} client - Discord client
     */
    constructor(client) {
        this.client = client;
        /** @type {import('pg').Pool|null} */
        this.db = null;
        this.initializeDatabase();
    }

    /**
     * Initialize the PostgreSQL connection pool.
     * @returns {Promise<void>}
     */
    async initializeDatabase() {
        try {
            this.db = new Pool({
                host: process.env.DB_HOST,
                port: parseInt(process.env.DB_PORT, 10) || 5432,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME,
                max: 2,
                connectionTimeoutMillis: 10000,
            });
            this.db.on('error', (error) => {
                console.error('[StatsCommands] idle client error:', error.message);
            });
        } catch (error) {
            console.error('[StatsCommands] Database connection failed:', error.message);
        }
    }

    /**
     * Build slash command definitions.
     * @returns {Array<Object>}
     */
    registerCommands() {
        return [
            new SlashCommandBuilder()
                .setName('serverstats')
                .setDescription('View your Minecraft server statistics')
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('Player to check stats for (staff only)')
                        .setRequired(false)),

            new SlashCommandBuilder()
                .setName('leaderboard')
                .setDescription('View server statistics leaderboard')
                .addStringOption(option =>
                    option.setName('category')
                        .setDescription('Leaderboard category')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Players', value: 'players' },
                            { name: 'Uptime', value: 'uptime' },
                            { name: 'Playtime', value: 'playtime' }
                        ))
        ];
    }

    /**
     * Handle the /serverstats command.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleServerStats(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('player');
        const isStaff = interaction.member.roles.cache.some(role =>
            role.name.toLowerCase().includes('staff') || role.name.toLowerCase().includes('admin')
        );

        if (targetUser && !isStaff) {
            return interaction.editReply({
                content: '❌ Only staff members can view other players\' statistics.',
                ephemeral: true
            });
        }

        const userId = targetUser ? targetUser.id : interaction.user.id;

        try {
            if (!this.db) {
                return interaction.editReply({ content: '❌ Database not available.', ephemeral: true });
            }

            const result = await this.db.query(
                'SELECT * FROM player_statistics WHERE uuid = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                return interaction.editReply({
                    content: targetUser ?
                        `❌ No server statistics found for ${targetUser.username}` :
                        '❌ You don\'t have any server statistics yet.',
                    ephemeral: true
                });
            }

            const stats = result.rows[0];
            const embed = new EmbedBuilder()
                .setTitle(`${targetUser ? targetUser.username + '\'s' : 'Your'} Server Statistics`)
                .setColor('#00ff00')
                .setTimestamp();

            embed.addFields([
                {
                    name: '📊 Current Status',
                    value: `Server: ${stats.current_status}\nPlayers: ${stats.current_players}\nTPS: ${stats.current_tps.toFixed(2)}`,
                    inline: false
                },
                {
                    name: '⚡ Peak Statistics',
                    value: `Players: ${stats.peak_players}\nMemory: ${this.formatBytes(stats.peak_memory_usage)}\nCPU: ${stats.peak_cpu_usage.toFixed(1)}%`,
                    inline: true
                },
                {
                    name: '⏰ Time Statistics',
                    value: `Total Playtime: ${this.formatTime(stats.total_playtime)}\nUptime: ${stats.uptime_percentage.toFixed(1)}%`,
                    inline: true
                },
                {
                    name: '🔄 Server Events',
                    value: `Total Restarts: ${stats.total_restarts}`,
                    inline: true
                }
            ]);

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[StatsCommands] Error fetching server statistics:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching server statistics.',
                ephemeral: true
            });
        }
    }

    /**
     * Handle the /leaderboard command.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleLeaderboard(interaction) {
        await interaction.deferReply();

        const category = interaction.options.getString('category');
        const queries = {
            players: { query: 'SELECT uuid, peak_players FROM player_statistics ORDER BY peak_players DESC LIMIT ?', title: '👥 Top Servers by Peak Players' },
            uptime: { query: 'SELECT uuid, uptime_percentage FROM player_statistics ORDER BY uptime_percentage DESC LIMIT ?', title: '⚡ Top Servers by Uptime' },
            playtime: { query: 'SELECT uuid, total_playtime FROM player_statistics ORDER BY total_playtime DESC LIMIT ?', title: '⏰ Top Servers by Playtime' },
        };

        const config = queries[category];
        if (!config) {
            return interaction.editReply({ content: '❌ Invalid category.', ephemeral: true });
        }

        try {
            if (!this.db) {
                return interaction.editReply({ content: '❌ Database not available.', ephemeral: true });
            }

            const result = await this.db.query(config.query, [LEADERBOARD_LIMIT]);

            if (result.rows.length === 0) {
                return interaction.editReply('No statistics available for the leaderboard.');
            }

            const embed = new EmbedBuilder()
                .setTitle(config.title)
                .setColor('#ffd700')
                .setTimestamp();

            let description = '';
            for (let i = 0; i < result.rows.length; i++) {
                const user = await this.client.users.fetch(result.rows[i].uuid).catch(() => null);
                const username = user ? user.username : 'Unknown User';

                let value = '';
                switch (category) {
                    case 'players':
                        value = `${result.rows[i].peak_players} players`;
                        break;
                    case 'uptime':
                        value = `${result.rows[i].uptime_percentage.toFixed(1)}% uptime`;
                        break;
                    case 'playtime':
                        value = this.formatTime(result.rows[i].total_playtime);
                        break;
                }

                description += `${i + 1}. ${username} - ${value}\n`;
            }

            embed.setDescription(description);
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[StatsCommands] Error fetching leaderboard:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching the leaderboard.',
                ephemeral: true
            });
        }
    }

    /**
     * Format bytes into a human-readable string.
     * @param {number} bytes
     * @returns {string}
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
        return `${(bytes / (1024 ** i)).toFixed(1)} ${BYTE_UNITS[i]}`;
    }

    /**
     * Convert hours into a human-readable time string.
     * @param {number} hours
     * @returns {string}
     */
    formatTime(hours) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;

        if (days > 0) {
            return `${days}d ${remainingHours}h`;
        }
        return `${hours}h`;
    }
}

module.exports = StatsCommands;