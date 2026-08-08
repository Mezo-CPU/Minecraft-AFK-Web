// ws-bridge.js
// Transport layer that replaces Electron's IPC between main process and
// renderer. The frontend (api.js) sends { type:'rpc', id, channel, args }
// over WebSocket for anything that used to be ipcRenderer.invoke(channel,
// ...args); this server routes it to the matching ipcMain.handle(channel, fn)
// registered by botConnection.js / commands.js / excavate.js / ipcHandlers.js
// / ipcHandlersPatch.js — completely unchanged from the Electron version —
// and replies with { type:'rpc-result' | 'rpc-error', id, ... }.
//
// Anything the main process used to push via mainWindow.webContents.send(
// channel, data) (logs, bot-update, connection-status, etc.) is broadcast to
// every connected client as { type:'event', channel, data }.
'use strict';

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT         = process.env.PORT || 25580;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';

if (!ACCESS_TOKEN) {
    console.warn(
        '\n[ws-bridge] WARNING: no ACCESS_TOKEN environment variable set.\n' +
        '            This server will accept connections from ANYONE who finds\n' +
        '            its address — including control of your Minecraft accounts.\n' +
        '            Set ACCESS_TOKEN before exposing this publicly.\n'
    );
}

function startServer({ ipcMain }) {
    const httpServer = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
            return;
        }
        res.writeHead(404);
        res.end();
    });

    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws, req) => {
        const url   = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');

        if (ACCESS_TOKEN && token !== ACCESS_TOKEN) {
            ws.close(4001, 'Unauthorized');
            return;
        }

        console.log('[ws-bridge] Client connected');

        ws.on('message', async (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            if (msg.type !== 'rpc') return;

            const { id, channel, args = [] } = msg;
            try {
                if (!ipcMain._hasHandler(channel)) {
                    throw new Error(`Unknown channel: "${channel}"`);
                }
                const result = await ipcMain._invoke(channel, {}, ...args);
                ws.send(JSON.stringify({ type: 'rpc-result', id, result }));
            } catch (err) {
                ws.send(JSON.stringify({ type: 'rpc-error', id, error: err.message || String(err) }));
            }
        });

        ws.on('close', () => console.log('[ws-bridge] Client disconnected'));
        ws.on('error', (err) => console.error('[ws-bridge] Socket error:', err.message));
    });

    httpServer.listen(PORT, () => {
        console.log(`[ws-bridge] Listening on port ${PORT} (ws path: /ws)`);
    });

    // Adapter that stands in for Electron's `mainWindow`. Every existing file
    // calls `core.mainWindow?.webContents.send(channel, data)` — that keeps
    // working unmodified, it just now fans out over WebSocket instead of into
    // a native window.
    return {
        webContents: {
            send(channel, data) {
                const payload = JSON.stringify({ type: 'event', channel, data });
                for (const client of wss.clients) {
                    if (client.readyState === WebSocket.OPEN) client.send(payload);
                }
            },
        },
    };
}

module.exports = { startServer };
