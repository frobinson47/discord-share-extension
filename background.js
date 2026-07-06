// background.js
importScripts('storage.js', 'discord-api.js');

// ─── Context Menu Registration ─────────────────────────────────────────────

async function buildContextMenus() {
  await chrome.contextMenus.removeAll();

  // Prompt House — save selected text (independent of Discord config)
  chrome.contextMenus.create({
    id: 'prompthouse-save',
    title: 'Save to Prompt House',
    contexts: ['selection'],
  });

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
  if (info.menuItemId === 'prompthouse-save') {
    await savePromptHouse(info, tab);
    return;
  }

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

// ─── Prompt House ──────────────────────────────────────────────────────────

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
  });
}

async function savePromptHouse(info, _tab) {
  const content = (info.selectionText || '').trim();
  if (!content) {
    notify('Prompt House', 'No text selected.');
    return;
  }

  const config = await Storage.getPromptHouse();
  if (!config) {
    notify('Prompt House', 'Set your API key in the extension options first.');
    return;
  }

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.apiKey,
      },
      body: JSON.stringify({ content, source: 'web' }),
    });

    if (!res.ok) {
      const text = await res.text();
      notify('Prompt House — Failed', `HTTP ${res.status}: ${text.slice(0, 120)}`);
      return;
    }

    notify('Prompt House', 'Prompt saved.');
  } catch (err) {
    notify('Prompt House — Failed', err.message);
  }
}

// ─── Message Listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REBUILD_CONTEXT_MENUS') {
    buildContextMenus();
    return false;
  }

  if (message.type === 'SEND_TO_DISCORD') {
    handleSend(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === 'DISCORD_API') {
    handleDiscordApi(message).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
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

// ─── Discord Gateway (bypasses Cloudflare HTTP blocking) ─────────────────

function getGuildsViaGateway(botToken) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    let heartbeatInterval = null;
    let expectedGuilds = 0;
    const guilds = [];

    const cleanup = () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      try { ws.close(1000); } catch (_) {}
    };

    const timeout = setTimeout(() => {
      cleanup();
      if (guilds.length > 0) resolve(guilds);
      else reject(new Error('Gateway connection timed out'));
    }, 15000);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Hello — start heartbeat + identify
      if (data.op === 10) {
        heartbeatInterval = setInterval(() => {
          ws.send(JSON.stringify({ op: 1, d: null }));
        }, data.d.heartbeat_interval);

        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: botToken,
            intents: 1, // GUILDS (1 << 0)
            properties: { os: 'windows', browser: 'discord-share', device: 'discord-share' },
          },
        }));
      }

      // READY — note how many guilds to expect
      if (data.op === 0 && data.t === 'READY') {
        expectedGuilds = data.d.guilds.length;
        if (expectedGuilds === 0) {
          clearTimeout(timeout);
          cleanup();
          resolve([]);
        }
      }

      // GUILD_CREATE — full guild data including channels
      if (data.op === 0 && data.t === 'GUILD_CREATE') {
        const g = data.d;
        guilds.push({
          id: g.id,
          name: g.name,
          icon: g.icon,
          channels: (g.channels || [])
            .filter(c => c.type === 0)
            .sort((a, b) => a.position - b.position)
            .map(c => ({ id: c.id, name: c.name })),
        });

        if (guilds.length >= expectedGuilds) {
          clearTimeout(timeout);
          cleanup();
          resolve(guilds);
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Gateway connection failed'));
    };
  });
}

// ─── Discord API Proxy ───────────────────────────────────────────────────

async function handleDiscordApi({ method, botToken, guildId, channelId }) {
  if (method === 'getGuildsWithChannels') {
    return await getGuildsViaGateway(botToken);
  }
  if (method === 'createWebhook') {
    return await DiscordAPI.createWebhook(botToken, channelId);
  }
  throw new Error(`Unknown method: ${method}`);
}

// ─── Init ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(buildContextMenus);
chrome.storage.onChanged.addListener(buildContextMenus);
