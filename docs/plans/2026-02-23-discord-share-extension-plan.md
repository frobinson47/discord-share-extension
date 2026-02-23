# Discord Share Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome/Edge MV3 extension that sends selected text, links, and images to Discord channels via webhooks, with a server-grouped settings page and a popup UI for composing + confirming before send.

**Architecture:** Plain HTML/CSS/JS (no bundler). Background service worker handles context menus and webhook POSTs. Content script captures page selections. Popup pre-fills from captured data. All config stored in `chrome.storage.sync`.

**Tech Stack:** Manifest V3, `chrome.storage.sync`, `chrome.storage.session`, `chrome.scripting`, `chrome.contextMenus`, Discord Webhook API (HTTP POST + JSON embeds)

---

## Task 1: Scaffold — Folder Structure, Manifest, Icons

**Files:**
- Create: `manifest.json`
- Create: `background.js`
- Create: `content.js`
- Create: `popup/popup.html`
- Create: `popup/popup.js`
- Create: `popup/popup.css`
- Create: `options/options.html`
- Create: `options/options.js`
- Create: `options/options.css`
- Create: `icons/icon128.png` (placeholder)

**Step 1: Create the manifest**

```json
// manifest.json
{
  "manifest_version": 3,
  "name": "Discord Share",
  "version": "1.0.0",
  "description": "Send selected text, links, and images to Discord channels",
  "permissions": ["storage", "contextMenus", "scripting", "activeTab"],
  "host_permissions": ["https://discord.com/api/webhooks/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "128": "icons/icon128.png"
    }
  },
  "options_page": "options/options.html",
  "icons": {
    "128": "icons/icon128.png"
  }
}
```

**Step 2: Create the icon**

Create `icons/icon128.png` — use any 128x128 PNG. For a quick placeholder, download any small Discord-themed or generic icon. The extension won't load without at least one icon file.

A quick option: use this Node one-liner in the terminal to generate a minimal valid PNG (or just copy any PNG and rename it):
```bash
# If you have ImageMagick:
magick -size 128x128 xc:#5865F2 -font Arial -pointsize 60 -fill white -gravity center -annotate 0 "D" icons/icon128.png

# If not, just copy any PNG file as a placeholder:
# copy any_image.png icons/icon128.png
```

**Step 3: Create empty shell files**

Each file just needs to exist (can be empty or have a comment):
```bash
echo "// background" > background.js
echo "// content" > content.js
mkdir popup && echo "" > popup/popup.html && echo "" > popup/popup.js && echo "" > popup/popup.css
mkdir options && echo "" > options/options.html && echo "" > options/options.js && echo "" > options/options.css
```

**Step 4: Load extension in Chrome/Edge and verify it appears**

1. Open Chrome/Edge → navigate to `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (toggle top right)
3. Click **Load unpacked**
4. Select the `discord-share-extension` folder
5. Verify: "Discord Share" appears in the extensions list with no errors
6. Verify: The extension icon appears in the toolbar (may need to pin it)

Expected: Extension loads with no errors in the extensions page.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: scaffold MV3 extension with manifest and empty shells"
```

---

## Task 2: Storage Module

The storage module is a plain JS file imported by options, popup, and background. Since there's no bundler, we'll use a shared `storage.js` loaded via script tag in HTML pages and importScripts in the service worker.

**Files:**
- Create: `storage.js`

**Step 1: Write storage.js**

```js
// storage.js
// Shared storage helpers for chrome.storage.sync

const Storage = {
  // Returns the full config object { servers: [...], lastChannelId: null }
  async getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['servers', 'lastChannelId'], (result) => {
        resolve({
          servers: result.servers || [],
          lastChannelId: result.lastChannelId || null,
        });
      });
    });
  },

  async saveServers(servers) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ servers }, resolve);
    });
  },

  async saveLastChannelId(channelId) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ lastChannelId: channelId }, resolve);
    });
  },

  // Finds a channel by ID across all servers, returns { server, channel } or null
  async findChannel(channelId) {
    const { servers } = await this.getConfig();
    for (const server of servers) {
      const channel = server.channels.find((c) => c.id === channelId);
      if (channel) return { server, channel };
    }
    return null;
  },

  // Generates a simple unique ID
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },
};
```

