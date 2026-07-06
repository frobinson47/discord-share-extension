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

// ─── Discord Bot Setup ──────────────────────────────────────────────────

async function renderDiscordSection() {
  const app = await Storage.getDiscordApp();

  // Dev setup toggle
  const toggle = document.getElementById('dev-setup-toggle');
  const body = document.getElementById('dev-setup-body');
  const chevron = document.getElementById('dev-setup-chevron');

  toggle.addEventListener('click', () => {
    body.classList.toggle('hidden');
    chevron.classList.toggle('open');
  });

  // Pre-fill bot token if saved
  if (app) {
    document.getElementById('app-bot-token').value = app.botToken || '';
  }

  // Save bot token button
  document.getElementById('save-bot-btn').addEventListener('click', async () => {
    const botToken = document.getElementById('app-bot-token').value.trim();

    if (!botToken) {
      showStatus('Bot token is required.', 'error');
      return;
    }

    await Storage.saveDiscordApp({ botToken });
    showStatus('Bot token saved!');
    updateBotUI();
  });

  // Import server button
  document.getElementById('import-server-btn').addEventListener('click', importServerFromDiscord);

  updateBotUI();
}

// ─── Prompt House ───────────────────────────────────────────────────────

async function renderPromptHouseSection() {
  const toggle = document.getElementById('prompthouse-toggle');
  const body = document.getElementById('prompthouse-body');
  const chevron = document.getElementById('prompthouse-chevron');

  toggle.addEventListener('click', () => {
    body.classList.toggle('hidden');
    chevron.classList.toggle('open');
  });

  const config = await Storage.getPromptHouse();
  const keyInput = document.getElementById('ph-api-key');
  const endpointInput = document.getElementById('ph-endpoint');

  if (config) {
    keyInput.value = config.apiKey;
    endpointInput.value = config.endpoint;
  }

  document.getElementById('ph-save-btn').addEventListener('click', async () => {
    const apiKey = keyInput.value.trim();
    const endpoint = endpointInput.value.trim() || 'https://prompthouse.fmrdigital.dev/api/capture';

    if (!apiKey) {
      showStatus('API key is required.', 'error');
      return;
    }

    await Storage.savePromptHouse({ apiKey, endpoint });
    showStatus('Prompt House settings saved!');
  });
}

function updateBotUI() {
  Storage.getDiscordApp().then((app) => {
    const actionsEl = document.getElementById('bot-actions');
    if (app && app.botToken) {
      actionsEl.classList.remove('hidden');
    } else {
      actionsEl.classList.add('hidden');
    }
  });
}

async function importServerFromDiscord() {
  const app = await Storage.getDiscordApp();
  if (!app || !app.botToken) {
    showStatus('Save your bot token first.', 'error');
    return;
  }

  showStatus('Connecting to Discord Gateway…', 'success');

  let guilds;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DISCORD_API', method: 'getGuildsWithChannels', botToken: app.botToken,
    });
    if (result.error) throw new Error(result.error);
    guilds = result;
  } catch (err) {
    showStatus(`Failed to fetch servers: ${err.message}`, 'error');
    return;
  }

  if (!guilds.length) {
    showStatus('Bot is not in any servers. Add it to a server first.', 'error');
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
      <div class="guild-list">${guildListHtml}</div>
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

  // Handle guild selection — channels already included from Gateway
  overlay.querySelectorAll('.guild-row:not(.disabled)').forEach((row) => {
    row.addEventListener('click', async () => {
      overlay.remove();
      const guild = guilds.find(g => g.id === row.dataset.guildId);
      await selectGuildChannels(app, guild);
    });
  });
}

function promptForBotInvite(app) {
  const clientId = DiscordAPI.getClientIdFromToken(app.botToken);
  if (!clientId) {
    showStatus('Could not extract client ID from bot token.', 'error');
    return;
  }
  const inviteUrl = DiscordAPI.getBotInviteUrl(clientId);
  openModal(`
    <h2>Add Bot to a Server</h2>
    <p style="color:#96989d;font-size:13px;line-height:1.5;margin-bottom:12px;">
      Your bot isn't in any servers yet. Use the link below to add it, then try importing again.
    </p>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-cancel>Cancel</button>
      <a href="${inviteUrl}" target="_blank" class="btn btn-primary" data-cancel>Add Bot to Server</a>
    </div>
  `, () => {});
}

