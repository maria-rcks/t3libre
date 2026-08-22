/**
 * @file Ticket command handlers for the Discord bot.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');

/** @constant {string} */
const TICKET_CHANNEL_PREFIX = 'ticket-';

class TicketCommands {
    /**
     * @param {import('./ticketSystem')} ticketSystem - Ticket system instance
     */
    constructor(ticketSystem) {
        this.ticketSystem = ticketSystem;
        this.commands = this.createCommands();
    }

    /**
     * Build slash command definitions.
     * @returns {Array<Object>} Array of command JSON objects
     */
    createCommands() {
        return [
            new SlashCommandBuilder()
                .setName('setuptickets')
                .setDescription('Set up the ticket system in the current channel')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

            new SlashCommandBuilder()
                .setName('addstaff')
                .setDescription('Add a staff member to the current ticket')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The staff member to add')
                        .setRequired(true)
                )
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

            new SlashCommandBuilder()
                .setName('removestaff')
                .setDescription('Remove a staff member from the current ticket')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The staff member to remove')
                        .setRequired(true)
                )
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

            new SlashCommandBuilder()
                .setName('ticketstats')
                .setDescription('View ticket statistics')
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        ].map(command => command.toJSON());
    }

    /**
     * Route an interaction to the appropriate handler.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleCommand(interaction) {
        if (!interaction.isCommand()) return;

        const handlers = {
            setuptickets: this.handleSetupCommand.bind(this),
            addstaff: this.handleAddStaffCommand.bind(this),
            removestaff: this.handleRemoveStaffCommand.bind(this),
            ticketstats: this.handleStatsCommand.bind(this),
        };

        const handler = handlers[interaction.commandName];
        if (handler) {
            await handler(interaction);
        }
    }

    /**
     * Handle the /setuptickets command.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleSetupCommand(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            await this.ticketSystem.createTicketPanel(interaction.channel, {
                title: '🎫 Support Tickets',
                description: 'Need help? Click the button below to create a support ticket!\n\nOur staff team will assist you as soon as possible.',
                buttonLabel: 'Open Ticket'
            });

            await interaction.editReply({
                content: '✅ Ticket system has been set up successfully!',
                ephemeral: true
            });
        } catch (error) {
            console.error('[TicketCommands] Error setting up ticket system:', error);
            await interaction.editReply({
                content: '❌ Failed to set up the ticket system. Please check the bot permissions and try again.',
                ephemeral: true
            });
        }
    }

    /**
     * Handle the /addstaff command.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleAddStaffCommand(interaction) {
        if (!interaction.channel.name.startsWith(TICKET_CHANNEL_PREFIX)) {
            await interaction.reply({
                content: '❌ This command can only be used in ticket channels!',
                ephemeral: true
            });
            return;
        }

        const staffMember = interaction.options.getUser('user');
        if (!staffMember) return;

        try {
            await this.ticketSystem.addStaffToTicket(interaction.channel, staffMember);
            await interaction.reply({
                content: `✅ Added ${staffMember} to the ticket.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('[TicketCommands] Error adding staff to ticket:', error);
            await interaction.reply({
                content: '❌ Failed to add staff member to the ticket.',
                ephemeral: true
            });
        }
    }

    /**
     * Handle the /removestaff command.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleRemoveStaffCommand(interaction) {
        if (!interaction.channel.name.startsWith(TICKET_CHANNEL_PREFIX)) {
            await interaction.reply({
                content: '❌ This command can only be used in ticket channels!',
                ephemeral: true
            });
            return;
        }

        const staffMember = interaction.options.getUser('user');
        if (!staffMember) return;

        try {
            await this.ticketSystem.removeStaffFromTicket(interaction.channel, staffMember);
            await interaction.reply({
                content: `✅ Removed ${staffMember} from the ticket.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('[TicketCommands] Error removing staff from ticket:', error);
            await interaction.reply({
                content: '❌ Failed to remove staff member from the ticket.',
                ephemeral: true
            });
        }
    }

    /**
     * Handle the /ticketstats command.
     * @param {import('discord.js').CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleStatsCommand(interaction) {
        await interaction.deferReply();

        const tickets = Array.from(this.ticketSystem.tickets.values());
        const openCount = tickets.filter(t => t.status === 'open').length;
        const stats = {
            total: this.ticketSystem.ticketCounter,
            open: openCount,
            closed: this.ticketSystem.ticketCounter - openCount
        };

        const fields = [
            { name: 'Total Tickets', value: stats.total.toString(), inline: true },
            { name: 'Open Tickets', value: stats.open.toString(), inline: true },
            { name: 'Closed Tickets', value: stats.closed.toString(), inline: true }
        ];

        await interaction.editReply({
            embeds: [{
                title: '📊 Ticket Statistics',
                fields,
                color: 0x00ff00,
                timestamp: new Date()
            }]
        });
    }
}

module.exports = TicketCommands;