**Step 2: Manually verify in the options page (after Task 4)**

Once options.js imports this, open Chrome DevTools on the options page and run:
```js
Storage.getConfig().then(console.log);
// Expected: { servers: [], lastChannelId: null }
```

**Step 3: Commit**

```bash
git add storage.js
git commit -m "feat: add shared storage module"
```

---

## Task 3: Content Script

The content script is injected into every page. It listens for a message from the background worker asking it to capture the current selection and page metadata.

**Files:**
- Modify: `content.js`

**Step 1: Write content.js**

```js
// content.js
// Injected into all pages. Responds to capture requests from background.js.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'CAPTURE_CONTEXT') return false;

  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';

  sendResponse({
    selectedText,
    pageTitle: document.title,
    pageUrl: location.href,
  });

  return false; // synchronous response
});
```

**Step 2: Verify manually**

1. Open any webpage
2. Open Chrome DevTools → Console
3. Run: `chrome.runtime.sendMessage({ type: 'CAPTURE_CONTEXT' }, console.log)`
4. Expected: `{ selectedText: '', pageTitle: 'Page Title', pageUrl: 'https://...' }`
5. Select some text on the page, repeat — `selectedText` should now contain it

**Step 3: Commit**

```bash
git add content.js
git commit -m "feat: content script captures selection and page metadata"
```

---

## Task 4: Discord Message Formatter

Pure utility functions. No browser APIs needed — these can be tested in the DevTools console.

**Files:**
- Create: `formatter.js`

**Step 1: Write formatter.js**

```js
// formatter.js
// Formats payloads for the Discord webhook API.
// Discord webhook POST body: { content: string } or { embeds: [...] }

const Formatter = {
  // Text selection: plain message with code block + source info
  textSelection({ pageTitle, pageUrl, selectedText, note }) {
    const lines = [];
    lines.push(`📋 **${pageTitle}**`);
    lines.push(`🔗 ${pageUrl}`);
    lines.push('');
    lines.push('```');
    lines.push(selectedText);
    lines.push('```');
    if (note && note.trim()) {
      lines.push('');
      lines.push(`📝 ${note.trim()}`);
    }
    return { content: lines.join('\n') };
  },

  // Link/page share: rich embed
  linkEmbed({ pageTitle, pageUrl, note }) {
    const embed = {
      title: pageTitle || pageUrl,
      url: pageUrl,
      color: 0x5865f2, // Discord blurple
    };
    if (note && note.trim()) {
      embed.description = note.trim();
    }
    return { embeds: [embed] };
  },

  // Image share: embed with image
  imageEmbed({ imageUrl, pageUrl, note }) {
    const lines = [];
    lines.push(`🔗 ${pageUrl}`);
    if (note && note.trim()) {
      lines.push(`📝 ${note.trim()}`);
    }
    return {
      content: lines.join('\n') || undefined,
      embeds: [{ image: { url: imageUrl }, color: 0x5865f2 }],
    };
  },

  // Sends a formatted payload to a Discord webhook URL
  // Returns { ok: true } or { ok: false, error: string }
  async postToWebhook(webhookUrl, payload) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Discord returned ${response.status}: ${text}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
```

**Step 2: Manually verify formatting (no webhook needed)**

Open Chrome DevTools console on any page, paste the formatter code, then run:

```js
// Test text selection format
console.log(JSON.stringify(
  Formatter.textSelection({
    pageTitle: 'Test Page',
    pageUrl: 'https://example.com',
    selectedText: 'Hello world',
    note: 'Interesting!'
  }), null, 2
));
// Expected: { content: "📋 **Test Page**\n🔗 https://example.com\n\n```\nHello world\n```\n\n📝 Interesting!" }

