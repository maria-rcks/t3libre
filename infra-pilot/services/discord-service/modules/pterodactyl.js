const axios = require('axios');

const PTERODACTYL_API_URL = process.env.PTERODACTYL_API_URL;
const PTERODACTYL_API_KEY = process.env.PTERODACTYL_API_KEY;

async function createUser(userData) {
  const response = await axios.post(`${PTERODACTYL_API_URL}/api/application/users`, userData, {
    headers: {
      'Authorization': `Bearer ${PTERODACTYL_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  return response.data.attributes;
}

async function createServer(serverData) {
  const response = await axios.post(`${PTERODACTYL_API_URL}/api/application/servers`, serverData, {
    headers: {
      'Authorization': `Bearer ${PTERODACTYL_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  return response.data.attributes;
}

module.exports = { createUser, createServer };
