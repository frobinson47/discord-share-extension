// prompthouse/insert.js

let insertTarget = null;
let debounceTimer = null;
let currentPrompts = [];
let selectedIndex = -1;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await chrome.storage.session.get('promptHouseInsertTarget');
  insertTarget = session.promptHouseInsertTarget || null;
  await chrome.storage.session.remove('promptHouseInsertTarget');

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(searchInput.value.trim()), 250);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const prompt = currentPrompts[selectedIndex] ?? currentPrompts[0];
      if (prompt) handleInsert(prompt);
    } else if (e.key === 'Escape') {
      window.close();
    }
  });

  runSearch('');
});

function moveSelection(delta) {
  if (!currentPrompts.length) return;
  selectedIndex = (selectedIndex + delta + currentPrompts.length) % currentPrompts.length;
  highlightSelection();
}

function highlightSelection() {
  const items = document.querySelectorAll('.result-item');
  items.forEach((item, i) => item.classList.toggle('selected', i === selectedIndex));
  items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
}

async function runSearch(query) {
  hideError();
  const result = await chrome.runtime.sendMessage({ type: 'SEARCH_PROMPT_HOUSE', query });

  if (!result?.ok) {
    renderResults([]);
    showError(result?.error || 'Failed to search Prompt House.');
    return;
  }

  renderResults(result.prompts);
}

function renderResults(prompts) {
  const list = document.getElementById('results-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';
  currentPrompts = prompts;
  selectedIndex = prompts.length ? 0 : -1;

  if (!prompts.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  prompts.forEach((prompt, i) => {
    const item = document.createElement('div');
    item.className = 'result-item' + (i === 0 ? ' selected' : '');
    item.innerHTML = `
      <div class="result-title">${escHtml(prompt.title)}</div>
      <div class="result-meta">
        <span class="badge">${escHtml(prompt.promptType || '')}</span>
        <span class="badge">${escHtml(prompt.status || '')}</span>
      </div>
      <div class="result-preview">${escHtml((prompt.description || prompt.content || '').slice(0, 140))}</div>
    `;
    item.addEventListener('mouseenter', () => { selectedIndex = i; highlightSelection(); });
    item.addEventListener('click', () => handleInsert(prompt));
    list.appendChild(item);
  });
}

async function handleInsert(prompt) {
  if (!insertTarget) {
    showError('Lost track of the page to insert into — try again.');
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: 'INSERT_PROMPT_HOUSE_CONTENT',
    tabId: insertTarget.tabId,
    frameId: insertTarget.frameId,
    content: prompt.content,
  });

  if (result?.ok) {
    window.close();
  } else {
    showError(result?.error || 'Failed to insert. Try again.');
  }
}

function showError(msg) {
  const el = document.getElementById('error-message');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError() {
  document.getElementById('error-message').classList.add('hidden');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