// Test link embed format
console.log(JSON.stringify(
  Formatter.linkEmbed({ pageTitle: 'Test', pageUrl: 'https://example.com', note: 'Check this' }),
  null, 2
));
// Expected: { embeds: [{ title: 'Test', url: 'https://example.com', color: 5793266, description: 'Check this' }] }
```

**Step 3: Commit**

```bash
git add formatter.js
git commit -m "feat: Discord message formatter for text, links, and images"
```

---

## Task 5: Options Page — HTML + CSS Shell

Build the structure and styling before adding JS logic.

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.css`

**Step 1: Write options.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Discord Share — Settings</title>
  <link rel="stylesheet" href="options.css" />
</head>
<body>
  <div class="container">
    <header>
      <h1>🎮 Discord Share</h1>
      <p class="subtitle">Configure your servers and channels</p>
    </header>

    <div id="servers-list">
      <!-- Dynamically populated by options.js -->
    </div>

    <button id="add-server-btn" class="btn btn-primary">+ Add Server</button>

    <div class="footer-actions">
      <button id="export-btn" class="btn btn-secondary">Export Config</button>
      <button id="import-btn" class="btn btn-secondary">Import Config</button>
      <input type="file" id="import-file" accept=".json" style="display:none" />
    </div>

    <div id="status-message" class="status hidden"></div>
  </div>

  <script src="../storage.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

**Step 2: Write options.css**

```css
/* options/options.css */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #1e1f22;
  color: #dcddde;
  min-height: 100vh;
  padding: 24px;
}

.container {
  max-width: 640px;
  margin: 0 auto;
}

header { margin-bottom: 28px; }
header h1 { font-size: 22px; color: #fff; }
.subtitle { color: #96989d; font-size: 14px; margin-top: 4px; }

/* Server blocks */
.server-block {
  background: #2b2d31;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.server-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
}

.server-header .server-name {
  flex: 1;
  font-weight: 600;
  font-size: 15px;
}

.server-header .chevron { margin-right: 8px; transition: transform 0.2s; }
.server-block.collapsed .chevron { transform: rotate(-90deg); }
.server-block.collapsed .server-channels { display: none; }

.server-actions { display: flex; gap: 6px; }

.server-channels { padding: 0 16px 12px; }

.channel-row {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #3f4147;
  gap: 10px;
}
.channel-row:last-child { border-bottom: none; }

.channel-name { flex: 1; font-size: 14px; }
.webhook-mask {
  font-size: 12px;
  color: #96989d;
  font-family: monospace;
  background: #1e1f22;
  border-radius: 4px;
  padding: 2px 6px;
}

.add-channel-row {
  padding: 8px 0;
}

/* Buttons */
.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s;
}
.btn-primary { background: #5865f2; color: #fff; }
.btn-primary:hover { background: #4752c4; }
.btn-secondary { background: #4e5058; color: #fff; }
.btn-secondary:hover { background: #6d6f78; }
.btn-danger { background: transparent; color: #ed4245; padding: 4px 8px; font-size: 13px; }
.btn-danger:hover { background: rgba(237,66,69,0.1); }
.btn-icon { background: transparent; color: #96989d; padding: 4px 8px; font-size: 14px; }
.btn-icon:hover { color: #fff; }
.btn-small { padding: 5px 10px; font-size: 13px; }

#add-server-btn { margin-bottom: 24px; }

.footer-actions { display: flex; gap: 10px; margin-top: 8px; }

/* Status message */
.status {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
}
.status.success { background: #2d7d46; color: #fff; }
.status.error { background: #692e2e; color: #fff; }
.status.hidden { display: none; }

/* Modal overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: #2b2d31;
  border-radius: 10px;
  padding: 24px;
  width: 420px;
  max-width: 90vw;
}
.modal h2 { font-size: 17px; color: #fff; margin-bottom: 16px; }
.modal label { display: block; font-size: 13px; color: #96989d; margin-bottom: 4px; margin-top: 12px; }
.modal input {
  width: 100%;
  background: #1e1f22;
  border: 1px solid #4e5058;
  border-radius: 5px;
  color: #dcddde;
  padding: 8px 10px;
  font-size: 14px;
}
.modal input:focus { outline: none; border-color: #5865f2; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
.modal-error { color: #ed4245; font-size: 13px; margin-top: 8px; min-height: 18px; }
```

