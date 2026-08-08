// ipcHandlers.js - Account, bot management & connection IPC handlers
'use strict';

const { ipcMain } = require('./electron-shim');
const path = require('path');
const { Authflow, Titles } = require('prismarine-auth');
const fs = require('fs');

const core = require('./main');
const { createBotConnection } = require('./botConnection');

// ── Local data directory (must match main.js) ─────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
// Portable auth-cache location under the app's own data/ dir (the original
// hardcoded a Windows-only path here, which never worked outside Windows).
const TOKENS_DIR  = path.join(DATA_DIR, 'auth-cache');
// Prismarine-auth writes JSON files into authCacheDir while running.
// These are kept as plaintext — the sensitive Minecraft session token is
// already protected separately by the encrypted tokens.enc file in main.js.


// ── Auto-TPA persistence ──────────────────────────────────────────────────────
const AUTOTPA_FILE = path.join(DATA_DIR, 'autotpa.json');

function loadAutoTpaPlayersForBot(_botId) {
    try {
        const all = JSON.parse(fs.readFileSync(AUTOTPA_FILE, 'utf8'));
        if (Array.isArray(all.players)) return all.players;
    } catch {}
    return [];
}

function saveAutoTpaPlayersForBot(_botId, players) {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(AUTOTPA_FILE, 'utf8')); } catch {}
    all.players = Array.isArray(players) ? players : [];
    fs.writeFileSync(AUTOTPA_FILE, JSON.stringify(all, null, 2));
    console.log('[AutoTPA] saved shared players=' + JSON.stringify(all.players));
}

// ── Microsoft account creation ────────────────────────────────────────────────
ipcMain.handle('create-microsoft-account', async (event, username) => {
    if (!username) return { success: false, error: 'No username provided' };

    try {
        const authCacheDir = path.join(TOKENS_DIR, username);

        // Back up existing token and authflow so they can be restored if the
        // new auth attempt fails — tokens are never auto-deleted on failure.
        const previousToken    = core.storedTokens[username] ?? null;
        const previousAuthflow = core.authflows.get(username) ?? null;

        // Wipe the existing cache dir and live authflow before authenticating.
        // This forces prismarine-auth to start a fresh device-code flow instead
        // of silently reusing cached Microsoft/XSTS tokens.
        core.authflows.delete(username);
        if (fs.existsSync(authCacheDir)) {
            try { fs.rmSync(authCacheDir, { recursive: true, force: true }); } catch {}
        }
        fs.mkdirSync(authCacheDir, { recursive: true });

        let auth;
        let authflow;
        try {
            authflow = new Authflow(username, authCacheDir, {
                authTitle: Titles.MinecraftJava,
                flow: 'sisu',
                deviceType: 'Win32',
            });
            auth = await authflow.getMinecraftJavaToken({ fetchProfile: true });
        } catch (authErr) {
            // Auth failed — restore the previous token and authflow so the
            // account remains usable and is not lost.
            if (previousToken) {
                core.storedTokens[username] = previousToken;
                // No need to re-save to disk; the encrypted file was never modified.
            }
            if (previousAuthflow) {
                core.authflows.set(username, previousAuthflow);
            }
            throw authErr; // re-throw so the outer catch returns the error to the UI
        }

        core.storedTokens[username] = {
            token:     auth.token,
            profile:   auth.profile,
            expiresAt: Date.now() + 50 * 60 * 1000,  // 50 min — MS tokens live ~1h
        };
        core.saveStoredTokens();
        // Keep the live Authflow instance so botConnection can reuse it.
        // Reusing the same instance preserves the EC key pair that is bound
        // to the cached XSTS token — creating a new instance would generate a
        // different key pair, invalidating the cache and forcing a device-code
        // prompt on every connect.
        core.authflows.set(username, authflow);

        const accountData = {
            username:          auth.profile.name,
            uuid:              auth.profile.id,
            identifier:        username,
            lastAuthenticated: new Date().toISOString(),
        };

        const idx = core.authenticatedAccounts.findIndex(a => a.username === auth.profile.name);
        if (idx >= 0) core.authenticatedAccounts[idx] = accountData;
        else          core.authenticatedAccounts.push(accountData);
        core.saveAuthenticatedAccounts();

        return { success: true, username: auth.profile.name, uuid: auth.profile.id };
    } catch (err) {
        return { success: false, error: err.message || err.toString() };
    }
});

