const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('solanaSpotBotDesktop', {
  isDesktop: true,
  platform: process.platform,
});
