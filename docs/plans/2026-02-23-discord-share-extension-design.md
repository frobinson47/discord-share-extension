# Discord Share Extension — Design Doc
**Date:** 2026-02-23
**Status:** Approved

---

## Overview

A Chrome/Edge browser extension that lets users send selected text, links, and images from any webpage directly to specific Discord channels on their server via Discord webhooks.

---

## Goals

- Right-click any selection (text, link, image) and send it to a Discord channel in a few clicks
- Toolbar popup for composing and sending with a note before dispatching
- No backend, no bot, no OAuth — pure Discord webhooks
- Channels grouped by server for easy navigation
- Config syncs across Chrome profile via `chrome.storage.sync`

---

## Non-Goals

- Auto-posting without user confirmation
- Discord bot integration or OAuth
- Any backend server

---

## Architecture

**Type:** Manifest V3 Chrome/Edge Extension
**Build:** Plain HTML/CSS/JS — no bundler, load unpacked during dev
**Transport:** HTTP POST to Discord webhook URLs stored in `chrome.storage.sync`

### File Structure

```
discord-share-extension/
├── manifest.json          # MV3 config, permissions, context menus
├── background.js          # Service worker — context menu logic, webhook POSTs
├── popup/
│   ├── popup.html         # Toolbar icon panel
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html       # Settings page (add servers/channels/webhooks)
│   ├── options.js
│   └── options.css
├── content.js             # Injected into pages — captures selections & page meta
└── icons/
    └── icon-16/32/48/128.png
```

### Data Flow

```
User selects text → right-click → context menu (background.js)
                                        ↓
                              content.js grabs selection + page title + URL
                                        ↓
                              popup opens pre-filled → user picks channel + adds note
                                        ↓
                              background.js POSTs to Discord webhook URL
```

### Storage Schema (`chrome.storage.sync`)

```json
{
  "servers": [
    {
      "id": "uuid",
      "name": "My Dev Server",
      "channels": [
        {
          "id": "uuid",
          "name": "#general",
          "webhookUrl": "https://discord.com/api/webhooks/..."
        }
      ]
    }
  ],
  "lastChannelId": "uuid"
}
```

---

## Components

### 1. Settings Page (`options/`)

- Add/rename/delete servers (label only, no Discord API)
- Add/delete channels with name + webhook URL per server
- Webhook URLs masked after saving
- Test button fires a test message to validate webhook before saving
- Export config to JSON / Import from JSON for backup/portability

**UI:**
```
▼ My Dev Server                     [✎][✗]
  ├─ #general        [webhook ••••] [✗]
  ├─ #links          [webhook ••••] [✗]
  └─ + Add Channel

[Export Config]  [Import Config]
```

### 2. Popup (`popup/`)

- Opens on toolbar icon click
- Pre-fills content based on current page (active selection or page URL)
- Channel list grouped by server with radio selection
- Remembers last used channel
- Content preview (shows exactly what will post)
- "Add a note..." text area
- Send button → success state (✅) → auto-close after 1.5s
- Gear icon links to options page
- Friendly empty state if no channels configured

### 3. Background Service Worker (`background.js`)

- Registers context menu items dynamically from stored config
- Listens for context menu clicks, opens popup with pre-filled payload
- Executes `chrome.scripting.executeScript` to extract selection/page meta via `content.js`
- POSTs formatted message to selected webhook URL
- Handles fetch errors and surfaces them in the popup

### 4. Content Script (`content.js`)

- Injected on all pages
- Captures: `window.getSelection()`, `document.title`, `location.href`
- Returns structured payload: `{ type, text, url, title, imageUrl }`

---

## Discord Message Formats

### Text Selection
```
📋 Page Title
🔗 https://source-url.com

```selected text in code block```

📝 User note (if provided)
```

### Link / Page Share
Discord embed:
- **Title:** fetched page title
- **URL:** the link
- **Description:** user note (if added)
- **Color:** `#5865F2` (Discord blurple)

### Image Share
- Image URL sent as embed so Discord renders the preview
- Source page URL + note appended below

---

## Context Menu Structure

```
Send to Discord ►
  ├─ My Dev Server
  │   ├─ #general
  │   └─ #links
  └─ My Research Server
      └─ #notes
```

Clicking a channel pre-fills the popup — user still confirms before sending.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Webhook URL invalid | Test on save fails with inline error |
| POST fails (network) | Popup shows "Failed to send — try again" |
| No channels configured | Popup shows setup prompt with link to options |
| Webhook deleted in Discord | Error on send, prompt to update settings |

---

## Permissions Required

```json
"permissions": ["storage", "contextMenus", "scripting", "activeTab"]
"host_permissions": ["https://discord.com/api/webhooks/*"]
```

---

## Future Ideas (Out of Scope Now)

- Keyboard shortcut to open popup
- Send history / log
- Screenshot capture and send
- Pin favorite channels to top
