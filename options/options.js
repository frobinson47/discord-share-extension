// options/options.js

// ─── Helpers ───────────────────────────────────────────────────────────────

function showStatus(message, type = 'success') {
  const el = document.getElementById('status-message');
  el.textContent = message;
  el.className = `status ${type}`;
  setTimeout(() => { el.className = 'status hidden'; }, 3000);
}

function maskWebhook(url) {
  // Show last 6 chars only: "webhook ••••••abc123"
  if (!url) return '';
  const tail = url.slice(-6);
  return `•••••••••${tail}`;
}

function openModal(html, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('[data-confirm]')?.addEventListener('click', () => {
    onConfirm(overlay);
  });
  overlay.querySelector('[data-cancel]')?.addEventListener('click', () => {
    overlay.remove();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  return overlay;
}

// ─── Render ────────────────────────────────────────────────────────────────

async function render() {
  const { servers } = await Storage.getConfig();
  const list = document.getElementById('servers-list');
  list.innerHTML = '';

  if (servers.length === 0) {
    list.innerHTML = '<p style="color:#96989d;font-size:14px;margin-bottom:16px;">No servers yet. Add one to get started.</p>';
    return;
  }

  for (const server of servers) {
    list.appendChild(buildServerBlock(server, servers));
  }
}

function buildServerBlock(server, allServers) {
  const block = document.createElement('div');
  block.className = 'server-block';
  block.dataset.serverId = server.id;

  const channelsHtml = (server.channels || []).map(ch => `
    <div class="channel-row" data-channel-id="${ch.id}">
      <span class="channel-name">${escHtml(ch.name)}</span>
      <span class="webhook-mask">${maskWebhook(ch.webhookUrl)}</span>
      <button class="btn btn-small btn-secondary test-webhook-btn" data-channel-id="${ch.id}">Test</button>
      <button class="btn btn-danger delete-channel-btn" data-channel-id="${ch.id}">✕</button>
    </div>
  `).join('');

  block.innerHTML = `
    <div class="server-header">
      <span class="chevron">▼</span>
      <span class="server-name">${escHtml(server.name)}</span>
      <div class="server-actions">
        <button class="btn btn-icon rename-server-btn" title="Rename">✎</button>
        <button class="btn btn-danger delete-server-btn" title="Delete">✕</button>
      </div>
    </div>
    <div class="server-channels">
      ${channelsHtml}
      <div class="add-channel-row">
        <button class="btn btn-small btn-secondary add-channel-btn">+ Add Channel</button>
      </div>
    </div>
  `;

  // Collapse toggle
  block.querySelector('.server-header').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    block.classList.toggle('collapsed');
  });

  // Rename server
  block.querySelector('.rename-server-btn').addEventListener('click', () => renameServer(server.id));

  // Delete server
  block.querySelector('.delete-server-btn').addEventListener('click', () => deleteServer(server.id));

  // Add channel
  block.querySelector('.add-channel-btn').addEventListener('click', () => addChannel(server.id));

  // Per-channel actions
  block.querySelectorAll('.test-webhook-btn').forEach(btn => {
    btn.addEventListener('click', () => testWebhook(btn.dataset.channelId));
  });
  block.querySelectorAll('.delete-channel-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteChannel(server.id, btn.dataset.channelId));
  });

  return block;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

function addServer() {
  openModal(`
    <h2>Add Server</h2>
    <label>Server name (just a label)</label>
    <input id="modal-server-name" type="text" placeholder="e.g. My Dev Server" autofocus />
    <div class="modal-actions">
      <button class="btn btn-secondary" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-confirm>Add Server</button>
    </div>
  `, async (overlay) => {
    const name = overlay.querySelector('#modal-server-name').value.trim();
    if (!name) return;
    const { servers } = await Storage.getConfig();
    servers.push({ id: Storage.generateId(), name, channels: [] });
    await Storage.saveServers(servers);
    overlay.remove();
    await render();
    notifyBackground();
  });
  document.getElementById('modal-server-name')?.focus();
}