// ── Account list ──────────────────────────────────────────────────────────────
ipcMain.handle('get-authenticated-accounts', () => {
    return Object.entries(core.storedTokens)
        .filter(([, data]) => data && data.profile)   // skip malformed entries
        .map(([identifier, data]) => ({
            identifier,
            username:      data.profile.name  ?? identifier,
            uuid:          data.profile.id    ?? '',
            hasValidToken: data.expiresAt > Date.now(),
            lastModified:  data.expiresAt,
        }));
});

// ── Bot CRUD ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-bots', () =>
    core.bots.map((b, i) => ({
        ...b,
        id:     i,
        status: core.activeBots.has(i) ? 'online' : 'offline',
    }))
);

ipcMain.handle('create-bot', async (event, botData) => {
    if (!core.storedTokens[botData.accountIdentifier]) {
        return { success: false, error: `No auth found for "${botData.accountIdentifier}"` };
    }
    const entry = {
        name:              botData.name,
        accountIdentifier: botData.accountIdentifier,
        server:            botData.server,
        port:              botData.port,
        createdAt:         new Date().toISOString(),
    };
    core.bots.push(entry);
    core.saveBots();
    core.mainWindow?.webContents.send('bot-added', entry);
    return { success: true, bot: entry };
});

ipcMain.handle('update-account', async (event, botId, updates) => {
    if (botId < 0 || botId >= core.bots.length) return { success: false, error: 'Invalid bot ID' };
    core.bots[botId] = { ...core.bots[botId], ...updates };
    core.saveBots();
    return { success: true, bot: core.bots[botId] };
});

ipcMain.handle('delete-account', (event, identifier) => {
    // Disconnect and clean up any bots that use this account
    core.bots.forEach((bot, botId) => {
        if (bot.accountIdentifier === identifier && core.activeBots.has(botId)) {
            try { core.activeBots.get(botId).quit(); } catch {}
            core.cleanupBot(botId);
            core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
        }
    });

    // Remove from in-memory accounts list
    const index = core.authenticatedAccounts.findIndex(acc => acc.identifier === identifier);
    if (index !== -1) {
        core.authenticatedAccounts.splice(index, 1);
        core.saveAuthenticatedAccounts();
    }

    // Remove cached token (encrypted store)
    if (core.storedTokens[identifier]) {
        delete core.storedTokens[identifier];
        core.saveStoredTokens();
    }

    // Remove live authflow instance so it can't be reused
    core.authflows.delete(identifier);

    // Delete the prismarine-auth cache directory from disk so the MS token
    // is fully wiped and a fresh device-code auth is required next time.
    try {
        const cacheDir = path.join(TOKENS_DIR, identifier);
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn('[delete-account] Could not remove auth cache dir:', e.message);
    }

    return { success: true, identifier };
});

ipcMain.handle('delete-bot', (event, botId) => {
    if (botId < 0 || botId >= core.bots.length) return { success: false, error: 'Bot not found' };
    const botConfig = core.bots[botId];
    if (core.activeBots.has(botId)) {
        try { core.activeBots.get(botId).quit(); } catch {}
        core.cleanupBot(botId);
    }
    core.bots.splice(botId, 1);
    core.saveBots();
    return { success: true, bot: botConfig };
});

// ── Connection ────────────────────────────────────────────────────────────────
ipcMain.handle('connect-bot', async (event, botId) => {
    if (core.activeBots.has(botId)) return { success: false, error: 'Already connected' };
    // Clear any pending cancel flag so reconnect works normally after a manual connect
    core.reconnectCancelled.delete(botId);
    core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'connecting' });
    await createBotConnection(botId);
    return { success: true };
});