**Step 3: Verify shell loads**

1. Open `chrome://extensions` → click "Options" link under Discord Share
2. Verify: Page opens with dark background, "🎮 Discord Share" heading, "+ Add Server" button, no JS errors in DevTools

**Step 4: Commit**

```bash
git add options/options.html options/options.css
git commit -m "feat: options page HTML and CSS shell"
```

---

## Task 6: Options Page — JavaScript Logic

**Files:**
- Modify: `options/options.js`

**Step 1: Write options.js**

```js
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

// ─── Tell background to rebuild context menus ─────────────────────────────

function notifyBackground() {
  chrome.runtime.sendMessage({ type: 'REBUILD_CONTEXT_MENUS' });
}

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await render();

  document.getElementById('add-server-btn').addEventListener('click', addServer);
  document.getElementById('export-btn').addEventListener('click', exportConfig);

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importConfig(e.target.files[0]);
  });
});
```

**Step 2: Verify options page works end-to-end**

1. Reload extension in `chrome://extensions`
2. Open Options
3. Click "+ Add Server" → enter "Test Server" → Save
4. Verify: Server block appears
5. Click "+ Add Channel" → enter "#test" and a real Discord webhook URL → click "Add Channel"
6. Verify: Test message appears in Discord, channel row appears with masked webhook
7. Click "Test" button on the channel → verify test message in Discord
8. Click "Export Config" → verify a JSON file downloads
9. Click rename (✎) and delete (✕) — verify they work

Expected: Full CRUD works, no console errors.

**Step 3: Commit**

```bash
git add options/options.js
git commit -m "feat: options page CRUD for servers, channels, webhooks with export/import"
```

---

## Task 7: Background Service Worker

**Files:**
- Modify: `background.js`

**Step 1: Write background.js**

