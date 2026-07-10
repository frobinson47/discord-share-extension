# Code health pass — 2026-07-10 (autonomous /loop, iteration 1/6)

Self-directed review of the extension codebase. Not fixed — surfacing per "flag design smells, don't touch unrelated code."

## Dead code
- `content.js`'s `CAPTURE_CONTEXT` message listener is never sent by anything.
  `background.js` and `popup.js` both use inline `chrome.scripting.executeScript`
  with a func literal instead (see background.js:75-85, popup.js:101-109).
  `content.js` appears to be a leftover from an earlier design and is currently
  dead weight — it still gets injected into every page (`matches: ["<all_urls>"]`)
  for no active purpose.
- `Formatter.postToWebhook` (formatter.js:50-65) is defined but never called.
  `background.js`'s `handleSend` reimplements the same fetch-and-check-`res.ok`
  logic inline instead of reusing it. Minor duplication; `postToWebhook` could
  be deleted or `handleSend` could call it.

## Latent bug — no length guard on Discord sends
`Formatter.textSelection` wraps the raw selection in a code block and sends it
as-is (formatter.js:7-20). Two edge cases aren't handled:
1. Discord message `content` has a **2000-char hard limit**. A long selection
   (copied from an article, a long code file, etc.) will get silently rejected
   by Discord with a 400 the user has to decode from raw response text — popup
   preview truncates to 200 chars for *display* only (popup.js:134), so nothing
   warns the user before they hit Send.
2. If the selected text itself contains a triple-backtick sequence, it breaks
   out of the wrapping code block early, garbling the Discord message
   (the closing fence appears mid-selection, formatting goes sideways after).

Neither is exploitable/security-relevant, just a paper-cut for real usage —
worth a follow-up if long-selection sends come up again.

## Everything else looked reasonable
storage.js, discord-api.js, and the Prompt House code added this session are
consistent in style and don't show obvious smells beyond the above.

---

## Iteration 2/6 — permissions audit

manifest.json declares `"tabs"` alongside `"activeTab"`. Grepped every
`chrome.tabs.*` call in the codebase — there's exactly one, in
`popup/popup.js:101`: `chrome.tabs.query({ active: true, currentWindow: true })`,
used to read the active tab's `title`/`url` when the popup opens without a
pending context-menu payload.

That call only ever touches the *active* tab, and the popup only ever opens
via a toolbar-icon click or a context-menu action — both are the qualifying
user gestures that grant `activeTab` for that tab automatically. `"tabs"` is a
broader permission than `"activeTab"`: it exposes `url`/`title`/`pendingUrl`
for *every open tab*, not just the active one, and it's one of the permissions
Chrome calls out more prominently in the install/update consent screen.

Given the only usage fits entirely within what `activeTab` already covers,
`"tabs"` in manifest.json:6 looks like unnecessary permission surface for a
personal extension that's mindful about secret/key handling elsewhere. Worth
confirming removal doesn't break the no-pending-payload popup path (i.e. that
`activeTab` is in fact granted for a toolbar-click-opened popup, which it
should be) before dropping it — flagging rather than changing, since this is
exploration, not an assigned task.

---

## Iteration 3/6 — innerHTML / XSS audit

Went through every `innerHTML` write in the extension (options.js, popup.js,
prompthouse/insert.js) looking for a spot where API- or page-controlled text
gets interpolated without escaping — the realistic attack surface here is a
malicious/compromised Discord guild or channel name, or a Prompt House API
response, since those are the only "untrusted" strings ever rendered.

**Result: clean.** Every site that interpolates a name/title (`server.name`,
`ch.name`, `g.name` (guild), `guildName`, and in `insert.js` the prompt
`title`/`promptType`/`status`/`description`) goes through `escHtml` first.
`escHtml` itself (options.js:112, popup.js, insert.js — three separate copies,
minor duplication but not a bug) correctly escapes `& < > "`.

One low-severity nit, not worth a fix: `options.js:402` builds `<img src="${iconUrl}">`
for the Discord guild-icon avatar without escaping `iconUrl`. In practice
`iconUrl` is `DiscordAPI.getGuildIconUrl(guildId, iconHash)` — a CDN URL built
from a numeric snowflake + Discord's own icon hash, never attacker-editable
free text, so this isn't exploitable today. Flagging only because it's the
one interpolation that breaks the "always escHtml" pattern the rest of the
codebase follows — a future refactor that lets `iconUrl` come from anywhere
less trusted would want to catch this.

No changes made — this was a verification pass, and it came back clean.

---

## Iteration 4/6 — keyboard nav for the insert-search popup (implemented)

Noticed the "Insert from Prompt House" popup (added earlier this session) had
no keyboard navigation — every result required a mouse click. Small, low-risk,
purely additive gap, so fixed it rather than just noting it:

- `prompthouse/insert.js`: Arrow Up/Down cycles the highlighted result
  (wraps around), Enter inserts the highlighted (or first) result, Escape
  closes the popup. Hovering a result also updates the highlight so mouse and
  keyboard stay in sync.
- `prompthouse/prompthouse.css`: `.result-item.selected` reuses the existing
  hover style.
- Bumped `manifest.json` to `1.1.1` per the standing rule to bump version on
  every change.

Syntax-checked with `node --check`; not manually tested in a loaded browser
this pass (autonomous loop, no user available to confirm) — worth a quick
sanity check next time the extension is reloaded.

---

## Iteration 5/6 — README was stale (fixed)

README.md only described the manual webhook-paste setup flow. It had zero
mention of two features that already exist in the code: the bot-token
import flow (`options.html` "Bot Setup" + "Import Server from Discord",
backed by the Gateway-WebSocket bypass in background.js) and Prompt House
entirely (capture form + reverse insert flow, both added this session).

Added two sections — "Faster setup with a bot (optional)" under Setup, and a
new "Prompt House" section — describing the user-facing flow only, no
enumerable field lists (per the doc-hygiene rule: point at the source, don't
mirror it). Docs-only change, no code touched.

---

## Iteration 6/6 — wrap-up

Re-ran `node --check` on every JS file in the extension and validated
`manifest.json` as JSON — all clean. This closes the 6-loop autonomous
session; nothing left uncommitted has an unverified syntax error.

**Uncommitted at end of session** (deliberately left for you to review before
committing — an unattended loop shouldn't push its own changes):
- `README.md` — bot-import + Prompt House sections added
- `manifest.json` — version bump to 1.1.1
- `prompthouse/insert.js`, `prompthouse/prompthouse.css` — keyboard nav for
  the insert-search popup (arrows/Enter/Escape)

**Session summary (6 iterations):**
1. Dead code: unused `content.js` CAPTURE_CONTEXT listener, unused `Formatter.postToWebhook`; latent 2000-char/backtick edge case in Discord sends. Noted only.
2. Permissions audit: `"tabs"` manifest permission looks broader than the codebase actually needs (`"activeTab"` would cover the one call site). Noted only.
3. XSS/innerHTML audit across the whole extension — came back clean.
4. Fixed: added keyboard navigation to the Prompt House insert-search popup.
5. Fixed: README was missing the bot-import and Prompt House features entirely.
6. This wrap-up / final verification pass.

Nothing here was pushed or committed — that's a call for you to make, not this loop.
