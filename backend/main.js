// main.js - Entry point & server lifecycle
// (Originally the Electron main process. Converted to a plain Node.js
// WebSocket server — see ws-bridge.js for the transport layer that replaces
// Electron IPC. Everything below this point — encryption, persistence,
// bot/account state, sendLog/sendBotUpdate/cleanupBot — is unchanged.)
'use strict';

const { ipcMain } = require('./electron-shim');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Local data directory (inside the app folder) ──────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── File paths ────────────────────────────────────────────────────────────────
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const BOTS_FILE     = path.join(DATA_DIR, 'bots.json');
const TOKENS_FILE   = path.join(DATA_DIR, 'tokens.enc');     // .enc = encrypted

// ── Encryption helpers ────────────────────────────────────────────────────────
// Key is derived from a stable machine+app-specific secret stored alongside
// the data. On first run the secret is randomly generated and saved.
const KEY_FILE = path.join(DATA_DIR, '.secret');

function loadOrCreateSecret() {
    if (fs.existsSync(KEY_FILE)) {
        return fs.readFileSync(KEY_FILE);   // 32 raw bytes
    }
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, secret, { mode: 0o600 });
    return secret;
}

const ENC_KEY = loadOrCreateSecret();   // 256-bit AES key

function encryptJSON(obj) {
    const iv         = crypto.randomBytes(12);                       // 96-bit IV for GCM
    const cipher     = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const plaintext  = Buffer.from(JSON.stringify(obj), 'utf8');
    const encrypted  = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag    = cipher.getAuthTag();                          // 16-byte GCM tag
    // Layout: [4-byte iv-len][iv][4-byte tag-len][authTag][ciphertext]
    const ivLen  = Buffer.allocUnsafe(4); ivLen.writeUInt32BE(iv.length);
    const tagLen = Buffer.allocUnsafe(4); tagLen.writeUInt32BE(authTag.length);
    return Buffer.concat([ivLen, iv, tagLen, authTag, encrypted]);
}

function decryptJSON(buf) {
    let offset = 0;
    const ivLen    = buf.readUInt32BE(offset); offset += 4;
    const iv       = buf.slice(offset, offset + ivLen); offset += ivLen;
    const tagLen   = buf.readUInt32BE(offset); offset += 4;
    const authTag  = buf.slice(offset, offset + tagLen); offset += tagLen;
    const ciphertext = buf.slice(offset);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
}

// ── Shared state (exported for sub-modules) ───────────────────────────────────
let mainWindow            = null;
let authenticatedAccounts = [];
let bots                  = [];
let activeBots            = new Map();   // botId -> mineflayer bot instance
let authflows             = new Map();   // accountIdentifier -> Authflow instance
let botStates             = new Map();   // botId -> state object
let storedTokens          = {};
// Set of botIds for which auto-reconnect has been manually cancelled.
// scheduleReconnect checks this before each attempt and clears it on success.
const reconnectCancelled  = new Set();

// Reconnect settings — pushed from renderer via 'set-reconnect-settings' IPC
const reconnectSettings = {
    enabled:  true,
    delayMs:  5000,
    maxTries: 0,    // 0 = unlimited
};

// Bot behaviour settings — pushed from renderer via 'set-bot-behaviour-settings' IPC
const botBehaviourSettings = {
    autorespawn:      false,
    antiafk:          false,
    antiafkInterval:  30000,
    autoeat:          false,
    autoeatThreshold: 14,
    healthDisconnect: 0,
    mcVersion:        '1.21.1',
};

module.exports = {
    get mainWindow()            { return mainWindow; },
    get bots()                  { return bots; },
    get activeBots()            { return activeBots; },
    get authflows()             { return authflows; },
    get botStates()             { return botStates; },
    get storedTokens()          { return storedTokens; },
    get authenticatedAccounts() { return authenticatedAccounts; },
    reconnectSettings,
    reconnectCancelled,
    botBehaviourSettings,
    sendLog,
    sendBotUpdate,
    cleanupBot,
    // Save helpers are set as real functions after their definitions below,
    // so we forward them via wrapper to avoid the temporal dead zone.
    saveStoredTokens:          (...a) => saveStoredTokens(...a),
    saveAuthenticatedAccounts: (...a) => saveAuthenticatedAccounts(...a),
    saveBots:                  (...a) => saveBots(...a),
};

// ── Persistence helpers ───────────────────────────────────────────────────────
function loadStoredTokens() {
    if (fs.existsSync(TOKENS_FILE)) {
        try {
            const buf = fs.readFileSync(TOKENS_FILE);
            storedTokens = decryptJSON(buf);
        } catch (err) {
            console.warn('[Tokens] Failed to decrypt tokens file — starting fresh.', err.message);
            storedTokens = {};
        }
    }
}
function saveStoredTokens() {
    fs.writeFileSync(TOKENS_FILE, encryptJSON(storedTokens), { mode: 0o600 });
}
function loadAuthenticatedAccounts() {
    if (fs.existsSync(ACCOUNTS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
            authenticatedAccounts = data.accounts || [];
        } catch { authenticatedAccounts = []; }
    }
}
function saveAuthenticatedAccounts() {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: authenticatedAccounts }, null, 2));
}
function loadBots() {
    if (fs.existsSync(BOTS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
            bots = data.bots || [];
        } catch { bots = []; }
    }
}
function saveBots() {
    fs.writeFileSync(BOTS_FILE, JSON.stringify({ bots }, null, 2));
}

