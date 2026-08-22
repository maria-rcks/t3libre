/**
 * @file Ticket system for Discord support tickets
 */

const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');

/** @constant {number} */
const MAX_TRANSCRIPT_MESSAGES = 1000;

class TicketSystem {
    /**
     * @param {import('discord.js').Client} client - Discord client instance
     */
    constructor(client) {
        this.client = client;
        /** @type {Map<string, Object>} */
        this.tickets = new Map();
        this.ticketCounter = 0;
    }

    /**
     * Create a ticket panel with a button in the given channel.
     * @param {import('discord.js').TextChannel} channel - Channel to post the panel in
     * @param {Object} [options] - Panel configuration options
     * @param {string} [options.title] - Panel title
     * @param {string} [options.description] - Panel description
     * @param {string} [options.color] - Embed color (hex)
     * @param {string} [options.buttonLabel] - Button label text
     * @returns {Promise<import('discord.js').Message>} The sent panel message
     */
    async createTicketPanel(channel, options = {}) {
        const embed = new EmbedBuilder()
            .setTitle(options.title || '📝 Support Tickets')
            .setDescription(options.description || 'Click the button below to create a support ticket')
            .setColor(options.color || '#00ff00')
            .setTimestamp();

        const button = new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel(options.buttonLabel || 'Create Ticket')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎫');

        const row = new ActionRowBuilder().addComponents(button);

        return await channel.send({
            embeds: [embed],
            components: [row]
        });
    }

