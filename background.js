// background.js
importScripts('storage.js', 'discord-api.js', 'formatter.js');

// ─── Context Menu Registration ─────────────────────────────────────────────

async function buildContextMenus() {
  await chrome.contextMenus.removeAll();

  // Prompt House — save selected text (independent of Discord config)
  chrome.contextMenus.create({
    id: 'prompthouse-save',
    title: 'Save to Prompt House',
    contexts: ['selection'],
  });

  // Prompt House — insert a saved prompt into the focused field
  chrome.contextMenus.create({
    id: 'prompthouse-insert',
    title: 'Insert Prompt from Prompt House',
    contexts: ['editable'],
  });

  // Prompt House — attach a right-clicked image to a saved prompt's reference images
  chrome.contextMenus.create({
    id: 'prompthouse-attach-image',
    title: 'Attach Image to Prompt House',
    contexts: ['image'],
  });

  // Thread — send selected text, a page, or a link as a new brain-dump note
  chrome.contextMenus.create({
    id: 'thread-send',
    title: 'Send to Thread',
    contexts: ['selection', 'page', 'link'],
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
    await openPromptHouseCapture(info, tab);
    return;
  }

  if (info.menuItemId === 'prompthouse-insert') {
    await openPromptHouseInsert(tab, info);
    return;
  }

  if (info.menuItemId === 'prompthouse-attach-image') {
    await openPromptHouseAttachImage(info);
    return;
  }

  if (info.menuItemId === 'thread-send') {
    await sendToThread(info, tab);
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

async function openPromptHouseCapture(info, tab) {
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

  let hostname = '';
  try {
    hostname = new URL(tab?.url || '').hostname.replace(/^www\./, '');
  } catch (_) {
    // non-http pages (chrome://, file://, etc.) — leave untagged
  }

  await chrome.storage.session.set({
    promptHouseCapture: { content, tags: hostname ? [hostname] : [] },
  });
  await chrome.windows.create({
    url: chrome.runtime.getURL('prompthouse/prompthouse.html'),
    type: 'popup',
    width: 420,
    height: 640,
  });
}

async function openPromptHouseInsert(tab, info) {
  const config = await Storage.getPromptHouse();
  if (!config) {
    notify('Prompt House', 'Set your API key in the extension options first.');
    return;
  }

  await chrome.storage.session.set({
    promptHouseInsertTarget: { tabId: tab.id, frameId: info.frameId || 0 },
  });
  await chrome.windows.create({
    url: chrome.runtime.getURL('prompthouse/insert.html'),
    type: 'popup',
    width: 420,
    height: 560,
  });
}

async function openPromptHouseAttachImage(info) {
  const config = await Storage.getPromptHouse();
  if (!config) {
    notify('Prompt House', 'Set your API key in the extension options first.');
    return;
  }

  if (!info.srcUrl) {
    notify('Prompt House', 'Could not read the image URL.');
    return;
  }

  await chrome.storage.session.set({
    promptHouseImageAttach: { imageUrl: info.srcUrl },
  });
  await chrome.windows.create({
    url: chrome.runtime.getURL('prompthouse/attach-image.html'),
    type: 'popup',
    width: 420,
    height: 560,
  });
}

const IMAGE_SLOT_FIELDS = [
  'referenceImagePath',
  'referenceImagePath2',
  'referenceImagePath3',
  'referenceImagePath4',
  'referenceImagePath5',
  'referenceImagePath6',
];

async function attachPromptHouseImage({ promptId, imageUrl }) {
  const config = await Storage.getPromptHouse();
  if (!config) return { ok: false, error: 'Set your API key in the extension options first.' };

  try {
    const promptRes = await fetch(`${config.endpoint}/${promptId}`, {
      headers: { 'X-Api-Key': config.apiKey },
    });
    if (!promptRes.ok) {
      const text = await promptRes.text();
      return { ok: false, error: `HTTP ${promptRes.status}: ${text.slice(0, 200)}` };
    }
    const prompt = await promptRes.json();

    const slotIndex = IMAGE_SLOT_FIELDS.findIndex((field) => !prompt[field]);
    if (slotIndex === -1) return { ok: false, error: 'All 6 image slots are full on that prompt.' };
    const slot = slotIndex + 1;

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) return { ok: false, error: `Failed to fetch image: HTTP ${imageRes.status}` };
    const blob = await imageRes.blob();

    const filename = imageUrl.split('/').pop()?.split('?')[0] || 'image';

    const formData = new FormData();
    formData.append('image', blob, filename);

    const uploadRes = await fetch(`${config.endpoint}/${promptId}/image/${slot}`, {
      method: 'POST',
      headers: { 'X-Api-Key': config.apiKey },
      body: formData,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return { ok: false, error: `HTTP ${uploadRes.status}: ${text.slice(0, 200)}` };
    }

    notify('Prompt House', `Image attached to "${prompt.title}".`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Thread ────────────────────────────────────────────────────────────────

// Thread has no API key — its share-target route is a plain GET navigation
// so the browser's existing Authentik session cookie carries auth, the same
// way Thread's own desktop web-clipper integration works.
async function sendToThread(info, tab) {
  const config = await Storage.getThread();
  if (!config) {
    notify('Thread', 'Set your Thread server URL in the extension options first.');
    return;
  }

  const title = tab?.title || '';
  const text = (info.selectionText || '').trim();
  const url = info.linkUrl || tab?.url || '';

  const target = new URL('/share-target', config.baseUrl);
  if (title) target.searchParams.set('title', title);
  if (text) target.searchParams.set('text', text);
  if (url) target.searchParams.set('url', url);

  await chrome.tabs.create({ url: target.toString() });
}

async function searchPromptHouse(query) {
  const config = await Storage.getPromptHouse();
  if (!config) return { ok: false, error: 'Set your API key in the extension options first.' };

  try {
    const url = new URL(config.endpoint);
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('sort', 'updated_at');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('limit', '20');

    const res = await fetch(url, { headers: { 'X-Api-Key': config.apiKey } });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    return { ok: true, prompts: json.data || [] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function insertTextAtCursor(text) {
  const el = document.activeElement;
  if (!el) return false;

  const isTextInput = el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|url|tel|email)$/.test(el.type));

  if (isTextInput) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.selectionStart = el.selectionEnd = start + text.length;
    return true;
  }

  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
    return true;
  }

  return false;
}

async function insertPromptHouseContent({ tabId, frameId, content }) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId || 0] },
      func: insertTextAtCursor,
      args: [content],
    });
    if (!result?.result) return { ok: false, error: 'No editable field is focused on that page.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function submitPromptHouse(fields) {
  const config = await Storage.getPromptHouse();
  if (!config) return { ok: false, error: 'Set your API key in the extension options first.' };

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.apiKey,
      },
      body: JSON.stringify(fields),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    notify('Prompt House', 'Prompt saved.');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
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

  if (message.type === 'SUBMIT_PROMPT_HOUSE') {
    submitPromptHouse(message.fields).then(sendResponse);
    return true;
  }

  if (message.type === 'SEARCH_PROMPT_HOUSE') {
    searchPromptHouse(message.query).then(sendResponse);
    return true;
  }

  if (message.type === 'INSERT_PROMPT_HOUSE_CONTENT') {
    insertPromptHouseContent(message).then(sendResponse);
    return true;
  }

  if (message.type === 'ATTACH_PROMPT_HOUSE_IMAGE') {
    attachPromptHouseImage(message).then(sendResponse);
    return true;
  }

  return false;
});

// ─── Send Logic ────────────────────────────────────────────────────────────

async function handleSend({ channelId, discordPayload }) {
  const found = await Storage.findChannel(channelId);
  if (!found) return { ok: false, error: 'Channel not found' };

  const result = await Formatter.postToWebhook(found.channel.webhookUrl, discordPayload);
  if (!result.ok) return { ok: false, error: result.error.slice(0, 100) };

  await Storage.saveLastChannelId(channelId);
  return { ok: true };
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
