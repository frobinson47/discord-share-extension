// prompthouse/prompthouse.js

document.addEventListener('DOMContentLoaded', async () => {
  const session = await chrome.storage.session.get('promptHouseCapture');
  const capture = session.promptHouseCapture || { content: '' };
  await chrome.storage.session.remove('promptHouseCapture');

  const contentInput = document.getElementById('ph-content');
  const titleInput = document.getElementById('ph-title');
  const tagsInput = document.getElementById('ph-tags');

  contentInput.value = capture.content;
  titleInput.value = deriveTitle(capture.content);
  tagsInput.value = (capture.tags || []).join(', ');

  document.getElementById('cancel-btn').addEventListener('click', () => window.close());
  document.getElementById('save-btn').addEventListener('click', handleSave);
});

function deriveTitle(content) {
  const firstLine = (content || '').split('\n').find(line => line.trim().length > 0) || '';
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

async function handleSave() {
  const title = document.getElementById('ph-title').value.trim();
  const content = document.getElementById('ph-content').value.trim();
  const description = document.getElementById('ph-description').value.trim();
  const usageText = document.getElementById('ph-usage').value.trim();
  const samplePrompts = document.getElementById('ph-sample-prompts').value.trim();
  const tagsText = document.getElementById('ph-tags').value.trim();
  const status = document.getElementById('ph-status').value;
  const promptType = document.getElementById('ph-type').value;

  hideError();

  if (!title) return showError('Title is required.');
  if (!content) return showError('Prompt content is required.');

  const fields = { title, content, status, promptType, source: 'web' };
  if (description) fields.description = description;
  if (usageText) fields.usageExamples = usageText.split('\n').map(l => l.trim()).filter(Boolean);
  if (samplePrompts) fields.samplePrompts = samplePrompts;
  if (tagsText) fields.tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const result = await chrome.runtime.sendMessage({ type: 'SUBMIT_PROMPT_HOUSE', fields });

  if (result?.ok) {
    document.getElementById('form-ui').classList.add('hidden');
    document.getElementById('success-state').classList.remove('hidden');
    setTimeout(() => window.close(), 1200);
  } else {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    showError(result?.error || 'Failed to save. Try again.');
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
