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