```js
// background.js
importScripts('storage.js');

// ─── Context Menu Registration ─────────────────────────────────────────────

async function buildContextMenus() {
  await chrome.contextMenus.removeAll();

  const { servers } = await Storage.getConfig();
  if (!servers.length) return;

  // Root item
  chrome.contextMenus.create({
    id: 'discord-share-root',
    title: 'Send to Discord',
    contexts: ['selection', 'link', 'image', 'page'],
  });

  for (const server of servers) {
    if (!server.channels || server.channels.length === 0) continue;

    // Server group (non-clickable parent)
    chrome.contextMenus.create({
      id: `server-${server.id}`,
      parentId: 'discord-share-root',
      title: server.name,
      contexts: ['selection', 'link', 'image', 'page'],
    });

    for (const channel of server.channels) {
      chrome.contextMenus.create({
        id: `channel-${channel.id}`,
        parentId: `server-${server.id}`,
        title: channel.name,
        contexts: ['selection', 'link', 'image', 'page'],
      });
    }
  }
}

// ─── Context Menu Click Handler ────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith('channel-')) return;

  const channelId = info.menuItemId.replace('channel-', '');

  // Capture page context from content script
  let captureResult = { selectedText: '', pageTitle: tab.title || '', pageUrl: tab.url || '' };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection();
        return {
          selectedText: selection ? selection.toString().trim() : '',
          pageTitle: document.title,
          pageUrl: location.href,
        };
      },
    });
    if (result?.result) captureResult = result.result;
  } catch (_) {
    // Some pages (chrome://, edge://) disallow scripting — use tab info as fallback
  }

  // Determine content type
  let contentType = 'page';
  if (captureResult.selectedText) contentType = 'selection';
  else if (info.srcUrl) contentType = 'image';
  else if (info.linkUrl) contentType = 'link';

  // Store payload in session storage for popup to read
  await chrome.storage.session.set({
    pendingPayload: {
      channelId,
      contentType,
      selectedText: captureResult.selectedText,
      pageTitle: captureResult.pageTitle,
      pageUrl: captureResult.pageUrl,
      linkUrl: info.linkUrl || null,
      imageUrl: info.srcUrl || null,
    },
  });

  // Open the popup
  await chrome.action.openPopup();
});

// ─── Message Listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REBUILD_CONTEXT_MENUS') {
    buildContextMenus();
    return false;
  }

  if (message.type === 'SEND_TO_DISCORD') {
    handleSend(message.payload).then(sendResponse);
    return true; // async response
  }

  return false;
});

// ─── Send Logic ────────────────────────────────────────────────────────────

async function handleSend({ channelId, discordPayload }) {
  const found = await Storage.findChannel(channelId);
  if (!found) return { ok: false, error: 'Channel not found' };

  try {
    const res = await fetch(found.channel.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }
    await Storage.saveLastChannelId(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(buildContextMenus);
chrome.storage.onChanged.addListener(buildContextMenus);
```

**Step 2: Reload extension and verify context menus**

1. Reload extension in `chrome://extensions`
2. Open any webpage
3. Right-click → verify "Send to Discord" submenu appears with your servers and channels
4. Open DevTools → Service Worker → verify no errors on startup

**Step 3: Commit**

```bash
git add background.js
git commit -m "feat: background service worker with context menus and send logic"
```

---

## Task 8: Popup — HTML + CSS Shell

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`

**Step 1: Write popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Discord Share</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <div class="container">
    <header>
      <span class="logo">🎮 Discord Share</span>
      <a href="#" id="settings-link" title="Settings">⚙</a>
    </header>

    <!-- Empty state (no channels configured) -->
    <div id="empty-state" class="empty-state hidden">
      <p>No channels configured yet.</p>
      <a href="#" id="empty-settings-link" class="btn btn-primary">Open Settings</a>
    </div>

    <!-- Main UI -->
    <div id="main-ui" class="hidden">
      <section class="section">
        <div class="section-label">SEND TO</div>
        <div id="channel-list"></div>
      </section>

      <section class="section">
        <div class="section-label">CONTENT</div>
        <div id="content-preview" class="content-preview"></div>
      </section>

      <section class="section">
        <textarea id="note-input" placeholder="Add a note..." rows="2"></textarea>
      </section>

      <div id="error-message" class="error-message hidden"></div>

      <button id="send-btn" class="btn btn-primary send-btn">Send to Discord</button>
    </div>

    <!-- Success state -->
    <div id="success-state" class="success-state hidden">
      <div class="success-icon">✅</div>
      <p>Sent!</p>
    </div>
  </div>

  <script src="../storage.js"></script>
  <script src="../formatter.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

**Step 2: Write popup.css**

```css
/* popup/popup.css */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #1e1f22;
  color: #dcddde;
  width: 340px;
  min-height: 100px;
}

