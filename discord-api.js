// discord-api.js
// Discord API v10 helpers for Bot operations.

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_UA = 'DiscordBot (https://github.com/user/discord-share-extension, 1.0.0)';

function botHeaders(botToken) {
  return {
    Authorization: `Bot ${botToken}`,
    'User-Agent': BOT_UA,
  };
}

const DiscordAPI = {
  // ─── Bot API ───────────────────────────────────────────────────────────

  async getBotGuilds(botToken) {
    const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: botHeaders(botToken),
      credentials: 'omit',
    });
    if (!res.ok) throw new Error(`Failed to fetch bot guilds (${res.status})`);
    return res.json();
  },

  getClientIdFromToken(botToken) {
    try {
      return atob(botToken.split('.')[0]);
    } catch (_) {
      return null;
    }
  },

  async getGuildTextChannels(botToken, guildId) {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: botHeaders(botToken),
      credentials: 'omit',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const channels = await res.json();
    return channels
      .filter((c) => c.type === 0)
      .sort((a, b) => a.position - b.position);
  },

  async createWebhook(botToken, channelId, name = 'Discord Share') {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        ...botHeaders(botToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webhook creation failed (${res.status}): ${text}`);
    }
    return res.json();
  },

  getBotInviteUrl(clientId, guildId) {
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'bot',
      permissions: '536871936',
    });
    if (guildId) params.set('guild_id', guildId);
    return `https://discord.com/oauth2/authorize?${params}`;
  },

  getGuildIconUrl(guildId, iconHash, size = 64) {
    if (!iconHash) return null;
    return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=${size}`;
  },

  getUserAvatarUrl(userId, avatarHash, size = 64) {
    if (!avatarHash) return null;
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=${size}`;
  },
};