    /**
     * Handle a 'create_ticket' button interaction.
     * @param {import('discord.js').ButtonInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleTicketCreate(interaction) {
        if (interaction.customId !== 'create_ticket') return;

        const ticketId = ++this.ticketCounter;
        const ticketChannel = await this.createTicketChannel(interaction, ticketId);

        if (!ticketChannel) {
            await interaction.reply({
                content: '❌ Failed to create ticket channel. Please contact an administrator.',
                ephemeral: true
            });
            return;
        }

        this.tickets.set(ticketChannel.id, {
            id: ticketId,
            userId: interaction.user.id,
            status: 'open',
            createdAt: new Date(),
            messages: []
        });

        await interaction.reply({
            content: `✅ Ticket created! Please check ${ticketChannel}`,
            ephemeral: true
        });

        await this.sendTicketWelcomeMessage(ticketChannel, interaction.user);
    }

    /**
     * Create a private ticket channel for the user.
     * @param {import('discord.js').ButtonInteraction} interaction
     * @param {number} ticketId
     * @returns {Promise<import('discord.js').TextChannel|null>}
     */
    async createTicketChannel(interaction, ticketId) {
        if (!interaction.guild) return null;

        const guild = interaction.guild;
        const category = await this.getTicketCategory(guild);
        const channelName = `ticket-${ticketId}`;

        try {
            return await guild.channels.create({
                name: channelName,
                type: 0,
                parent: category?.id,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ]
                    },
                    {
                        id: this.client.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageChannels
                        ]
                    }
                ]
            });
        } catch (error) {
            console.error(`[TicketSystem] Error creating channel ${channelName}:`, error);
            return null;
        }
    }

    /**
     * Find or create a 'Tickets' category in the guild.
     * @param {import('discord.js').Guild} guild
     * @returns {Promise<import('discord.js').CategoryChannel|null>}
     */
    async getTicketCategory(guild) {
        let category = guild.channels.cache.find(c =>
            c.type === 4 && c.name.toLowerCase() === 'tickets'
        );

        if (!category) {
            try {
                category = await guild.channels.create({
                    name: 'Tickets',
                    type: 4
                });
            } catch (error) {
                console.error('[TicketSystem] Error creating tickets category:', error);
                return null;
            }
        }

        return category;
    }

    /**
     * Send the welcome message with close button in a new ticket channel.
     * @param {import('discord.js').TextChannel} channel
     * @param {import('discord.js').User} user
     * @returns {Promise<void>}
     */
    async sendTicketWelcomeMessage(channel, user) {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Support Ticket')
            .setDescription(`Hello ${user}, welcome to your support ticket!\nPlease describe your issue and our staff will assist you shortly.`)
            .setColor('#00ff00')
            .setTimestamp();

        const closeButton = new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒');

        const row = new ActionRowBuilder().addComponents(closeButton);

        await channel.send({
            embeds: [embed],
            components: [row]
        });
    }

    /**
     * Handle a 'close_ticket' button interaction.
     * @param {import('discord.js').ButtonInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleTicketClose(interaction) {
        if (interaction.customId !== 'close_ticket') return;

        const ticket = this.tickets.get(interaction.channelId);
        if (!ticket) return;

        try {
            const messages = await interaction.channel.messages.fetch({ limit: MAX_TRANSCRIPT_MESSAGES });
            const transcript = await this.createTranscript(messages);

            const user = await this.client.users.fetch(ticket.userId);
            if (user) {
                const embed = new EmbedBuilder()
                    .setTitle('Ticket Closed')
                    .setDescription(`Your ticket #${ticket.id} has been closed.`)
                    .setColor('#ff0000')
                    .setTimestamp();

                await user.send({ embeds: [embed] }).catch(() => {});
            }

            await interaction.channel.delete();
            this.tickets.delete(interaction.channelId);

            await this.saveTranscript(interaction.guild, ticket, transcript);
        } catch (error) {
            console.error(`[TicketSystem] Error closing ticket #${ticket.id}:`, error);
        }
    }

    /**
     * Create a plain-text transcript from channel messages.
     * @param {import('discord.js').Collection<string, import('discord.js').Message>} messages
     * @returns {Promise<string>}
     */
    async createTranscript(messages) {
        let transcript = '=== Ticket Transcript ===\n\n';

        messages.reverse().forEach(msg => {
            const timestamp = msg.createdAt.toLocaleString();
            transcript += `[${timestamp}] ${msg.author.tag}: ${msg.content}\n`;

            msg.attachments.forEach(attachment => {
                transcript += `[Attachment: ${attachment.url}]\n`;
            });

            msg.embeds.forEach(embed => {
                transcript += `[Embed: ${embed.title || 'Untitled'}]\n`;
            });

            transcript += '\n';
        });

        return transcript;
    }

    /**
     * Save a ticket transcript to the ticket-logs channel if it exists.
     * @param {import('discord.js').Guild} guild
     * @param {Object} ticket - Ticket metadata
     * @param {string} transcript - Transcript text content
     * @returns {Promise<void>}
     */
    async saveTranscript(guild, ticket, transcript) {
        try {
            const logsChannel = guild.channels.cache.find(c =>
                c.name.toLowerCase() === 'ticket-logs'
            );

            if (logsChannel) {
                const embed = new EmbedBuilder()
                    .setTitle(`Ticket #${ticket.id} Transcript`)
                    .setDescription('Ticket has been closed and archived')
                    .addFields([
                        { name: 'Ticket ID', value: `#${ticket.id}`, inline: true },
                        { name: 'Created By', value: `<@${ticket.userId}>`, inline: true },
                        { name: 'Created At', value: ticket.createdAt.toLocaleString(), inline: true }
                    ])
                    .setColor('#ff0000')
                    .setTimestamp();

                await logsChannel.send({
                    embeds: [embed],
                    files: [{
                        attachment: Buffer.from(transcript),
                        name: `ticket-${ticket.id}-transcript.txt`
                    }]
                });
            }
        } catch (error) {
            console.error('[TicketSystem] Error saving transcript:', error);
        }
    }

    /**
     * Add a staff member to a ticket channel.
     * @param {import('discord.js').TextChannel} channel
     * @param {import('discord.js').GuildMember} staffMember
     * @returns {Promise<void>}
     */
    async addStaffToTicket(channel, staffMember) {
        if (!channel || !staffMember) {
            console.error('[TicketSystem] Missing channel or staffMember for addStaffToTicket');
            return;
        }

        try {
            await channel.permissionOverwrites.edit(staffMember, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
        } catch (error) {
            console.error('[TicketSystem] Error adding staff to ticket:', error);
        }
    }

    /**
     * Remove a staff member from a ticket channel.
     * @param {import('discord.js').TextChannel} channel
     * @param {import('discord.js').GuildMember} staffMember
     * @returns {Promise<void>}
     */
    async removeStaffFromTicket(channel, staffMember) {
        if (!channel || !staffMember) {
            console.error('[TicketSystem] Missing channel or staffMember for removeStaffFromTicket');
            return;
        }

        try {
            await channel.permissionOverwrites.delete(staffMember);
        } catch (error) {
            console.error('[TicketSystem] Error removing staff from ticket:', error);
        }
    }
}

module.exports = TicketSystem;