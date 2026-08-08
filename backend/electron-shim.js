// electron-shim.js
// A drop-in stand-in for the tiny slice of the `electron` module this codebase
// actually uses (ipcMain.handle/on/emit, plus an inert `app`/`BrowserWindow`).
// Nothing else in botConnection.js, commands.js, excavate.js, ipcHandlers.js,
// or ipcHandlersPatch.js had to change to run on a plain Node.js server —
// they still `require('./electron-shim')` and call the exact same methods
// they always did.
'use strict';

const handlers  = new Map(); // channel -> async (event, ...args) => result   (was ipcMain.handle)
const listeners = new Map(); // channel -> Set<fn>                            (was ipcMain.on)

const ipcMain = {
    handle(channel, fn) {
        handlers.set(channel, fn);
    },
    on(channel, fn) {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(fn);
    },
    // botConnection.js calls ipcMain.emit(...) directly to re-trigger the
    // 'execute-command' handler internally (clicker auto-restore after
    // reconnect). Real Electron's ipcMain.emit does NOT reach handlers
    // registered via .handle() — only .on() listeners — so that call was
    // silently a no-op in the original Electron app. This shim wires .emit()
    // to .handle()-registered channels too (fire-and-forget), so that
    // codepath actually does what it looks like it was meant to do.
    emit(channel, event, ...args) {
        const fn = handlers.get(channel);
        if (fn) Promise.resolve(fn(event, ...args)).catch(err =>
            console.error(`[electron-shim] error in emitted handler "${channel}":`, err));
        const set = listeners.get(channel);
        if (set) for (const l of set) l(event, ...args);
    },
    // -- Internal API used only by ws-bridge.js, not part of real electron --
    _invoke(channel, event, ...args) {
        const fn = handlers.get(channel);
        if (!fn) return Promise.reject(new Error(`No handler registered for "${channel}"`));
        return Promise.resolve(fn(event, ...args));
    },
    _hasHandler(channel) {
        return handlers.has(channel);
    },
};

// Unused by this codebase beyond a dead `const { app } = require('electron')`
// import, but kept as harmless stubs in case anything else touches them.
const app = {
    whenReady: () => Promise.resolve(),
    on() {},
    quit() {},
    getPath: () => process.cwd(),
};

class BrowserWindow {
    constructor() {}
    static getAllWindows() { return []; }
}

module.exports = { ipcMain, app, BrowserWindow };
