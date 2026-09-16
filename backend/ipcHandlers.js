// ipcHandlers.js - Account, bot management & connection IPC handlers
'use strict';

const { ipcMain } = require('./electron-shim');
const path = require('path');
const { Authflow, Titles } = require('prismarine-auth');
const fs = require('fs');

const core = require('./main');
const { createBotConnection } = require('./botConnection');

// ── Local data directory ───────────────────────────────────────────────────────
const DATA_DIR    = core.DATA_DIR;
const TOKENS_DIR  = path.join(DATA_DIR, 'auth-cache');

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

        const previousToken    = core.storedTokens[username] ?? null;
        const previousAuthflow = core.authflows.get(username) ?? null;

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
            }, (deviceCode) => {
                // Relay the device-code prompt to the dashboard's existing
                // webContents-forwarding channel (which the web UI's ms-auth-code
                // listener may not exist for), AND to sendLog, which the web
                // dashboard is already known to render live.
                //
                // NOTE: accountId is `null` here, not `username` — renderer.js's
                // onLog filter only shows a log line when
                // `data.accountId === null || data.accountId === activeBotId`.
                // This message isn't tied to any bot index, so it must be
                // `null` to pass that filter and actually render (previously
                // it used `username`, a string that never matched either
                // condition, so the line was silently dropped).
                if (core.mainWindow) {
                    core.mainWindow.webContents.send('ms-auth-code', {
                        identifier:      username,
                        userCode:        deviceCode.user_code,
                        verificationUri: deviceCode.verification_uri,
                        message:         deviceCode.message,
                        expiresIn:       deviceCode.expires_in,
                    });
                }
                core.sendLog(null, 'auth',
                    `🔑 Microsoft sign-in required for "${username}": go to ${deviceCode.verification_uri} and enter code ${deviceCode.user_code} (expires in ${Math.round((deviceCode.expires_in || 900) / 60)} min)`);
            });
            auth = await authflow.getMinecraftJavaToken({ fetchProfile: true });
        } catch (authErr) {
            if (previousToken) {
                core.storedTokens[username] = previousToken;
            }
            if (previousAuthflow) {
                core.authflows.set(username, previousAuthflow);
            }
            throw authErr;
        }

        core.storedTokens[username] = {
            token:     auth.token,
            profile:   auth.profile,
            expiresAt: Date.now() + 50 * 60 * 1000,
        };
        core.saveStoredTokens();
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
        .filter(([, data]) => data && data.profile)
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
    core.bots.forEach((bot, botId) => {
        if (bot.accountIdentifier === identifier && core.activeBots.has(botId)) {
            try { core.activeBots.get(botId).quit(); } catch {}
            core.cleanupBot(botId);
            core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
        }
    });

    const index = core.authenticatedAccounts.findIndex(acc => acc.identifier === identifier);
    if (index !== -1) {
        core.authenticatedAccounts.splice(index, 1);
        core.saveAuthenticatedAccounts();
    }

    if (core.storedTokens[identifier]) {
        delete core.storedTokens[identifier];
        core.saveStoredTokens();
    }

    core.authflows.delete(identifier);

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
    core.reconnectCancelled.delete(botId);
    core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'connecting' });
    await createBotConnection(botId);
    return { success: true };
});

ipcMain.handle('disconnect-bot', async (event, botId) => {
    core.reconnectCancelled.add(botId);

    if (!core.activeBots.has(botId)) {
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
ipcMain.handle('get-auto-tpa', (event, botId) => {
    const state   = core.botStates.get(botId);
    const enabled = state ? (state?.autoTpa?.enabled === true) : true;
    const players = state?.autoTpa?.players ?? loadAutoTpaPlayersForBot(botId);
    const result  = { enabled, players };
    console.log('[AutoTPA] get-auto-tpa botId=' + botId + ' returning=' + JSON.stringify(result));
    return result;
});

ipcMain.handle('set-auto-tpa', (event, botId, settings) => {
    console.log('[AutoTPA] set-auto-tpa called botId=' + botId + ' raw settings=' + JSON.stringify(settings));
    const enabledBool = (settings.enabled === true || settings.enabled === 'true' || settings.enabled === 1);
    const players     = Array.isArray(settings.players) ? settings.players : [];

    saveAutoTpaPlayersForBot(botId, players);

    const state = core.botStates.get(botId);
    if (state) state.autoTpa = { enabled: enabledBool, players };
    console.log('[AutoTPA] in-memory state=' + JSON.stringify(state?.autoTpa));
    return { success: true };
});

ipcMain.handle('set-auto-tpa-enabled', (event, botId, enabled) => {
    const enabledBool = (enabled === true || enabled === 'true' || enabled === 1);
    const state = core.botStates.get(botId);
    if (state) {
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
