/**
 * @file Integration service client for the Discord bot.
 * Sends events and notifications to the external integration service.
 */

const axios = require('axios');

/** @constant {string} */
const INTEGRATION_SERVICE_URL = process.env.INTEGRATION_SERVICE_URL || 'http://localhost:9000';

/**
 * @typedef {Object} IntegrationEventData
 * @property {string} serverName
 * @property {string} [serverId]
 * @property {string} [error]
 */

/**
 * Send a server event notification to the integration service.
 * @param {string} eventType - Type of event (e.g. 'server_created')
 * @param {IntegrationEventData} data - Event payload
 * @returns {Promise<void>}
 */
async function notifyIntegration(eventType, data) {
  if (!eventType || !data) {
    console.error('[Integration] Missing eventType or data for notification');
    return;
  }

  try {
    await axios.post(`${INTEGRATION_SERVICE_URL}/api/notifications/server-event`, {
      event_type: eventType,
      server_name: data.serverName,
      details: data
    });
    console.log(`[Integration] Notified: ${eventType}`);
  } catch (error) {
    console.error(`[Integration] Failed to notify ${eventType}:`, error.message);
  }
}

/**
 * @param {string} serverName
 * @param {string} serverId
 * @returns {Promise<void>}
 */
async function notifyServerCreated(serverName, serverId) {
  return notifyIntegration('server_created', { serverName, serverId });
}

/**
 * @param {string} serverName
 * @param {string} serverId
 * @returns {Promise<void>}
 */
async function notifyServerStarted(serverName, serverId) {
  return notifyIntegration('server_started', { serverName, serverId });
}

/**
 * @param {string} serverName
 * @param {string} serverId
 * @returns {Promise<void>}
 */
async function notifyServerStopped(serverName, serverId) {
  return notifyIntegration('server_stopped', { serverName, serverId });
}

/**
 * @param {string} serverName
 * @param {string} serverId
 * @returns {Promise<void>}
 */
async function notifyServerDeleted(serverName, serverId) {
  return notifyIntegration('server_deleted', { serverName, serverId });
}

/**
 * @param {string} serverName
 * @param {string} serverId
 * @param {string} error
 * @returns {Promise<void>}
 */
async function notifyServerError(serverName, serverId, error) {
  return notifyIntegration('server_error', { serverName, serverId, error });
}

/**
 * Sync a user to the integration service.
 * @param {Object} userData - User data to sync
 * @returns {Promise<Object|null>} Synced user data or null on failure
 */
async function syncUserToIntegration(userData) {
  if (!userData || !userData.email) {
    console.error('[Integration] Missing userData or email for sync');
    return null;
  }

  try {
    const response = await axios.post(`${INTEGRATION_SERVICE_URL}/api/users`, userData);
    console.log(`[Integration] User synced: ${userData.email}`);
    return response.data;
  } catch (error) {
    console.error(`[Integration] User sync failed:`, error.message);
    return null;
  }
}

/**
 * Fetch unified dashboard metrics from the integration service.
 * @returns {Promise<Object|null>} Metrics data or null on failure
 */
async function getUnifiedMetrics() {
  try {
    const response = await axios.get(`${INTEGRATION_SERVICE_URL}/api/metrics/dashboard`);
    return response.data;
  } catch (error) {
    console.error(`[Integration] Metrics fetch failed:`, error.message);
    return null;
  }
}

/**
 * Broadcast a notification via the integration service.
 * @param {Object} message - Notification message payload
 * @returns {Promise<void>}
 */
async function broadcastNotification(message) {
  if (!message) {
    console.error('[Integration] Missing message for broadcast');
    return;
  }

  try {
    await axios.post(`${INTEGRATION_SERVICE_URL}/api/notifications`, message);
    console.log(`[Integration] Notification broadcast`);
  } catch (error) {
    console.error(`[Integration] Broadcast failed:`, error.message);
  }
}

/**
 * Send a Git push notification to a Discord channel via the integration service.
 * @param {string} repo - Repository name (e.g. 'owner/repo')
 * @param {string} branch - Branch name
 * @param {Array} [commits] - List of commits
 * @param {string} channelId - Discord channel ID
 * @returns {Promise<void>}
 */
async function notifyGitPush(repo, branch, commits, channelId) {
  if (!repo || !branch || !channelId) {
    console.error('[Integration] Missing required parameters for git push notification');
    return;
  }

  try {
    const commitLines = (commits || []).slice(0, 5).map(c =>
      `• \`${c.id?.slice(0, 7) || 'unknown'}\` ${c.message?.split('\n')[0] || 'no message'} — ${c.author?.name || 'unknown'}`
    ).join('\n');

    const message = {
      channel_id: channelId,
      embeds: [{
        title: `🚀 Push to ${repo}:${branch}`,
        description: commitLines || 'No commit details',
        color: 0x2ea043,
        timestamp: new Date().toISOString(),
        footer: { text: `${commits?.length || 0} commit(s) pushed` },
        url: `https://github.com/${repo}/commit/${commits?.[0]?.id || ''}`
      }]
    };

    await axios.post(`${INTEGRATION_SERVICE_URL}/api/notifications/discord`, message);
    console.log(`[Integration] Git push notification sent for ${repo}:${branch}`);
  } catch (error) {
    console.error(`[Integration] Git push notification failed for ${repo}:${branch}:`, error.message);
  }
}

module.exports = {
  notifyIntegration,
  notifyServerCreated,
  notifyServerStarted,
  notifyServerStopped,
  notifyServerDeleted,
  notifyServerError,
  syncUserToIntegration,
  getUnifiedMetrics,
  broadcastNotification,
  notifyGitPush
};