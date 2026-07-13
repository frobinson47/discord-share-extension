// formatter.js
// Formats payloads for the Discord webhook API.
// Discord webhook POST body: { content: string } or { embeds: [...] }

// Discord webhook `content` hard limit.
const DISCORD_CONTENT_LIMIT = 2000;

const Formatter = {
  // Text selection: plain message with code block + source info
  textSelection({ pageTitle, pageUrl, selectedText, note }) {
    // A ``` sequence inside the selection would close the wrapping code
    // block early and garble the message, so neutralize it before wrapping.
    let body = selectedText.replace(/```/g, '`​``');

    const header = `📋 **${pageTitle}**\n🔗 ${pageUrl}\n\n\`\`\`\n`;
    const footer = '\n```' + (note && note.trim() ? `\n\n📝 ${note.trim()}` : '');

    const bodyBudget = DISCORD_CONTENT_LIMIT - header.length - footer.length;
    if (body.length > bodyBudget) {
      const notice = '… (truncated)';
      body = body.slice(0, Math.max(0, bodyBudget - notice.length)) + notice;
    }

    return { content: header + body + footer };
  },

  // Link/page share: rich embed
  linkEmbed({ pageTitle, pageUrl, note }) {
    const embed = {
      title: pageTitle || pageUrl,
      url: pageUrl,
      color: 0x5865f2, // Discord blurple
    };
    if (note && note.trim()) {
      embed.description = note.trim();
    }
    return { embeds: [embed] };
  },

  // Image share: embed with image
  imageEmbed({ imageUrl, pageUrl, note }) {
    const lines = [];
    lines.push(`🔗 ${pageUrl}`);
    if (note && note.trim()) {
      lines.push(`📝 ${note.trim()}`);
    }
    return {
      content: lines.join('\n') || undefined,
      embeds: [{ image: { url: imageUrl }, color: 0x5865f2 }],
    };
  },

  // Sends a formatted payload to a Discord webhook URL
  // Returns { ok: true } or { ok: false, error: string }
  async postToWebhook(webhookUrl, payload) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Discord returned ${response.status}: ${text}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
