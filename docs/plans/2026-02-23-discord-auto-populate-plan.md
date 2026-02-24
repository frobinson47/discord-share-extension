# Discord Auto-Populate Channels — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OAuth2 + Bot integration so users can connect their Discord account, browse servers, select channels, and auto-create webhooks — while keeping manual entry as a fallback.

**Architecture:** A new `discord-api.js` module handles all Discord API interactions (OAuth2 token exchange, guild/channel listing, webhook creation). The storage module gets new methods for `discordApp` and `discordAuth` data. The options page gains a "Discord Connection" section above the existing server list. No changes needed to popup, background worker, or content script — imported channels use the same storage schema.

**Tech Stack:** Discord API v10, `chrome.identity.launchWebAuthFlow`, `chrome.storage.sync`

---

## Task 1: Update Manifest — New Permissions

**Files:**
- Modify: `manifest.json`

**Step 1: Add identity permission and Discord API host permission**

Update `manifest.json` — add `"identity"` to permissions and `"https://discord.com/api/*"` to host_permissions:

```json
{
  "permissions": ["storage", "contextMenus", "scripting", "activeTab", "tabs", "identity"],
  "host_permissions": ["https://discord.com/api/webhooks/*", "https://discord.com/api/*"]
}
```

Note: `https://discord.com/api/webhooks/*` is technically a subset of `https://discord.com/api/*`, but keeping both is fine for clarity. If you prefer, collapse to just `"https://discord.com/api/*"`.

**Step 2: Reload extension and verify**

1. Open `chrome://extensions` → click reload on Discord Share
2. Verify: No errors on the extensions page
3. Open DevTools on the service worker → no errors

**Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add identity permission and Discord API host permission"
```

---

## Task 2: Extend Storage Module

**Files:**
- Modify: `storage.js`

**Step 1: Add Discord app credentials methods**

Add these methods to the `Storage` object in `storage.js`, after the existing `generateId()` method:

```js
  // ─── Discord App Credentials ───────────────────────────────────────────

  async getDiscordApp() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['discordApp'], (result) => {
        resolve(result.discordApp || null);
      });
    });
  },

  async saveDiscordApp(discordApp) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ discordApp }, resolve);
    });
  },

  async removeDiscordApp() {
    return new Promise((resolve) => {
      chrome.storage.sync.remove('discordApp', resolve);
    });
  },

  // ─── Discord Auth (OAuth tokens) ──────────────────────────────────────

  async getDiscordAuth() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['discordAuth'], (result) => {
        resolve(result.discordAuth || null);
      });
    });
  },

  async saveDiscordAuth(discordAuth) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ discordAuth }, resolve);
    });
  },

  async removeDiscordAuth() {
    return new Promise((resolve) => {
      chrome.storage.sync.remove('discordAuth', resolve);
    });
  },
