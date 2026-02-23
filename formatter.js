// formatter.js
// Formats payloads for the Discord webhook API.
// Discord webhook POST body: { content: string } or { embeds: [...] }

const Formatter = {
  // Text selection: plain message with code block + source info
  textSelection({ pageTitle, pageUrl, selectedText, note }) {
    const lines = [];
    lines.push(`📋 **${pageTitle}**`);
    lines.push(`🔗 ${pageUrl}`);
    lines.push('');
    lines.push('```');
    lines.push(selectedText);
    lines.push('```');
    if (note && note.trim()) {
      lines.push('');
      lines.push(`📝 ${note.trim()}`);
    }
    return { content: lines.join('\n') };
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