.container { padding: 14px; }

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.logo { font-size: 15px; font-weight: 600; color: #fff; }
#settings-link { color: #96989d; text-decoration: none; font-size: 16px; }
#settings-link:hover { color: #fff; }

.section { margin-bottom: 12px; }
.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #96989d;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

/* Channel list */
.server-group { margin-bottom: 8px; }
.server-group-name {
  font-size: 12px;
  font-weight: 600;
  color: #96989d;
  text-transform: uppercase;
  margin-bottom: 4px;
  padding-left: 2px;
}
.channel-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
}
.channel-option:hover { background: #2b2d31; }
.channel-option input[type="radio"] { accent-color: #5865f2; }
.channel-option label { cursor: pointer; font-size: 14px; flex: 1; }

/* Content preview */
.content-preview {
  background: #2b2d31;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  color: #b5bac1;
  max-height: 100px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
  line-height: 1.4;
}

/* Note textarea */
#note-input {
  width: 100%;
  background: #2b2d31;
  border: 1px solid #4e5058;
  border-radius: 6px;
  color: #dcddde;
  padding: 8px 10px;
  font-size: 13px;
  resize: none;
  font-family: inherit;
}
#note-input:focus { outline: none; border-color: #5865f2; }

/* Send button */
.send-btn {
  width: 100%;
  padding: 10px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 6px;
  background: #5865f2;
  color: #fff;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}
.send-btn:hover { background: #4752c4; }
.send-btn:disabled { background: #4e5058; cursor: not-allowed; }

/* Error */
.error-message {
  color: #ed4245;
  font-size: 13px;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: rgba(237,66,69,0.1);
  border-radius: 5px;
}
.hidden { display: none; }

/* Empty state */
.empty-state {
  text-align: center;
  padding: 20px 0;
  color: #96989d;
  font-size: 14px;
}
.empty-state .btn {
  display: inline-block;
  margin-top: 12px;
  padding: 8px 16px;
  background: #5865f2;
  color: #fff;
  border-radius: 6px;
  text-decoration: none;
  font-size: 14px;
}

/* Success state */
.success-state {
  text-align: center;
  padding: 30px 0;
}
.success-icon { font-size: 36px; margin-bottom: 8px; }
.success-state p { color: #fff; font-size: 15px; font-weight: 600; }
```

**Step 3: Click extension icon and verify**

1. Click the extension icon in the toolbar
2. Verify: Popup opens with dark background, "🎮 Discord Share" header, gear icon
3. If no channels: empty state shows
4. No JS errors in popup DevTools (right-click popup → Inspect)

**Step 4: Commit**

```bash
git add popup/popup.html popup/popup.css
git commit -m "feat: popup HTML and CSS shell"
```

---

## Task 9: Popup — JavaScript Logic

**Files:**
- Modify: `popup/popup.js`

**Step 1: Write popup.js**

```js
// popup/popup.js

let currentPayload = null; // the pending payload from context menu or page state
let selectedChannelId = null;

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const { servers, lastChannelId } = await Storage.getConfig();

  // Wire up settings links
  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('empty-settings-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  const allChannels = servers.flatMap(s => s.channels || []);
  if (allChannels.length === 0) {
    show('empty-state');
    return;
  }

  show('main-ui');
  renderChannelList(servers, lastChannelId);
  await loadContent();

  document.getElementById('note-input').addEventListener('input', updatePreview);
  document.getElementById('send-btn').addEventListener('click', handleSend);
});

// ─── Channel List ──────────────────────────────────────────────────────────

function renderChannelList(servers, defaultChannelId) {
  const list = document.getElementById('channel-list');
  list.innerHTML = '';

  let firstChannelId = null;

  for (const server of servers) {
    if (!server.channels || server.channels.length === 0) continue;

    const group = document.createElement('div');
    group.className = 'server-group';
    group.innerHTML = `<div class="server-group-name">${escHtml(server.name)}</div>`;

    for (const channel of server.channels) {
      if (!firstChannelId) firstChannelId = channel.id;
      const row = document.createElement('label');
      row.className = 'channel-option';
      row.innerHTML = `
        <input type="radio" name="channel" value="${channel.id}" />
        <span>${escHtml(channel.name)}</span>
      `;
      row.querySelector('input').addEventListener('change', () => {
        selectedChannelId = channel.id;
        updatePreview();
      });
      group.appendChild(row);
    }

    list.appendChild(group);
  }

  // Select default or first
  const targetId = defaultChannelId || firstChannelId;
  if (targetId) {
    const radio = list.querySelector(`input[value="${targetId}"]`);
    if (radio) {
      radio.checked = true;
      selectedChannelId = targetId;
    }
  }
}

// ─── Content Loading ───────────────────────────────────────────────────────

async function loadContent() {
  // Check for a pending payload (from context menu click)
  const session = await chrome.storage.session.get('pendingPayload');
  if (session.pendingPayload) {
    currentPayload = session.pendingPayload;
    // Pre-select the channel from context menu if provided
    if (currentPayload.channelId) {
      const radio = document.querySelector(`input[value="${currentPayload.channelId}"]`);
      if (radio) {
        radio.checked = true;
        selectedChannelId = currentPayload.channelId;
      }
    }
    await chrome.storage.session.remove('pendingPayload');
    updatePreview();
    return;
  }

  // Otherwise capture from active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        selectedText: window.getSelection()?.toString().trim() || '',
        pageTitle: document.title,
        pageUrl: location.href,
      }),
    });

    currentPayload = {
      contentType: result?.result?.selectedText ? 'selection' : 'page',
      ...(result?.result || {}),
      pageTitle: tab.title,
      pageUrl: tab.url,
    };
  } catch (_) {
    currentPayload = { contentType: 'page', pageTitle: 'Unknown', pageUrl: '' };
  }

  updatePreview();
}