```

**Step 2: Verify in DevTools**

1. Reload extension
2. Open options page → DevTools console
3. Run: `Storage.getDiscordApp().then(console.log)` → should print `null`
4. Run: `Storage.getDiscordAuth().then(console.log)` → should print `null`

**Step 3: Commit**

```bash
git add storage.js
git commit -m "feat: add Discord app and auth storage methods"
```

---

## Task 3: Discord API Module

**Files:**
- Create: `discord-api.js`

**Step 1: Write discord-api.js**

This module handles all Discord API interactions. It depends on `Storage` being loaded first (via script tag ordering).

```js
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
  // Returns { access_token, refresh_token, expires_in, ... } or throws.
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
  // Returns null if no auth is stored or refresh fails.
  async getValidAccessToken() {
    const auth = await Storage.getDiscordAuth();
    if (!auth) return null;

    // If token is still valid (with 60s buffer), return it
    if (auth.expiresAt && Date.now() < auth.expiresAt - 60000) {
      return auth.accessToken;
    }

    // Try to refresh
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
      // Refresh failed — clear auth, user needs to reconnect
      await Storage.removeDiscordAuth();
      return null;
    }
  },

  // ─── User API (OAuth token) ──────────────────────────────────────────

  // Fetches the authenticated user's profile.
  async getCurrentUser(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch user (${res.status})`);
    return res.json();
  },

  // Fetches the user's guild (server) list.
  async getUserGuilds(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch guilds (${res.status})`);
    return res.json();
  },

  // ─── Bot API (bot token) ─────────────────────────────────────────────

  // Fetches all channels in a guild using the bot token.
  // Returns only text channels (type 0).
  async getGuildTextChannels(botToken, guildId) {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) return null; // Bot not in guild
      throw new Error(`Failed to fetch channels (${res.status})`);
    }
    const channels = await res.json();
    return channels
      .filter((c) => c.type === 0) // text channels only
      .sort((a, b) => a.position - b.position);
  },

  // Creates a webhook in a channel using the bot token.
  // Returns the webhook object { id, token, url, ... } or throws.
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

  // Returns the bot invite URL for a specific guild with Manage Webhooks permission.
  getBotInviteUrl(clientId, guildId) {
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'bot',
      permissions: '536870912', // Manage Webhooks
      guild_id: guildId,
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  },

  // Helper: get Discord CDN URL for a guild icon.
  getGuildIconUrl(guildId, iconHash, size = 64) {
    if (!iconHash) return null;
    return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=${size}`;
  },

  // Helper: get Discord CDN URL for a user avatar.
  getUserAvatarUrl(userId, avatarHash, size = 64) {
    if (!avatarHash) return null;
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=${size}`;
  },
};
```

**Step 2: Verify module loads**

1. Add `<script src="../discord-api.js"></script>` to `options/options.html` (after `storage.js`, before `options.js`)
2. Reload extension → open options page
3. DevTools console: `typeof DiscordAPI` → should print `"object"`
4. Run: `DiscordAPI.getAuthorizeUrl('test', 'http://example.com')` → should return a valid URL string

**Step 3: Commit**

```bash
git add discord-api.js
git commit -m "feat: Discord API module for OAuth2 and bot operations"
```

---

## Task 4: Options HTML — Discord Connection Section

**Files:**
- Modify: `options/options.html`

**Step 1: Add Discord connection section to HTML**

Insert the following between `</header>` and `<div id="servers-list">` in `options/options.html`:

```html
    <!-- Discord Connection -->
    <div id="discord-section" class="discord-section">
      <!-- Developer Setup (collapsible) -->
      <div id="dev-setup" class="dev-setup">
        <div class="dev-setup-header" id="dev-setup-toggle">
          <span class="chevron" id="dev-setup-chevron">▶</span>
          <span>Developer Setup</span>
        </div>
        <div id="dev-setup-body" class="dev-setup-body hidden">
          <p class="dev-setup-hint">Create a <a href="https://discord.com/developers/applications" target="_blank">Discord Application</a>, enable its Bot, and paste the credentials below.</p>
          <label>Client ID</label>
          <input id="app-client-id" type="text" placeholder="e.g. 123456789012345678" />
          <label>Client Secret</label>
          <input id="app-client-secret" type="password" placeholder="e.g. abcdef..." />
          <label>Bot Token</label>
          <input id="app-bot-token" type="password" placeholder="e.g. MTIz..." />
          <div class="dev-setup-actions">
            <button id="save-app-btn" class="btn btn-primary btn-small">Save Credentials</button>
          </div>
        </div>
      </div>

      <!-- Not connected state -->
      <div id="discord-disconnected" class="discord-status hidden">
        <button id="connect-discord-btn" class="btn btn-primary" disabled>Connect Discord</button>
        <p class="discord-hint">Save your app credentials above first.</p>
      </div>

      <!-- Connected state -->
      <div id="discord-connected" class="discord-status hidden">
        <div class="discord-user-info">
          <img id="discord-avatar" class="discord-avatar" src="" alt="" />
          <span id="discord-username" class="discord-username"></span>
          <button id="disconnect-discord-btn" class="btn btn-small btn-secondary">Disconnect</button>
        </div>
        <button id="import-server-btn" class="btn btn-primary">Import Server from Discord</button>
      </div>
    </div>

    <hr class="divider" />
```

Also add the `discord-api.js` script tag. The script tags at the bottom should be:

```html
  <script src="../storage.js"></script>
  <script src="../discord-api.js"></script>
  <script src="options.js"></script>
