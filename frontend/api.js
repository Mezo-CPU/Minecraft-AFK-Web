// api.js - Web replacement for preload.js
//
// The original app used Electron's contextBridge to expose `window.api` as a
// thin wrapper around ipcRenderer.invoke()/on(). Nothing in renderer.js,
// tabs.js, settings.js, or macroBlocks.js talks to Electron directly — they
// only ever call window.api.* — so this file reproduces that exact same
// `window.api` shape, just backed by a WebSocket connection to the backend
// (see backend/ws-bridge.js) instead of IPC. Every method name, argument
// order, and return shape below matches preload.js exactly.
'use strict';

(function () {
    const cfg = window.CONSOLE_CONFIG || {};
    if (!cfg.backendUrl) {
        console.error('[api.js] window.CONSOLE_CONFIG.backendUrl is not set — check config.js');
    }

    let socket           = null;
    let nextId            = 1;
    const pending          = new Map();  // rpc id -> { resolve, reject }
    // Messages built while the socket is still CONNECTING (e.g. renderer.js's
    // init() calls window.api.getBots() synchronously on page load, well
    // before the WebSocket handshake to the ngrok tunnel finishes). These are
    // held here and flushed once the socket actually opens, instead of being
    // rejected outright.
    const sendQueue         = [];
    const eventListeners   = new Map();  // channel -> Set<fn>
    let reconnectDelay     = 1000;
    const MAX_RECONNECT_DELAY = 15000;
    let manuallyClosed      = false;

    function wsUrl() {
        const base  = cfg.backendUrl.replace(/\/+$/, '');
        const token = encodeURIComponent(cfg.accessToken || '');
        // backendUrl is expected to already point at ws(s)://host:port — the
        // server listens for upgrades on /ws.
        return `${base}/ws?token=${token}`;
    }

    function connect() {
        manuallyClosed = false;
        socket = new WebSocket(wsUrl());

        socket.addEventListener('open', () => {
            reconnectDelay = 1000;
            console.log('[api.js] Connected to backend');
            emitLocal('__connection__', { status: 'connected' });
            while (sendQueue.length) {
                socket.send(JSON.stringify(sendQueue.shift()));
            }
        });

        socket.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }

            if (msg.type === 'rpc-result' || msg.type === 'rpc-error') {
                const p = pending.get(msg.id);
                if (!p) return;
                pending.delete(msg.id);
                if (msg.type === 'rpc-result') p.resolve(msg.result);
                else p.reject(new Error(msg.error || 'Unknown backend error'));
                return;
            }

            if (msg.type === 'event') {
                const set = eventListeners.get(msg.channel);
                if (set) for (const cb of set) cb(msg.data);
            }
        });

        socket.addEventListener('close', (ev) => {
            emitLocal('__connection__', { status: 'disconnected' });
            for (const [, p] of pending) p.reject(new Error('Connection to backend lost'));
            pending.clear();
            sendQueue.length = 0;
            if (manuallyClosed) return;
            if (ev.code === 4001) {
                console.error('[api.js] Backend rejected the connection — check your access token in config.js');
                return; // don't hammer retries on a bad token
            }
            console.warn(`[api.js] Disconnected — retrying in ${reconnectDelay}ms`);
            setTimeout(connect, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 1.7, MAX_RECONNECT_DELAY);
        });

        socket.addEventListener('error', () => {
            // 'close' fires right after; reconnect is handled there.
        });
    }

    function emitLocal(channel, data) {
        const set = eventListeners.get(channel);
        if (set) for (const cb of set) cb(data);
    }

    function on(channel, cb) {
        if (!eventListeners.has(channel)) eventListeners.set(channel, new Set());
        eventListeners.get(channel).add(cb);
    }

    function rpc(channel, ...args) {
        return new Promise((resolve, reject) => {
            if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
                reject(new Error('Not connected to backend'));
                return;
            }
            const id = nextId++;
            const msg = { type: 'rpc', id, channel, args };
            pending.set(id, { resolve, reject });
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(msg));
            } else {
                // Still CONNECTING — hold the message until the 'open' handler
                // flushes it, rather than failing calls made during page load.
                sendQueue.push(msg);
            }
        });
    }

    connect();

    window.api = {
        // Microsoft Accounts
        getAuthenticatedAccounts: ()              => rpc('get-authenticated-accounts'),
        createMicrosoftAccount:   (username)      => rpc('create-microsoft-account', username),
        deleteAccount:            (identifier)    => rpc('delete-account', identifier),

        // Bots
        getBots:    ()                => rpc('get-bots'),
        createBot:  (botData)         => rpc('create-bot', botData),
        deleteBot:  (botId)           => rpc('delete-bot', botId),
        updateBot:  (botId, updates)  => rpc('update-account', botId, updates),

        // Bot control
        connectBot:     (botId)          => rpc('connect-bot', botId),
        disconnectBot:  (botId)          => rpc('disconnect-bot', botId),
        sendChat:       (botId, message) => rpc('send-chat', botId, message),
        executeCommand: (botId, command) => rpc('execute-command', botId, command),

        // Macro movement helpers (used by macroBlocks.js)
        executeMoveCtrl: (botId, direction, ms) => rpc('execute-move-ctrl', botId, direction, ms),
        executeJumpOnce: (botId)                => rpc('execute-jump-once', botId),

        // Direct bot control state (used by Movement modal)
        setControlState: (botId, control, enabled) => rpc('set-control-state', botId, control, enabled),

        // Excavation
        startExcavation:      (botId, coords)  => rpc('start-excavation', botId, coords),
        startExcavationMulti: (botIds, coords) => rpc('start-excavation-multi', botIds, coords),
        stopExcavation:       (botId)          => rpc('stop-excavation', botId),
        getExcavationStatus:  (botId)          => rpc('get-excavation-status', botId),

        // Auto-TPA
        getAutoTpa:        (botId)           => rpc('get-auto-tpa', botId),
        setAutoTpa:        (botId, settings) => rpc('set-auto-tpa', botId, settings),
        setAutoTpaEnabled: (botId, enabled)  => rpc('set-auto-tpa-enabled', botId, enabled),

        // Reconnect settings
        setReconnectSettings: (settings) => rpc('set-reconnect-settings', settings),

        // Bot behaviour settings
        setBotBehaviourSettings: (settings) => rpc('set-bot-behaviour-settings', settings),

        // Crafting (no backend handler existed for these in the original
        // Electron app either — kept here so calls fail the same way: a
        // rejected promise with "Unknown channel", not a JS TypeError)
        getCraftingRecipes:    ()                   => rpc('get-crafting-recipes'),
        openCraftingTable:     (botId)               => rpc('open-crafting-table', botId),
        getCraftingInventory:  (botId)               => rpc('get-crafting-inventory', botId),
        checkCanCraft:         (botId, recipe)       => rpc('check-can-craft', botId, recipe),
        autoCraft:              (botId, recipe)       => rpc('auto-craft', botId, recipe),
        startCraftingLoop:     (botId, opts)          => rpc('start-crafting-loop', botId, opts),
        stopCraftingLoop:      (botId)                => rpc('stop-crafting-loop', botId),
        getCraftingLoopStatus: (botId)                => rpc('get-crafting-loop-status', botId),
        dropItem:              (botId, item, count)   => rpc('drop-item', botId, item, count),

        // Event listeners
        onLog:              (cb) => on('log', cb),
        onBotUpdate:        (cb) => on('bot-update', cb),
        onConnectionStatus: (cb) => on('connection-status', cb),
        onBotAdded:         (cb) => on('bot-added', cb),
        onBotDeath:         (cb) => on('bot-death', cb),
        onContainerOpen:    (cb) => on('container-open', cb),
        onContainerClose:   (cb) => on('container-close', cb),
        onExcavationStatus: (cb) => on('excavation-status', cb),
        onPlayerEnterRange: (cb) => on('player-enter-range', cb),
        onCraftingTableOpened: (cb) => on('crafting-table-opened', cb),
        onCraftingTableClosed: (cb) => on('crafting-table-closed', cb),
        onCraftingLoopStatus:  (cb) => on('crafting-loop-status', cb),

        // Extra (new): lets the UI react to the backend link itself dropping —
        // nothing in the original UI calls this, it's purely additive and
        // optional, since a WebSocket over the internet can disconnect in a
        // way Electron IPC never did.
        onBackendConnectionChange: (cb) => on('__connection__', cb),
    };
})();
