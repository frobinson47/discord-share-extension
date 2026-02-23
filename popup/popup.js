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