// ── Logging ───────────────────────────────────────────────────────────────────
function sendLog(accountId, type, message) {
    if (mainWindow) mainWindow.webContents.send('log', { accountId, type, message });
}

// ── Bot state broadcast ───────────────────────────────────────────────────────
function sendBotUpdate(accountId) {
    if (!mainWindow || !activeBots.has(accountId)) return;
    try {
        const bot   = activeBots.get(accountId);
        const state = botStates.get(accountId) || {};

        // Hotbar slots 36-44
        const hotbar = [];
        if (bot.inventory) {
            for (let i = 36; i <= 44; i++) {
                const item = bot.inventory.slots[i];
                hotbar.push(item ? { name: item.name, count: item.count, slot: i - 36 } : null);
            }
        }

        // Full inventory slots: armor 5-8, main+hotbar 9-44, offhand 45
        const inventorySlots = {};
        if (bot.inventory) {
            for (let i = 5; i <= 44; i++) {
                const item = bot.inventory.slots[i];
                inventorySlots[i] = item ? { name: item.name, count: item.count, slot: i } : null;
            }
            // offhand
            const offhand = bot.inventory.slots[45];
            inventorySlots[45] = offhand ? { name: offhand.name, count: offhand.count, slot: 45 } : null;
        }

        const uptime = state.connectTime
            ? Math.floor((Date.now() - state.connectTime) / 1000) : 0;

        let ping = 0;
        try {
            if (bot.players?.[bot.username]) ping = bot.players[bot.username].ping || 0;
        } catch { ping = 0; }

        mainWindow.webContents.send('bot-update', {
            accountId,
            username:   bot.username,
            health:     bot.health || 0,
            food:       bot.food   || 0,
            position:   bot.entity ? {
                x: Math.floor(bot.entity.position.x),
                y: Math.floor(bot.entity.position.y),
                z: Math.floor(bot.entity.position.z),
            } : null,
            yaw:        bot.entity?.yaw,
            dimension:  bot.game?.dimension || 'overworld',
            gameMode:   bot.game?.gameMode  || 'survival',
            sneaking:   state.sneaking  || false,
            following:  state.following || null,
            clicking:   state.clicking || null,
            hotbar,
            inventorySlots,
            heldItem:   bot.quickBarSlot || 0,
            ping,
            uptime,
            commandCount: state.commandCount || 0,
        });
    } catch (err) {
        console.error('Error in sendBotUpdate:', err);
    }
}

// ── Bot cleanup ───────────────────────────────────────────────────────────────
function cleanupBot(botId) {
    const state = botStates.get(botId);
    if (state) {
        ['followInterval', 'statsInterval', 'clickInterval', 'clickIntervalLeft', 'clickIntervalRight', 'antiAfkTimer'].forEach(k => {
            if (state[k]) { clearInterval(state[k]); state[k] = null; }
        });
    }
    botStates.delete(botId);
    activeBots.delete(botId);
}

// ── Load sub-modules ──────────────────────────────────────────────────────────
// (unchanged — these register their ipcMain handlers into electron-shim.js
// exactly as they registered them into real Electron ipcMain before)
require('./botConnection');
require('./commands');
require('./ipcHandlers');
require('./ipcHandlersPatch');
require('./excavate');

// ── Server bootstrap ──────────────────────────────────────────────────────────
// Replaces the old Electron BrowserWindow lifecycle. Instead of loading
// index.html into a native window, we start an HTTP+WebSocket server that the
// (separately hosted) web frontend connects to. `mainWindow` becomes a small
// adapter object whose `.webContents.send(channel, data)` broadcasts to every
// connected browser tab over WebSocket — every other file in this project
// calls that exact method (`core.mainWindow?.webContents.send(...)`) and
// needed zero changes to keep working.
const { startServer } = require('./ws-bridge');

loadStoredTokens();
loadAuthenticatedAccounts();
loadBots();

mainWindow = startServer({ ipcMain });

function shutdown() {
    console.log('\n[Server] Shutting down — disconnecting bots...');
    activeBots.forEach(bot => { try { bot.quit(); } catch {} });
    botStates.forEach(state => {
        ['followInterval', 'statsInterval', 'clickInterval', 'clickIntervalLeft', 'clickIntervalRight', 'antiAfkTimer'].forEach(k => {
            if (state[k]) clearInterval(state[k]);
        });
    });
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);