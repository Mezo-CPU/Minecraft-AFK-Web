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
//
// Also exposes a POST /login endpoint: the frontend's login page posts a
// username/password here, and only gets the real ACCESS_TOKEN back if they
// match DASH_USER/DASH_PASS. This means the access token is never shipped
// in the frontend's JavaScript — it only reaches the browser after a
// correct login, and only lives in that browser's sessionStorage.
'use strict';

const http   = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT         = process.env.PORT || 25580;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const DASH_USER    = process.env.DASH_USER || '';
const DASH_PASS    = process.env.DASH_PASS || '';

if (!ACCESS_TOKEN) {
    console.warn(
        '\n[ws-bridge] WARNING: no ACCESS_TOKEN environment variable set.\n' +
        '            This server will accept connections from ANYONE who finds\n' +
        '            its address — including control of your Minecraft accounts.\n' +
        '            Set ACCESS_TOKEN before exposing this publicly.\n'
    );
}
if (!DASH_USER || !DASH_PASS) {
    console.warn(
        '\n[ws-bridge] WARNING: DASH_USER/DASH_PASS not set — the /login\n' +
        '            endpoint will reject everyone. Set both to enable the\n' +
        '            dashboard login page.\n'
    );
}

// Constant-time string compare so response timing can't leak how much of a
// guessed username/password was correct.
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function withCors(res) {
    // Dashboard (Cloudflare Workers) and backend (Cloudflare Tunnel) are on
    // different origins, so the login fetch() is cross-origin — allow it.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function startServer({ ipcMain }) {
    const httpServer = http.createServer((req, res) => {
        if (req.method === 'OPTIONS') {
            withCors(res);
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.url === '/health' || req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
            return;
        }

        if (req.url === '/login' && req.method === 'POST') {
            withCors(res);
            let body = '';
            req.on('data', (chunk) => { body += chunk; if (body.length > 1e4) req.destroy(); });
            req.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(body); } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Bad request' }));
                    return;
                }
                const { username = '', password = '' } = parsed;
                const ok = DASH_USER && DASH_PASS &&
                    safeEqual(username, DASH_USER) && safeEqual(password, DASH_PASS);
                if (ok) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ token: ACCESS_TOKEN }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid credentials' }));
                }
            });
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