ipcMain.handle('disconnect-bot', async (event, botId) => {
    // Always set the cancel flag first so any queued scheduleReconnect setTimeout
    // bails out immediately — even if the bot is currently in a reconnect loop
    // (status = 'reconnecting') rather than fully connected.
    core.reconnectCancelled.add(botId);

    if (!core.activeBots.has(botId)) {
        // Bot may be in a reconnect-wait loop (not connected but pending).
        // The cancel flag above is enough — log and report success.
        core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
        core.sendLog(botId, 'info', 'Reconnect loop cancelled');
        return { success: true };
    }
    try {
        core.activeBots.get(botId).quit();
        core.cleanupBot(botId);
        core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
        core.sendLog(botId, 'info', 'Disconnected');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ── Auto-TPA settings ─────────────────────────────────────────────────────────
// `enabled` is runtime-only (not persisted). Only the players whitelist is saved to disk.
ipcMain.handle('get-auto-tpa', (event, botId) => {
    const state   = core.botStates.get(botId);
    // If the bot has live state, use it. If not yet connected, default enabled=true
    // so the UI shows the correct default before first connection.
    const enabled = state ? (state?.autoTpa?.enabled === true) : true;
    // Always read players from live state if available, otherwise fall back to disk
    const players = state?.autoTpa?.players ?? loadAutoTpaPlayersForBot(botId);
    const result  = { enabled, players };
    console.log('[AutoTPA] get-auto-tpa botId=' + botId + ' returning=' + JSON.stringify(result));
    return result;
});

ipcMain.handle('set-auto-tpa', (event, botId, settings) => {
    console.log('[AutoTPA] set-auto-tpa called botId=' + botId + ' raw settings=' + JSON.stringify(settings));
    const enabledBool = (settings.enabled === true || settings.enabled === 'true' || settings.enabled === 1);
    const players     = Array.isArray(settings.players) ? settings.players : [];

    // Persist ONLY the players list — enabled is intentionally excluded
    saveAutoTpaPlayersForBot(botId, players);

    // Sync both into live state if bot is connected
    const state = core.botStates.get(botId);
    if (state) state.autoTpa = { enabled: enabledBool, players };
    console.log('[AutoTPA] in-memory state=' + JSON.stringify(state?.autoTpa));
    return { success: true };
});

// set-auto-tpa-enabled: toggle only — never overwrites the players list
ipcMain.handle('set-auto-tpa-enabled', (event, botId, enabled) => {
    const enabledBool = (enabled === true || enabled === 'true' || enabled === 1);
    const state = core.botStates.get(botId);
    if (state) {
        // Preserve existing players, only flip enabled
        state.autoTpa = { enabled: enabledBool, players: state.autoTpa?.players ?? loadAutoTpaPlayersForBot(botId) };
    }
    console.log('[AutoTPA] set-enabled botId=' + botId + ' enabled=' + enabledBool + ' players=' + JSON.stringify(state?.autoTpa?.players));
    return { success: true };
});


// ── Reconnect settings ────────────────────────────────────────────────────────
ipcMain.handle('set-reconnect-settings', (_event, settings) => {
    const rs = core.reconnectSettings;
    rs.enabled  = settings.enabled  !== undefined ? !!settings.enabled  : rs.enabled;
    rs.delayMs  = settings.delayMs  !== undefined ? Math.max(500, +settings.delayMs)  : rs.delayMs;
    rs.maxTries = settings.maxTries !== undefined ? Math.max(0,   +settings.maxTries) : rs.maxTries;
    return { success: true };
});

ipcMain.handle('set-bot-behaviour-settings', (_event, settings) => {
    const bs = core.botBehaviourSettings;
    if (settings.autorespawn      !== undefined) bs.autorespawn      = !!settings.autorespawn;
    if (settings.antiafk          !== undefined) bs.antiafk          = !!settings.antiafk;
    if (settings.antiafkInterval  !== undefined) bs.antiafkInterval  = Math.max(5000, +settings.antiafkInterval);
    if (settings.autoeat          !== undefined) bs.autoeat          = !!settings.autoeat;
    if (settings.autoeatThreshold !== undefined) bs.autoeatThreshold = Math.min(19, Math.max(1, +settings.autoeatThreshold));
    if (settings.healthDisconnect !== undefined) bs.healthDisconnect = Math.min(19, Math.max(0, +settings.healthDisconnect));
    if (settings.mcVersion        !== undefined) bs.mcVersion        = String(settings.mcVersion);
    return { success: true };
});

ipcMain.handle('send-chat', async (event, botId, message) => {
    const botInstance = core.activeBots.get(botId);
    if (!botInstance) return { success: false, error: 'Bot not connected' };
    if (typeof botInstance._client?.chat !== 'function')
        return { success: false, error: 'Bot is still connecting — please wait' };
    const state = core.botStates.get(botId);
    if (!state?.chatReady)
        return { success: false, error: 'Chat session not ready yet — please wait a moment' };
    try {
        botInstance.chat(message);
        core.sendLog(botId, 'command', `<${botInstance.username}> ${message}`);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});