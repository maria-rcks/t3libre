/**
 * @file Reaction-based role management for the Discord bot.
 */

const { EmbedBuilder, PermissionsBitField } = require('discord.js');

/** @constant {string} */
const DEFAULT_ROLE_COLOR = '#000000';

class RoleManager {
    /**
     * @param {import('discord.js').Client} client
     */
    constructor(client) {
        this.client = client;
        /** @type {Map<string, Object>} */
        this.roleMenus = new Map();
    }

    /**
     * Create a reaction-based role menu in a channel.
     * @param {import('discord.js').TextChannel} channel
     * @param {Array<{emoji: string, role: import('discord.js').Role, description?: string}>} options
     * @returns {Promise<import('discord.js').Message>}
     */
    async createRoleMenu(channel, options) {
        if (!channel || !options || options.length === 0) {
            throw new Error('Channel and at least one option are required');
        }

        const embed = new EmbedBuilder()
            .setTitle('Role Selection Menu')
            .setDescription('React with the emojis below to get or remove roles!')
            .setColor('#00ff00')
            .setTimestamp();

        const roleFields = options.map((option) => ({
            name: `${option.emoji} ${option.role.name}`,
            value: option.description || 'Click the reaction to toggle this role',
            inline: true
        }));

        embed.addFields(roleFields);

        const message = await channel.send({ embeds: [embed] });

        for (const option of options) {
            await message.react(option.emoji);
        }

        this.roleMenus.set(message.id, {
            roles: options.map(opt => ({
                emoji: opt.emoji,
                roleId: opt.role.id
            }))
        });

        return message;
    }

    /**
     * Handle a reaction add/remove event for role menus.
     * @param {import('discord.js').MessageReaction} reaction
     * @param {import('discord.js').User} user
     * @param {boolean} added - Whether the reaction was added (true) or removed (false)
     * @returns {Promise<void>}
     */
    async handleReaction(reaction, user, added) {
        if (user.bot) return;

        const menuConfig = this.roleMenus.get(reaction.message.id);
        if (!menuConfig) return;

        const roleConfig = menuConfig.roles.find(r => r.emoji === reaction.emoji.name);
        if (!roleConfig) return;

        const guild = reaction.message.guild;
        if (!guild) return;

        try {
            const member = await guild.members.fetch(user.id);
            const role = guild.roles.cache.get(roleConfig.roleId);

            if (!role) {
                console.error(`[RoleManager] Role ${roleConfig.roleId} not found in guild ${guild.id}`);
                return;
            }

            if (added) {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                    await this.sendRoleUpdateMessage(member, role, true);
                }
            } else {
                if (member.roles.cache.has(role.id)) {
                    await member.roles.remove(role);
                    await this.sendRoleUpdateMessage(member, role, false);
                }
            }
        } catch (error) {
            console.error('[RoleManager] Error updating roles:', error);
            await user.send('There was an error updating your roles. Please contact an administrator.').catch(() => {});
        }
    }

    /**
     * Send a DM to the user about a role change.
     * @param {import('discord.js').GuildMember} member
     * @param {import('discord.js').Role} role
     * @param {boolean} added - Whether the role was added (true) or removed (false)
     * @returns {Promise<void>}
     */
    async sendRoleUpdateMessage(member, role, added) {
        const embed = new EmbedBuilder()
            .setTitle('Role Update')
            .setDescription(`${added ? '✅ Added' : '❌ Removed'} role: ${role.name}`)
            .setColor(added ? '#00ff00' : '#ff0000')
            .setTimestamp();

        try {
            await member.send({ embeds: [embed] });
        } catch (error) {
            // User might have DMs disabled, silently ignore
        }
    }

    /**
     * Create a custom role in the guild.
     * @param {import('discord.js').Guild} guild
     * @param {Object} options
     * @param {string} options.name - Role name
     * @param {string} [options.color] - Role color hex
     * @param {import('discord.js').PermissionResolvable[]} [options.permissions]
     * @param {string} [options.reason]
     * @returns {Promise<import('discord.js').Role>}
     * @throws {Error} If role creation fails
     */
    async createCustomRole(guild, options) {
        if (!guild || !options || !options.name) {
            throw new Error('Guild and role name are required');
        }

        try {
            const role = await guild.roles.create({
                name: options.name,
                color: options.color || DEFAULT_ROLE_COLOR,
                permissions: options.permissions || [],
                reason: options.reason || 'Custom role created through role manager'
            });

            return role;
        } catch (error) {
            console.error('[RoleManager] Error creating custom role:', error);
            throw error;
        }
    }

    /**
     * Edit an existing role.
     * @param {import('discord.js').Role} role
     * @param {Object} options
     * @param {string} [options.name]
     * @param {string} [options.color]
     * @param {import('discord.js').PermissionResolvable[]} [options.permissions]
     * @param {string} [options.reason]
     * @returns {Promise<import('discord.js').Role>}
     * @throws {Error} If role edit fails
     */
    async editRole(role, options) {
        if (!role) throw new Error('Role is required');

        try {
            await role.edit({
                name: options.name,
                color: options.color,
                permissions: options.permissions,
                reason: options.reason || 'Role edited through role manager'
            });

            return role;
        } catch (error) {
            console.error('[RoleManager] Error editing role:', error);
            throw error;
        }
    }

    /**
     * Get an embed with guild role information.
     * @param {import('discord.js').Guild} guild
     * @returns {Promise<import('discord.js').EmbedBuilder>}
     */
    async getGuildRoleInfo(guild) {
        if (!guild) throw new Error('Guild is required');

        const roles = await guild.roles.fetch();
        const totalRoles = roles.size;
        const managedRoles = roles.filter(role => role.managed).size;
        const customRoles = totalRoles - managedRoles;

        const embed = new EmbedBuilder()
            .setTitle('Guild Role Information')
            .setColor('#00ff00')
            .addFields([
                { name: 'Total Roles', value: totalRoles.toString(), inline: true },
                { name: 'Custom Roles', value: customRoles.toString(), inline: true },
                { name: 'Managed Roles', value: managedRoles.toString(), inline: true }
            ])
            .setTimestamp();

        return embed;
    }

    /**
     * Validate whether a member can manage a given role (hierarchy check).
     * @param {import('discord.js').GuildMember} member
     * @param {import('discord.js').Role} role
     * @returns {boolean}
     */
    validateRoleHierarchy(member, role) {
        if (!member || !role) return false;

        if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return false;
        }

        return member.roles.highest.position > role.position;
    }

    /**
     * Bulk-assign a role to multiple members.
     * @param {import('discord.js').Role} role
     * @param {Array<import('discord.js').GuildMember>} members
     * @param {string} [reason] - Audit log reason
     * @returns {Promise<{successful: string[], failed: Array<{memberId: string, error: string}>}>}
     */
    async bulkAssignRole(role, members, reason = 'Bulk role assignment') {
        const results = {
            successful: [],
            failed: []
        };

        for (const member of members) {
            try {
                await member.roles.add(role, reason);
                results.successful.push(member.id);
            } catch (error) {
                results.failed.push({
                    memberId: member.id,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = RoleManager;