```

**Step 2: Verify HTML loads**

1. Reload extension → open options page
2. Verify: "Developer Setup" section appears above the server list with a collapsible header
3. No JS errors in DevTools

**Step 3: Commit**

```bash
git add options/options.html
git commit -m "feat: options HTML for Discord connection section"
```

---

## Task 5: Options CSS — Discord Connection Styles

**Files:**
- Modify: `options/options.css`

**Step 1: Add Discord connection styles**

Append the following to the end of `options/options.css`:

```css
/* ─── Discord Connection Section ─────────────────────────────────────── */

.discord-section {
  margin-bottom: 20px;
}

.dev-setup {
  background: #2b2d31;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.dev-setup-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  font-weight: 600;
  color: #96989d;
}
.dev-setup-header:hover { color: #dcddde; }
.dev-setup-header .chevron { font-size: 12px; transition: transform 0.2s; }
.dev-setup-header .chevron.open { transform: rotate(90deg); }

.dev-setup-body {
  padding: 0 16px 16px;
}
.dev-setup-body.hidden { display: none; }

.dev-setup-hint {
  font-size: 13px;
  color: #96989d;
  margin-bottom: 8px;
  line-height: 1.4;
}
.dev-setup-hint a { color: #5865f2; text-decoration: none; }
.dev-setup-hint a:hover { text-decoration: underline; }

.dev-setup-body label {
  display: block;
  font-size: 13px;
  color: #96989d;
  margin-bottom: 4px;
  margin-top: 10px;
}
.dev-setup-body input {
  width: 100%;
  background: #1e1f22;
  border: 1px solid #4e5058;
  border-radius: 5px;
  color: #dcddde;
  padding: 8px 10px;
  font-size: 14px;
}
.dev-setup-body input:focus { outline: none; border-color: #5865f2; }

.dev-setup-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

/* Discord status (connected / disconnected) */
.discord-status { margin-top: 12px; }
.discord-status.hidden { display: none; }

.discord-hint {
  font-size: 13px;
  color: #96989d;
  margin-top: 6px;
}

.discord-user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.discord-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #4e5058;
}

.discord-username {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.divider {
  border: none;
  border-top: 1px solid #3f4147;
  margin: 20px 0;
}

/* Import server modal */
.guild-list {
  max-height: 300px;
  overflow-y: auto;
  margin: 12px 0;
}

.guild-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.guild-row:hover { background: #1e1f22; }
.guild-row.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.guild-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #4e5058;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #fff;
  overflow: hidden;
}
.guild-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.guild-name { flex: 1; font-size: 14px; }
.guild-status { font-size: 12px; color: #96989d; }

/* Channel checklist in import modal */
.channel-checklist {
  max-height: 250px;
  overflow-y: auto;
  margin: 12px 0;
}

.channel-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
}
.channel-check-row:hover { background: #1e1f22; }
.channel-check-row input[type="checkbox"] { accent-color: #5865f2; }
.channel-check-row label { cursor: pointer; font-size: 14px; flex: 1; }

.import-progress {
  font-size: 13px;
  color: #96989d;
  margin-top: 8px;
  min-height: 18px;
}
```

**Step 2: Verify styles**

1. Reload extension → open options page
2. Verify: Developer Setup section has correct dark styling, collapsible chevron renders
3. No layout issues

**Step 3: Commit**

```bash
git add options/options.css
git commit -m "feat: CSS for Discord connection section and import modals"
```

---

## Task 6: Options JS — Developer Setup & OAuth2 Flow

**Files:**
- Modify: `options/options.js`

**Step 1: Add Discord connection logic**

Add the following code to `options/options.js`, between the `// ─── Export / Import` section and the `// ─── Tell background` section:

```js
// ─── Discord Connection ─────────────────────────────────────────────────

async function renderDiscordSection() {
  const app = await Storage.getDiscordApp();
  const auth = await Storage.getDiscordAuth();

  // Dev setup toggle
  const toggle = document.getElementById('dev-setup-toggle');
  const body = document.getElementById('dev-setup-body');
  const chevron = document.getElementById('dev-setup-chevron');

  toggle.addEventListener('click', () => {
    body.classList.toggle('hidden');
    chevron.classList.toggle('open');
  });

  // Pre-fill credentials if saved
  if (app) {
    document.getElementById('app-client-id').value = app.clientId || '';
    document.getElementById('app-client-secret').value = app.clientSecret || '';
    document.getElementById('app-bot-token').value = app.botToken || '';
  }

  // Save credentials button
  document.getElementById('save-app-btn').addEventListener('click', async () => {
    const clientId = document.getElementById('app-client-id').value.trim();
    const clientSecret = document.getElementById('app-client-secret').value.trim();
    const botToken = document.getElementById('app-bot-token').value.trim();

    if (!clientId || !clientSecret || !botToken) {
      showStatus('All three fields are required.', 'error');
      return;
    }

    await Storage.saveDiscordApp({ clientId, clientSecret, botToken });
    showStatus('Credentials saved!');
    updateDiscordUI();
  });

  // Connect button
  document.getElementById('connect-discord-btn').addEventListener('click', connectDiscord);

  // Disconnect button
  document.getElementById('disconnect-discord-btn').addEventListener('click', async () => {
    await Storage.removeDiscordAuth();
    showStatus('Disconnected from Discord.');
    updateDiscordUI();
  });

  // Import server button
  document.getElementById('import-server-btn').addEventListener('click', importServerFromDiscord);

  updateDiscordUI();
}

async function updateDiscordUI() {
  const app = await Storage.getDiscordApp();
  const auth = await Storage.getDiscordAuth();

  const disconnectedEl = document.getElementById('discord-disconnected');
  const connectedEl = document.getElementById('discord-connected');
  const connectBtn = document.getElementById('connect-discord-btn');

  if (auth && auth.accessToken) {
    // Connected state
    disconnectedEl.classList.add('hidden');
    connectedEl.classList.remove('hidden');

    if (auth.user) {
      const avatarUrl = DiscordAPI.getUserAvatarUrl(auth.user.id, auth.user.avatar);
      document.getElementById('discord-avatar').src = avatarUrl || '';
      document.getElementById('discord-avatar').style.display = avatarUrl ? 'block' : 'none';
      document.getElementById('discord-username').textContent = auth.user.username;
    }
  } else {
    // Disconnected state
    connectedEl.classList.add('hidden');
    disconnectedEl.classList.remove('hidden');

    // Enable connect button only if credentials are saved
    if (app && app.clientId && app.clientSecret) {
      connectBtn.disabled = false;
      disconnectedEl.querySelector('.discord-hint').textContent = 'Click to authorize with Discord.';
    } else {
      connectBtn.disabled = true;
      disconnectedEl.querySelector('.discord-hint').textContent = 'Save your app credentials above first.';
    }
  }
}

async function connectDiscord() {
  const app = await Storage.getDiscordApp();
  if (!app) return;

  const redirectUri = chrome.identity.getRedirectURL('oauth2');
  const authorizeUrl = DiscordAPI.getAuthorizeUrl(app.clientId, redirectUri);

  try {
    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authorizeUrl, interactive: true },
        (redirectUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(redirectUrl);
          }
        }
      );
    });

    // Extract code from redirect URL
    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('No authorization code received');

    // Exchange code for tokens
    const tokens = await DiscordAPI.exchangeCode(
      app.clientId, app.clientSecret, code, redirectUri
    );

    // Fetch user info
    const user = await DiscordAPI.getCurrentUser(tokens.access_token);

    // Save auth
    await Storage.saveDiscordAuth({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      user: { id: user.id, username: user.username, avatar: user.avatar },
    });

    showStatus(`Connected as ${user.username}!`);
    updateDiscordUI();
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, 'error');
  }
}
```

**Step 2: Wire up in DOMContentLoaded**

In the existing `document.addEventListener('DOMContentLoaded', ...)` handler at the bottom of `options.js`, add this line right after `await render();`:

```js
  await renderDiscordSection();
```

**Step 3: Verify OAuth flow**

1. Reload extension → open options page
2. Click "Developer Setup" → verify it expands
3. Enter your Discord app's Client ID, Client Secret, and Bot Token → click "Save Credentials"
4. Verify: "Credentials saved!" status appears, "Connect Discord" button becomes enabled
5. Click "Connect Discord" → Discord OAuth popup should open
6. Authorize → verify: popup closes, your Discord username appears in the connected state
7. Reload options page → verify: connected state persists

**Step 4: Commit**

```bash
git add options/options.js
git commit -m "feat: developer setup and OAuth2 connect/disconnect flow"
```

---

## Task 7: Options JS — Import Server Modal (Server List)

**Files:**
- Modify: `options/options.js`

**Step 1: Add importServerFromDiscord function**

Add this after the `connectDiscord` function in `options/options.js`:

```js
async function importServerFromDiscord() {
  const app = await Storage.getDiscordApp();
  const accessToken = await DiscordAPI.getValidAccessToken();
  if (!app || !accessToken) {
    showStatus('Session expired. Please reconnect Discord.', 'error');
    updateDiscordUI();
    return;
  }

  let guilds;
  try {
    guilds = await DiscordAPI.getUserGuilds(accessToken);
  } catch (err) {
    showStatus(`Failed to fetch servers: ${err.message}`, 'error');
    return;
  }

  // Check which servers are already imported (by name match)
  const { servers: existingServers } = await Storage.getConfig();
  const existingNames = new Set(existingServers.map((s) => s.name.toLowerCase()));

  const guildListHtml = guilds
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => {
      const alreadyImported = existingNames.has(g.name.toLowerCase());
      const iconUrl = DiscordAPI.getGuildIconUrl(g.id, g.icon);
      const iconInner = iconUrl
        ? `<img src="${iconUrl}" alt="" />`
        : escHtml(g.name.charAt(0).toUpperCase());
      return `
        <div class="guild-row ${alreadyImported ? 'disabled' : ''}"
             data-guild-id="${g.id}" data-guild-name="${escHtml(g.name)}">
          <div class="guild-icon">${iconInner}</div>
          <span class="guild-name">${escHtml(g.name)}</span>
          <span class="guild-status">${alreadyImported ? 'Already imported' : ''}</span>
        </div>
      `;
    })
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:480px;">
      <h2>Select a Server</h2>
      <div class="guild-list">${guildListHtml || '<p style="color:#96989d;">No servers found.</p>'}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-cancel>Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Handle guild selection
  overlay.querySelectorAll('.guild-row:not(.disabled)').forEach((row) => {
    row.addEventListener('click', async () => {
      overlay.remove();
      await selectGuildChannels(
        app,
        row.dataset.guildId,
        row.dataset.guildName
      );
    });
  });
}
```

**Step 2: Verify server list modal**

1. Reload extension → open options page (must be connected to Discord)
2. Click "Import Server from Discord"
3. Verify: Modal appears with your Discord server list, icons, names
4. Verify: Any previously imported servers appear grayed out

**Step 3: Commit**

```bash
git add options/options.js
git commit -m "feat: import server modal with Discord guild list"
```

---

## Task 8: Options JS — Channel Selection & Webhook Creation

**Files:**
- Modify: `options/options.js`

**Step 1: Add selectGuildChannels function**

Add this after the `importServerFromDiscord` function:

```js
async function selectGuildChannels(app, guildId, guildName) {
  // Try to fetch channels with bot token
  let channels;
  try {
    channels = await DiscordAPI.getGuildTextChannels(app.botToken, guildId);
  } catch (err) {
    showStatus(`Failed to fetch channels: ${err.message}`, 'error');
    return;
  }

  // Bot not in server
  if (channels === null) {
    const inviteUrl = DiscordAPI.getBotInviteUrl(app.clientId, guildId);
    openModal(`
      <h2>Bot Required</h2>
      <p style="color:#96989d;font-size:14px;line-height:1.5;margin-bottom:12px;">
        The bot needs to be added to <strong>${escHtml(guildName)}</strong> to access channels and create webhooks.
      </p>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-confirm>Add Bot to Server</button>
      </div>
    `, (overlay) => {
      window.open(inviteUrl, '_blank');
      overlay.remove();
      showStatus('After adding the bot, click "Import Server" again.', 'success');
    });
    return;
  }

  if (channels.length === 0) {
    showStatus('No text channels found in this server.', 'error');
    return;
  }

  // Show channel checklist
  const channelListHtml = channels
    .map((c) => `
      <div class="channel-check-row">
        <input type="checkbox" id="ch-${c.id}" value="${c.id}" data-name="${escHtml(c.name)}" />
        <label for="ch-${c.id}">#${escHtml(c.name)}</label>
      </div>
    `)
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:480px;">
      <h2>Select Channels — ${escHtml(guildName)}</h2>
      <div class="channel-checklist">${channelListHtml}</div>
      <p class="import-progress" id="import-progress"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="import-channels-btn">Import Selected</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#import-channels-btn').addEventListener('click', async () => {
    const checked = overlay.querySelectorAll('.channel-checklist input:checked');
    if (checked.length === 0) return;

    const progressEl = overlay.querySelector('#import-progress');
    const importBtn = overlay.querySelector('#import-channels-btn');
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';

    const newChannels = [];
    let failed = 0;

    for (let i = 0; i < checked.length; i++) {
      const input = checked[i];
      progressEl.textContent = `Creating webhook ${i + 1}/${checked.length}: #${input.dataset.name}…`;

      try {
        const webhook = await DiscordAPI.createWebhook(app.botToken, input.value);
        newChannels.push({
          id: Storage.generateId(),
          name: `#${input.dataset.name}`,
          webhookUrl: webhook.url,
        });
      } catch (err) {
        failed++;
        console.warn(`Failed to create webhook for #${input.dataset.name}:`, err);
      }
    }

    if (newChannels.length > 0) {
      const { servers } = await Storage.getConfig();
      servers.push({
        id: Storage.generateId(),
        name: guildName,
        channels: newChannels,
      });
      await Storage.saveServers(servers);
      await render();
      notifyBackground();
    }

    overlay.remove();

    if (failed > 0) {
      showStatus(`Imported ${newChannels.length} channels (${failed} failed).`, newChannels.length > 0 ? 'success' : 'error');
    } else {
      showStatus(`Imported ${newChannels.length} channels from ${guildName}!`);
    }
  });
}
```

**Step 2: Verify full import flow**

1. Reload extension → open options page (connected to Discord)
2. Click "Import Server from Discord" → pick a server
3. **If bot not in server:** "Bot Required" modal appears → click "Add Bot to Server" → authorize in Discord → come back and try again
4. **If bot in server:** Channel checklist appears → check 2-3 channels → click "Import Selected"
5. Verify: Progress shows "Creating webhook 1/3…" etc.
6. Verify: Server block appears in the options page with the imported channels
7. Verify: Webhook masks show in each channel row
8. Click "Test" on an imported channel → verify test message appears in Discord
9. Right-click any webpage → "Send to Discord" → verify imported channels appear in context menu

**Step 3: Commit**

```bash
git add options/options.js
git commit -m "feat: channel selection with auto webhook creation on import"
```

---

## Task 9: Final Polish

**Files:**
- Modify: `options/options.html` (verify script order is correct)
- Modify: `manifest.json` (verify permissions are correct)

**Step 1: Verify manifest has all needed permissions**

Open `manifest.json` and confirm it contains:
```json
"permissions": ["storage", "contextMenus", "scripting", "activeTab", "tabs", "identity"],
"host_permissions": ["https://discord.com/api/webhooks/*", "https://discord.com/api/*"]
```

**Step 2: Verify options.html script tag order**

Confirm the bottom of `options/options.html` has:
```html
  <script src="../storage.js"></script>
  <script src="../discord-api.js"></script>
  <script src="options.js"></script>
```

**Step 3: End-to-end verification**

1. **Fresh start:** Clear extension storage (DevTools → Application → Storage → Clear)
2. Open options → enter Discord app credentials → save
3. Connect Discord → authorize → verify username shows
4. Import Server → pick server → add bot if needed → select channels → import
5. Verify channels appear in options page with masked webhooks
6. Test a webhook → verify Discord receives message
7. Open popup → verify imported channels appear in channel list
8. Right-click page → "Send to Discord" → verify context menu has imported channels
9. Send a message via popup → verify it arrives in Discord
10. Manually add a server + channel (old flow) → verify both coexist
11. Export config → verify JSON includes both manual and imported servers
12. Disconnect Discord → verify UI returns to disconnected state, servers remain

**Step 4: Commit**

```bash
git add manifest.json options/options.html
git commit -m "feat: finalize Discord auto-populate integration"
```

---

## Done

After completing all 9 tasks, the extension supports two ways to add channels:
1. **Discord OAuth + Bot** (new): Connect → pick server → select channels → auto-create webhooks
2. **Manual webhook entry** (existing): Add server → add channel with webhook URL

Both produce identical storage entries. Popup, background worker, and content script require zero changes.