async function selectGuildChannels(app, guild) {
  const guildId = guild.id;
  const guildName = guild.name;
  const channels = guild.channels || [];

  if (channels.length === 0) {
    showStatus('No text channels found in this server.', 'error');
    return;
  }

  // Show channel checklist
  const channelListHtml = channels
    .map((c) => `
      <div class="channel-check-row">
        <input type="checkbox" id="ch-${c.id}" value="${c.id}" data-name="${escHtml(c.name)}" />
        <label for="ch-${c.id}"><span class="channel-hash">#</span>${escHtml(c.name)}</label>
      </div>
    `)
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal channel-select-modal">
      <h2>Select Channels</h2>
      <p class="channel-select-server">${escHtml(guildName)}</p>
      <div class="channel-select-toolbar">
        <button class="btn-link" id="select-all-btn">Select all</button>
        <span class="channel-count"><span id="checked-count">0</span> / ${channels.length} selected</span>
      </div>
      <div class="channel-checklist">${channelListHtml}</div>
      <p class="import-progress" id="import-progress"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="import-channels-btn" disabled>Import Selected</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Select all / none toggle
  const selectAllBtn = overlay.querySelector('#select-all-btn');
  const checkedCountEl = overlay.querySelector('#checked-count');
  const importBtn = overlay.querySelector('#import-channels-btn');
  const allCheckboxes = overlay.querySelectorAll('.channel-checklist input[type="checkbox"]');

  function updateCount() {
    const count = overlay.querySelectorAll('.channel-checklist input:checked').length;
    checkedCountEl.textContent = count;
    importBtn.disabled = count === 0;
    selectAllBtn.textContent = count === allCheckboxes.length ? 'Select none' : 'Select all';
  }

  selectAllBtn.addEventListener('click', () => {
    const allChecked = overlay.querySelectorAll('.channel-checklist input:checked').length === allCheckboxes.length;
    allCheckboxes.forEach(cb => { cb.checked = !allChecked; });
    updateCount();
  });

  allCheckboxes.forEach(cb => cb.addEventListener('change', updateCount));

  importBtn.addEventListener('click', async () => {
    const checked = overlay.querySelectorAll('.channel-checklist input:checked');
    if (checked.length === 0) return;

    const progressEl = overlay.querySelector('#import-progress');
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';

    const selectedChannels = Array.from(checked).map(input => ({
      channelId: input.value,
      name: input.dataset.name,
    }));

    // Try auto-creating webhooks via bot API
    const newChannels = [];
    const failedChannels = [];

    for (let i = 0; i < selectedChannels.length; i++) {
      const ch = selectedChannels[i];
      progressEl.textContent = `Creating webhook ${i + 1}/${selectedChannels.length}: #${ch.name}…`;

      try {
        const webhook = await chrome.runtime.sendMessage({
          type: 'DISCORD_API', method: 'createWebhook', botToken: app.botToken, channelId: ch.channelId,
        });
        if (webhook.error) throw new Error(webhook.error);
        newChannels.push({
          id: Storage.generateId(),
          name: `#${ch.name}`,
          webhookUrl: webhook.url,
        });
      } catch (err) {
        failedChannels.push(ch);
        // If first channel fails, skip trying the rest — likely all blocked
        if (i === 0 && selectedChannels.length > 1) {
          failedChannels.push(...selectedChannels.slice(1));
          break;
        }
      }
    }

    overlay.remove();

    // If some/all failed, show manual webhook entry
    if (failedChannels.length > 0) {
      if (newChannels.length > 0) {
        // Save the ones that succeeded first
        const { servers } = await Storage.getConfig();
        servers.push({ id: Storage.generateId(), name: guildName, channels: newChannels });
        await Storage.saveServers(servers);
        await render();
        notifyBackground();
      }
      showManualWebhookEntry(guildName, failedChannels, newChannels.length);
    } else {
      // All succeeded
      const { servers } = await Storage.getConfig();
      servers.push({ id: Storage.generateId(), name: guildName, channels: newChannels });
      await Storage.saveServers(servers);
      await render();
      notifyBackground();
      showStatus(`Imported ${newChannels.length} channels from ${guildName}!`);
    }
  });
}

function showManualWebhookEntry(guildName, failedChannels, alreadyImported) {
  const channelFieldsHtml = failedChannels.map((ch, i) => `
    <div class="manual-webhook-row">
      <label for="wh-${i}"><span class="channel-hash">#</span>${escHtml(ch.name)}</label>
      <input id="wh-${i}" type="url" placeholder="https://discord.com/api/webhooks/..." data-name="${escHtml(ch.name)}" />
    </div>
  `).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal channel-select-modal">
      <h2>Paste Webhook URLs</h2>
      <p class="manual-webhook-hint">
        Auto-creation was blocked. For each channel, create a webhook manually in
        Discord: <strong>Channel Settings → Integrations → Webhooks → New Webhook</strong>,
        then copy the URL and paste it below.
      </p>
      ${alreadyImported > 0 ? `<p class="manual-webhook-note">${alreadyImported} channel(s) imported successfully. ${failedChannels.length} remaining:</p>` : ''}
      <div class="manual-webhook-list">${channelFieldsHtml}</div>
      <p class="modal-error" id="manual-webhook-error"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="save-webhooks-btn">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#save-webhooks-btn').addEventListener('click', async () => {
    const inputs = overlay.querySelectorAll('.manual-webhook-list input');
    const errorEl = overlay.querySelector('#manual-webhook-error');
    const newChannels = [];

    for (const input of inputs) {
      const url = input.value.trim();
      if (!url) continue; // skip empty — user may only fill some
      if (!url.startsWith('https://discord.com/api/webhooks/')) {
        errorEl.textContent = `Invalid URL for #${input.dataset.name}. Must start with https://discord.com/api/webhooks/`;
        input.focus();
        return;
      }
      newChannels.push({
        id: Storage.generateId(),
        name: `#${input.dataset.name}`,
        webhookUrl: url,
      });
    }

    if (newChannels.length === 0) {
      errorEl.textContent = 'Paste at least one webhook URL.';
      return;
    }

    // Add to existing server if we already partially imported, or create new
    const { servers } = await Storage.getConfig();
    const existingServer = servers.find(s => s.name === guildName);
    if (existingServer) {
      existingServer.channels.push(...newChannels);
    } else {
      servers.push({ id: Storage.generateId(), name: guildName, channels: newChannels });
    }
    await Storage.saveServers(servers);
    await render();
    notifyBackground();

    overlay.remove();
    showStatus(`Saved ${newChannels.length} channels!`);
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
  await renderPromptHouseSection();

  document.getElementById('add-server-btn').addEventListener('click', addServer);
  document.getElementById('export-btn').addEventListener('click', exportConfig);

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importConfig(e.target.files[0]);
  });
});