// ─── Preview ───────────────────────────────────────────────────────────────

function updatePreview() {
  if (!currentPayload) return;
  const note = document.getElementById('note-input').value;
  const preview = document.getElementById('content-preview');

  const { contentType, selectedText, pageTitle, pageUrl, linkUrl, imageUrl } = currentPayload;

  if (contentType === 'selection' && selectedText) {
    preview.textContent = `📋 ${pageTitle}\n🔗 ${pageUrl}\n\`\`\`\n${selectedText.slice(0, 200)}${selectedText.length > 200 ? '…' : ''}\n\`\`\`${note ? `\n\n📝 ${note}` : ''}`;
  } else if (contentType === 'image' && imageUrl) {
    preview.textContent = `🖼 Image\n🔗 ${pageUrl}${note ? `\n📝 ${note}` : ''}`;
  } else if (contentType === 'link' && linkUrl) {
    preview.textContent = `🔗 ${linkUrl}\n📋 ${pageTitle}${note ? `\n📝 ${note}` : ''}`;
  } else {
    preview.textContent = `📋 ${pageTitle}\n🔗 ${pageUrl}${note ? `\n📝 ${note}` : ''}`;
  }
}

// ─── Send ──────────────────────────────────────────────────────────────────

async function handleSend() {
  if (!selectedChannelId || !currentPayload) return;

  const note = document.getElementById('note-input').value.trim();
  const { contentType, selectedText, pageTitle, pageUrl, linkUrl, imageUrl } = currentPayload;

  let discordPayload;
  if (contentType === 'selection' && selectedText) {
    discordPayload = Formatter.textSelection({ pageTitle, pageUrl, selectedText, note });
  } else if (contentType === 'image' && imageUrl) {
    discordPayload = Formatter.imageEmbed({ imageUrl, pageUrl, note });
  } else {
    // link or page
    const url = linkUrl || pageUrl;
    discordPayload = Formatter.linkEmbed({ pageTitle, pageUrl: url, note });
  }

  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  hideError();

  const result = await chrome.runtime.sendMessage({
    type: 'SEND_TO_DISCORD',
    payload: { channelId: selectedChannelId, discordPayload },
  });

  if (result?.ok) {
    show('success-state');
    hide('main-ui');
    setTimeout(() => window.close(), 1500);
  } else {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to Discord';
    showError(result?.error || 'Failed to send. Try again.');
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function showError(msg) {
  const el = document.getElementById('error-message');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError() {
  document.getElementById('error-message').classList.add('hidden');
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

**Step 2: Verify popup end-to-end**

1. Reload extension
2. Click extension icon while on any webpage
3. Verify: Channel list shows with correct server grouping, last-used channel pre-selected
4. Verify: Content preview shows page title + URL
5. Select text on a page, open popup again → verify preview shows the selection in code block
6. Add a note → verify preview updates in real time
7. Click "Send to Discord" → verify ✅ success state appears, popup closes after 1.5s
8. Check Discord channel → verify message appears with correct formatting

**Step 3: Verify context menu flow**

1. Select text on a page → right-click → "Send to Discord" → pick a channel
2. Verify: Popup opens pre-filled with the selection and channel pre-selected
3. Add note → Send → verify in Discord

**Step 4: Commit**

```bash
git add popup/popup.js
git commit -m "feat: popup JS with channel selection, preview, send, and success state"
```

---

## Task 10: Final Polish & Edge Cases

**Files:**
- Modify: `background.js` (add tabs permission usage note)
- Modify: `manifest.json` (add tabs permission)

**Step 1: Add `tabs` permission to manifest**

The popup uses `chrome.tabs.query` to get the active tab URL — this requires the `tabs` permission.

```json
// manifest.json — update permissions array:
"permissions": ["storage", "contextMenus", "scripting", "activeTab", "tabs"]
```

**Step 2: Handle chrome:// and edge:// pages gracefully**

These pages block `executeScript`. The popup already has a try/catch fallback — verify it:

1. Open `chrome://extensions`
2. Click extension icon
3. Verify: Popup shows without crashing (will show empty/fallback content, no error)

**Step 3: Verify storage sync across contexts**

1. Add a server+channel in Options
2. Close and reopen popup → verify channels appear
3. Send a message → close popup → reopen popup → verify the channel you used is still selected (lastChannelId working)

**Step 4: Verify config export/import round-trip**

1. Add 2 servers with channels in Options
2. Click "Export Config" → save the JSON
3. Delete all servers
4. Click "Import Config" → select the saved JSON
5. Verify: All servers and channels are restored
6. Verify: Context menus update automatically

**Step 5: Final commit**

```bash
git add manifest.json
git commit -m "feat: add tabs permission, polish edge cases"
```

---

## Task 11: README

**Files:**
- Create: `README.md`

**Step 1: Write README.md**

```markdown
# Discord Share — Chrome/Edge Extension

Send selected text, links, and images from any webpage directly to Discord channels.

## Installation

1. Clone or download this repo
2. Open Chrome/Edge → go to `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select this folder
5. Pin the extension icon to your toolbar

## Setup

1. Click the extension icon → click ⚙ (or right-click extension icon → Options)
2. Click **+ Add Server** → enter a name for your Discord server
3. Click **+ Add Channel** → enter the channel name and paste the Discord webhook URL

### Getting a Webhook URL
1. Open Discord → Server Settings → Integrations → Webhooks
2. Click **New Webhook** → choose a channel → copy the webhook URL
3. Paste it into the extension's channel settings

## Usage

**Toolbar popup:** Click the extension icon on any page to send the current page (or active text selection) to a channel.

**Right-click menu:** Select text, right-click a link, or right-click an image → "Send to Discord" → pick a channel → add an optional note → Send.

## What Gets Sent

| Content | Discord Format |
|---|---|
| Text selection | Code block + page title + URL |
| Link / page | Rich embed with title + URL |
| Image | Embedded image preview |
```

**Step 2: Commit README**

```bash
git add README.md
git commit -m "docs: add README with installation and usage instructions"
```

---

## Done ✅

Load the extension unpacked and you have a fully working Discord Share extension. To distribute it, zip the folder and share — recipients load it the same way via "Load unpacked".
```
