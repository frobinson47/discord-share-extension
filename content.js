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
