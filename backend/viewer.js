// viewer.js - prismarine-viewer integration
//
// Starts/stops a prismarine-viewer HTTP server for each connected bot so the
// frontend's "🗺️ Viewer" tab can embed it in an iframe. prismarine-viewer
// starts its own plain HTTP+WS server per bot instance, so each active bot
// needs its own port — we use VIEWER_BASE_PORT + botId.
'use strict';

const core = require('./main');

const VIEWER_BASE_PORT = parseInt(process.env.VIEWER_BASE_PORT) || 25600;

// botId -> { port }
const activeViewers = new Map();

function startViewer(botId, botInstance) {
    if (activeViewers.has(botId)) return; // already running for this bot

    const port = VIEWER_BASE_PORT + botId;

    try {
        // Lazy-require so a missing/broken prismarine-viewer install only
        // kills the viewer feature, not the whole backend process.
        const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
        mineflayerViewer(botInstance, { port, firstPerson: false });

        activeViewers.set(botId, { port });
        core.sendLog(botId, 'info', `🗺️ World viewer started on port ${port}`);
        core.mainWindow?.webContents.send('viewer-status', {
            accountId: botId,
            status: 'online',
            port,
        });

        // prismarine-viewer attaches its own bot.on('end', ...) internally to
        // tear down its HTTP server when the bot disconnects — we don't need
        // to close anything ourselves, just clear our bookkeeping (stopViewer
        // below) and tell the frontend.
    } catch (err) {
        core.sendLog(botId, 'error', `Failed to start world viewer: ${err.message}`);
    }
}

function stopViewer(botId) {
    if (!activeViewers.has(botId)) return;
    activeViewers.delete(botId);
    core.mainWindow?.webContents.send('viewer-status', { accountId: botId, status: 'offline' });
}

module.exports = { startViewer, stopViewer };