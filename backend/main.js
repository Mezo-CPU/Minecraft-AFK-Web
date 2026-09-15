// main.js - Entry point & server lifecycle
'use strict';

const { ipcMain } = require('./electron-shim');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Local data directory ───────────────────────────────────────────────────
// Tries the app folder first; falls back to /tmp if it isn't writable.
// NOTE: on most free-tier container platforms /tmp (and often the whole
// filesystem) is EPHEMERAL — wiped on every redeploy/restart. That means
// accounts.json, bots.json, tokens.enc, the auth-cache, and autotpa.json
// won't survive a restart unless hostless.net gives you a persistent volume
// to mount and point DATA_DIR at. Check their docs for "persistent storage"
// / "volumes" if this data needs to survive restarts.
function resolveDataDir() {
    const candidates = [path.join(__dirname, 'data'), '/tmp/mc-backend-data'];
    for (const dir of candidates) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            const probe = path.join(dir, '.write-test');
            fs.writeFileSync(probe, 'ok');
            fs.rmSync(probe, { force: true });
            return dir;
        } catch (e) {
            console.warn(`[startup] ${dir} not writable (${e.code}), trying next...`);
        }
    }
    throw new Error('[startup] No writable data directory found — check hostless.net storage config.');
}

const DATA_DIR = resolveDataDir();
console.log('[startup] Using DATA_DIR:', DATA_DIR);

// ── File paths ────────────────────────────────────────────────────────────────
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const BOTS_FILE     = path.join(DATA_DIR, 'bots.json');
const TOKENS_FILE   = path.join(DATA_DIR, 'tokens.enc');     // .enc = encrypted

// ── Encryption helpers ────────────────────────────────────────────────────────
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
    const iv         = crypto.randomBytes(12);
    const cipher     = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const plaintext  = Buffer.from(JSON.stringify(obj), 'utf8');
    const encrypted  = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag    = cipher.getAuthTag();
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
let activeBots            = new Map();
let authflows             = new Map();
let botStates             = new Map();
let storedTokens          = {};
const reconnectCancelled  = new Set();

const reconnectSettings = {
    enabled:  true,
    delayMs:  5000,
    maxTries: 0,
};

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
    DATA_DIR,
    reconnectSettings,
    reconnectCancelled,
    botBehaviourSettings,
    sendLog,
    sendBotUpdate,
    cleanupBot,
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

        const hotbar = [];
        if (bot.inventory) {
            for (let i = 36; i <= 44; i++) {
                const item = bot.inventory.slots[i];
                hotbar.push(item ? { name: item.name, count: item.count, slot: i - 36 } : null);
            }
        }

        const inventorySlots = {};
        if (bot.inventory) {
            for (let i = 5; i <= 44; i++) {
                const item = bot.inventory.slots[i];
                inventorySlots[i] = item ? { name: item.name, count: item.count, slot: i } : null;
            }
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
			level:      bot.experience?.level ?? 0,
            xpProgress: bot.experience?.progress ?? 0,
            playerCount: Object.keys(bot.players || {}).length,
            tps:         state.tps ?? null,
        });
    } catch (err) {
        console.error('Error in sendBotUpdate:', err);
    }
}

// ── Bot cleanup ───────────────────────────────────────────────────────────────
function cleanupBot(botId) {
    const state = botStates.get(botId);
    if (state) {
        ['followInterval', 'statsInterval', 'clickInterval', 'clickIntervalLeft', 'clickIntervalRight', 'antiAfkTimer', 'tpsInterval'].forEach(k => {
            if (state[k]) { clearInterval(state[k]); state[k] = null; }
        });
    }    
	botStates.delete(botId);
    activeBots.delete(botId);
}

// ── Load sub-modules ──────────────────────────────────────────────────────────
require('./botConnection');
require('./commands');
require('./ipcHandlers');
require('./ipcHandlersPatch');
require('./excavate');

// ── Server bootstrap ──────────────────────────────────────────────────────────
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
