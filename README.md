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

### Faster setup with a bot (optional)
Instead of copying webhook URLs one by one, open **Bot Setup** in the options
page, paste a Discord bot token (needs **Manage Webhooks** permission), then
click **Import Server from Discord** to pull in a server's text channels and
auto-create webhooks for the ones you pick.

## Usage

**Toolbar popup:** Click the extension icon on any page to send the current page (or active text selection) to a channel.

**Right-click menu:** Select text, right-click a link, or right-click an image → "Send to Discord" → pick a channel → add an optional note → Send.

## What Gets Sent

| Content | Discord Format |
|---|---|
| Text selection | Code block + page title + URL |
| Link / page | Rich embed with title + URL |
| Image | Embedded image preview |

## Prompt House

A separate, independent feature for saving and reusing prompts — configured
under its own section in the options page (API key + endpoint).

**Save a prompt:** Highlight text → right-click → **Save to Prompt House** →
a form opens pre-filled with the selection (and an auto-tag for the source
site) where you fill in title, description, usage examples, status, and type.

**Insert a saved prompt:** Right-click into any text field or editor → **Insert
Prompt from Prompt House** → search, then click (or arrow keys + Enter) to
insert it at the cursor.
