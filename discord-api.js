// discord-api.js
// Discord API v10 helpers for OAuth2 and Bot operations.

const DISCORD_API = 'https://discord.com/api/v10';

const DiscordAPI = {
  // ─── OAuth2 ──────────────────────────────────────────────────────────

  // Returns the OAuth2 authorize URL for the user to grant access.
  getAuthorizeUrl(clientId, redirectUri) {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'identify guilds',
      redirect_uri: redirectUri,
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  },

  // Exchanges an authorization code for access + refresh tokens.
  async exchangeCode(clientId, clientSecret, code, redirectUri) {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    return res.json();
  },

  // Refreshes an expired access token using the refresh token.
  async refreshToken(clientId, clientSecret, refreshToken) {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }
    return res.json();
  },

  // Returns a valid access token, auto-refreshing if expired.
  async getValidAccessToken() {
    const auth = await Storage.getDiscordAuth();
    if (!auth) return null;

    if (auth.expiresAt && Date.now() < auth.expiresAt - 60000) {
      return auth.accessToken;
    }

    const app = await Storage.getDiscordApp();
    if (!app || !auth.refreshToken) return null;

    try {
      const tokens = await this.refreshToken(app.clientId, app.clientSecret, auth.refreshToken);
      const newAuth = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        user: auth.user,
      };
      await Storage.saveDiscordAuth(newAuth);
      return newAuth.accessToken;
    } catch (_) {
      await Storage.removeDiscordAuth();
      return null;
    }
  },

  // ─── User API (OAuth token) ──────────────────────────────────────────

  async getCurrentUser(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch user (${res.status})`);
    return res.json();
  },

  async getUserGuilds(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch guilds (${res.status})`);
    return res.json();
  },

  // ─── Bot API (bot token) ─────────────────────────────────────────────

  async getGuildTextChannels(botToken, guildId) {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) return null;
      throw new Error(`Failed to fetch channels (${res.status})`);
    }
    const channels = await res.json();
    return channels
      .filter((c) => c.type === 0)
      .sort((a, b) => a.position - b.position);
  },

  async createWebhook(botToken, channelId, name = 'Discord Share') {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
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
      permissions: '536870912',
      guild_id: guildId,
    });
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
