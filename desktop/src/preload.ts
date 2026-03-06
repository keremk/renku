// Minimal preload script for v1.
// The viewer SPA communicates with the server over HTTP,
// so no IPC bridge is needed for now.
//
// This file exists as a placeholder for future Electron-native
// features (e.g., native file dialogs via IPC).

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('renku', {
  isElectron: true,
});
