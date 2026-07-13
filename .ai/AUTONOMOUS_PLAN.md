# Autonomous Forge Roadmap

## Product vision

discord-share-extension uses Autonomous Forge to keep a clear improvement plan, choose small tasks, check results, and record what happened.

## Product scope and non-goals

This roadmap tracks incremental improvements. It is not a replacement for project management, issue tracking, or deployment tooling.

## Current architecture

To be documented as the project evolves.

## Current implementation status

Roadmap v1 is in progress.

## Technical debt

None documented yet.

## Prioritized roadmap

## Roadmap v1

### AUTO-001 — Guard against Discord's 2000-char content limit
Priority: P1
Status: DONE

Goal: Prevent silent Discord 400 rejections when a text-selection send exceeds Discord's 2000-character `content` limit.
Why it matters: `Formatter.textSelection` (formatter.js:7-20) wraps the raw selection with no length check. The popup preview truncates to 200 chars for *display only* (popup.js:134), so a long selection currently fails with a 400 the user has to decode from raw response text, with no warning beforehand. Flagged in docs/notes/2026-07-10-code-health-pass.md iteration 1.
Scope: Add a length check before send (either truncate with a visible marker, or block send and warn the user) and fix the related bug where a selection containing a triple-backtick sequence breaks out of the wrapping code block early.
Expected files or areas: formatter.js, popup.js, background.js (wherever the send path enforces the check).
Acceptance criteria: A selection over ~2000 chars after formatting is caught before the webhook POST, with a clear user-facing message; a selection containing ``` no longer garbles the sent message.
Validation: Manual test in a loaded extension — send a long selection and a selection containing a code fence, confirm no raw 400 leaks to the user and formatting stays intact.
Risks or assumptions: Assumes truncation (vs. hard block) is acceptable UX; confirm preferred behavior isn't already decided elsewhere.
Notes: None.

### AUTO-002 — Remove dead content.js and unused Formatter.postToWebhook
Priority: P2
Status: TODO

Goal: Delete dead code identified in the 2026-07-10 code health pass.
Why it matters: `content.js`'s `CAPTURE_CONTEXT` listener is never sent by anything — background.js and popup.js both use inline `chrome.scripting.executeScript` instead — yet content.js still gets injected into every page (`matches: ["<all_urls>"]`) for no purpose. `Formatter.postToWebhook` (formatter.js:50-65) is also defined but never called; background.js's `handleSend` reimplements the same logic inline.
Scope: Remove content.js and its manifest.json content_script registration if confirmed unused; either delete `Formatter.postToWebhook` or refactor `handleSend` to call it instead of duplicating fetch/response-check logic.
Expected files or areas: content.js, manifest.json, formatter.js, background.js.
Acceptance criteria: No behavior change for any existing send flow (text selection, link, image); one fewer unnecessary content-script injection; no duplicated webhook-post logic.
Validation: `node --check` on touched files; manually exercise each send type in a loaded extension to confirm no regression.
Risks or assumptions: Assumes content.js truly has no other consumer — re-grep for `CAPTURE_CONTEXT` before deleting to be sure.
Notes: None.

### AUTO-003 — Narrow "tabs" permission to "activeTab"
Priority: P2
Status: TODO

Goal: Drop the broader `"tabs"` permission from manifest.json in favor of `"activeTab"`, which already covers the extension's one actual use.
Why it matters: manifest.json declares `"tabs"` alongside `"activeTab"`, but the only `chrome.tabs.*` call in the codebase (popup/popup.js:101, `chrome.tabs.query({ active: true, currentWindow: true })`) only ever touches the active tab, opened via a qualifying user gesture (toolbar click or context-menu action) that already grants `activeTab`. `"tabs"` exposes `url`/`title`/`pendingUrl` for every open tab and is called out more prominently on Chrome's install/update consent screen — unnecessary permission surface for a personal extension. Flagged in docs/notes/2026-07-10-code-health-pass.md iteration 2.
Scope: Remove `"tabs"` from manifest.json permissions; verify the no-pending-payload popup path (toolbar-click open, no context-menu payload) still works under `activeTab` alone.
Expected files or areas: manifest.json, popup/popup.js.
Acceptance criteria: Extension loads with only `"activeTab"` (no `"tabs"`); opening the popup via toolbar click still correctly reads the active tab's title/url.
Validation: Reload unpacked extension, open popup via toolbar icon with no prior context-menu action, confirm title/url populate as before.
Risks or assumptions: Assumes `activeTab` is in fact granted for a toolbar-click-opened popup — confirm by testing rather than assuming, per the note that flagged this.
Notes: None.

## Future Ideas

## Do Not Change Without Explicit Human Approval

- Remote and branch settings.
- Repository visibility and access controls.
- Production infrastructure.
- Features that run external commands.
- Credential handling, telemetry, analytics, billing, or deployment behavior.
