# Discord Auto-Populate Channels — Design Doc

> **Goal:** Replace manual server/channel entry with an OAuth2 + Bot flow that lets users connect their Discord account, browse servers, select channels, and auto-create webhooks — while keeping manual entry as a fallback.

## Architecture: Discord Application (OAuth2 + Bot)

A single Discord Application serves as both the OAuth2 provider (for user login and server discovery) and the bot (for channel listing and webhook creation).

### Prerequisites — Discord Developer Portal

User creates a Discord Application once:
1. Create Application → note **Client ID** and **Client Secret**
2. OAuth2 → add redirect URL: `https://<extension-id>.chromiumapp.org/oauth2`
3. Bot → enable bot, note **Bot Token**, grant `Manage Webhooks` permission (bit `536870912`)

These three values are entered in a "Developer Setup" section in the options page and stored in `chrome.storage.sync`.

## OAuth2 Flow

1. User clicks "Connect Discord" in options page
2. Extension calls `chrome.identity.launchWebAuthFlow` with:
   - `https://discord.com/oauth2/authorize?client_id=...&response_type=code&scope=identify+guilds&redirect_uri=https://<ext-id>.chromiumapp.org/oauth2`
   - `interactive: true`
3. Extension receives auth code from redirect URL
4. Extension exchanges code for access token via `POST https://discord.com/api/oauth2/token` (content-type: `application/x-www-form-urlencoded`)
5. Extension stores access token, refresh token, and expiry in `chrome.storage.sync`
6. Extension fetches `GET /users/@me` for display name/avatar and `GET /users/@me/guilds` for server list

## Bot Invite & Channel Selection

When user clicks "Setup" on a server:

1. Extension calls `GET /guilds/{guild.id}/channels` with bot token to check if bot is present
2. **Bot NOT in server:** Show "Add Bot to Server" button → opens `https://discord.com/oauth2/authorize?client_id=...&scope=bot&permissions=536870912&guild_id={guild.id}` in new tab. User authorizes, returns, clicks "Retry".
3. **Bot IS in server:** Extension fetches channels, filters to text channels (type `0`), displays as multi-select checklist
4. User selects channels → clicks "Import"
5. For each channel: `POST /channels/{channel.id}/webhooks` with bot token, body `{ name: "Discord Share" }`
6. Server + channels saved to existing storage schema: `{ id, name, channels: [{ id, name, webhookUrl }] }`

## Options Page UI Changes

### New "Discord Connection" section (above server list)

**Not connected state:**
- "Developer Setup" collapsible: Client ID, Client Secret, Bot Token inputs + Save button
- "Connect Discord" button (disabled until credentials saved)

**Connected state:**
- Discord username + avatar display
- "Disconnect" button
- "Import Server" button → opens server picker modal

### Import Server modal flow:
1. Shows user's guild list with icons
2. Already-imported servers grayed out
3. Pick server → check for bot → show channel checklist → import

### Manual fallback preserved:
- Existing "+ Add Server" button remains below the Discord section
- All existing CRUD (rename, delete, test webhook, add/remove channel) unchanged

## Storage Schema Additions

```js
{
  servers: [...],           // unchanged
  lastChannelId: null,      // unchanged
  discordApp: {             // NEW — developer credentials
    clientId,
    clientSecret,
    botToken
  },
  discordAuth: {            // NEW — OAuth tokens
    accessToken,
    refreshToken,
    expiresAt,
    user: { id, username, avatar }
  }
}
```

## Manifest Changes

- Add `"identity"` to `permissions`
- Add `"https://discord.com/api/*"` to `host_permissions`

## Error Handling

| Scenario | Handling |
|---|---|
| Token expired | Auto-refresh via refresh token. If refresh fails, show "Session expired" and clear tokens |
| Bot not in server | "Add Bot to Server" button with invite link |
| Missing Manage Webhooks | "Re-invite bot with correct permissions" with re-invite link |
| Rate limited (429) | Respect `Retry-After` header, show countdown |
| Webhook creation fails on a channel | Skip it, report which channels succeeded/failed |

## Compatibility

- Imported channels are stored in the same schema as manual channels
- Popup and background worker require zero changes
- Context menus rebuild automatically via existing `chrome.storage.onChanged` listener
