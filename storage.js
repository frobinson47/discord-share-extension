// storage.js
// Shared storage helpers for chrome.storage.sync

const Storage = {
  // Returns the full config object { servers: [...], lastChannelId: null }
  async getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['servers', 'lastChannelId'], (result) => {
        resolve({
          servers: result.servers || [],
          lastChannelId: result.lastChannelId || null,
        });
      });
    });
  },

  async saveServers(servers) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ servers }, resolve);
    });
  },

  async saveLastChannelId(channelId) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ lastChannelId: channelId }, resolve);
    });
  },

  // Finds a channel by ID across all servers, returns { server, channel } or null
  async findChannel(channelId) {
    const { servers } = await this.getConfig();
    for (const server of servers) {
      const channel = server.channels.find((c) => c.id === channelId);
      if (channel) return { server, channel };
    }
    return null;
  },

  // Generates a simple unique ID
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },
};