async function renameServer(serverId) {
  const { servers } = await Storage.getConfig();
  const server = servers.find(s => s.id === serverId);
  if (!server) return;

  openModal(`
    <h2>Rename Server</h2>
    <input id="modal-rename" type="text" value="${escHtml(server.name)}" autofocus />
    <div class="modal-actions">
      <button class="btn btn-secondary" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-confirm>Save</button>
    </div>
  `, async (overlay) => {
    const name = overlay.querySelector('#modal-rename').value.trim();
    if (!name) return;
    server.name = name;
    await Storage.saveServers(servers);
    overlay.remove();
    await render();
    notifyBackground();
  });
}

async function deleteServer(serverId) {
  const { servers } = await Storage.getConfig();
  const updated = servers.filter(s => s.id !== serverId);
  await Storage.saveServers(updated);
  await render();
  notifyBackground();
  showStatus('Server removed.');
}

function addChannel(serverId) {
  const overlay = openModal(`
    <h2>Add Channel</h2>
    <label>Channel name</label>
    <input id="modal-ch-name" type="text" placeholder="e.g. #links" />
    <label>Webhook URL</label>
    <input id="modal-ch-webhook" type="url" placeholder="https://discord.com/api/webhooks/..." />
    <p class="modal-error" id="modal-ch-error"></p>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-confirm>Add Channel</button>
    </div>
  `, async (ov) => {
    const name = ov.querySelector('#modal-ch-name').value.trim();
    const webhookUrl = ov.querySelector('#modal-ch-webhook').value.trim();
    const errorEl = ov.querySelector('#modal-ch-error');

    if (!name || !webhookUrl) {
      errorEl.textContent = 'Both fields are required.';
      return;
    }
    if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
      errorEl.textContent = 'URL must start with https://discord.com/api/webhooks/';
      return;
    }

    // Test the webhook before saving
    errorEl.textContent = 'Testing webhook…';
    const result = await testWebhookUrl(webhookUrl, '✅ Discord Share connected successfully!');
    if (!result.ok) {
      errorEl.textContent = `Webhook test failed: ${result.error}`;
      return;
    }

    const { servers } = await Storage.getConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) return;
    server.channels.push({ id: Storage.generateId(), name, webhookUrl });
    await Storage.saveServers(servers);
    ov.remove();
    await render();
    notifyBackground();
    showStatus('Channel added!');
  });
}

async function deleteChannel(serverId, channelId) {
  const { servers } = await Storage.getConfig();
  const server = servers.find(s => s.id === serverId);
  if (!server) return;
  server.channels = server.channels.filter(c => c.id !== channelId);
  await Storage.saveServers(servers);
  await render();
  notifyBackground();
  showStatus('Channel removed.');
}

async function testWebhook(channelId) {
  const found = await Storage.findChannel(channelId);
  if (!found) return;
  const result = await testWebhookUrl(found.channel.webhookUrl, '🔔 Test from Discord Share!');
  showStatus(result.ok ? 'Test message sent!' : `Test failed: ${result.error}`, result.ok ? 'success' : 'error');
}

async function testWebhookUrl(url, message) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Export / Import ───────────────────────────────────────────────────────

async function exportConfig() {
  const config = await Storage.getConfig();
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'discord-share-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importConfig(file) {
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    if (!Array.isArray(config.servers)) throw new Error('Invalid config format');
    await Storage.saveServers(config.servers);
    await render();
    notifyBackground();
    showStatus('Config imported!');
  } catch (err) {
    showStatus(`Import failed: ${err.message}`, 'error');
  }
}

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

  // Show redirect URL so user can copy it into Discord OAuth2 settings
  const redirectUrlInput = document.getElementById('app-redirect-url');
  const redirectUrl = chrome.identity.getRedirectURL('oauth2');
  redirectUrlInput.value = redirectUrl;
  redirectUrlInput.addEventListener('click', () => {
    redirectUrlInput.select();
    navigator.clipboard.writeText(redirectUrl);
    showStatus('Redirect URL copied to clipboard!');
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

// ─── Tell background to rebuild context menus ─────────────────────────────

function notifyBackground() {
  chrome.runtime.sendMessage({ type: 'REBUILD_CONTEXT_MENUS' });
}

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await render();
  await renderDiscordSection();

  document.getElementById('add-server-btn').addEventListener('click', addServer);
  document.getElementById('export-btn').addEventListener('click', exportConfig);

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importConfig(e.target.files[0]);
  });
});
