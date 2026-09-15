// botConnection.js - Bot creation, event wiring, and movement helpers
'use strict';

const mineflayer = require('mineflayer');
const path       = require('path');
const { Authflow, Titles } = require('prismarine-auth');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const core = require('./main');

// ── Create a bot connection ───────────────────────────────────────────────────
async function createBotConnection(botId) {
    const { bots, activeBots, botStates, sendLog, sendBotUpdate, cleanupBot } = core;

    const botConfig = bots[botId];
    if (!botConfig) return null;
    if (activeBots.has(botId)) return null;

    const tokenData    = core.storedTokens[botConfig.accountIdentifier];
    if (!tokenData) {
        sendLog(botId, 'error', `No tokens found for "${botConfig.accountIdentifier}"`);
        return null;
    }

    // ── Auth: reuse the single persistent Authflow instance ──────────────────
    const _fs         = require('fs');
    // Uses the same resolved writable data directory main.js falls back to
    // (app folder if writable, otherwise /tmp) — was previously hardcoded to
    // __dirname/data, which broke on hosts where /app isn't writable.
    const _TOKENS_DIR = path.join(core.DATA_DIR, 'auth-cache');

    const authCacheDir       = path.join(_TOKENS_DIR, botConfig.accountIdentifier);
    const identifier         = botConfig.accountIdentifier;
    const TOKEN_REFRESH_SKEW = 5 * 60 * 1000;

    // Ensure the cache directory always exists so prismarine-auth can write to it.
    _fs.mkdirSync(authCacheDir, { recursive: true });

    let liveAuthflow = core.authflows.get(identifier);

    if (!liveAuthflow) {
        sendLog(botId, 'info', '🔄 Restoring auth session from cache...');
        try {
            liveAuthflow = new Authflow(identifier, authCacheDir, {
                authTitle:  Titles.MinecraftJava,
                flow:       'sisu',
                deviceType: 'Win32',
            });
            const auth = await liveAuthflow.getMinecraftJavaToken({ fetchProfile: true });
            core.storedTokens[identifier] = {
                token:     auth.token,
                profile:   auth.profile,
                expiresAt: Date.now() + 50 * 60 * 1000,
            };
            core.saveStoredTokens();
            core.authflows.set(identifier, liveAuthflow);
            sendLog(botId, 'success', '✓ Auth session restored');
        } catch (err) {
            sendLog(botId, 'error', `❌ Failed to restore auth session: ${err.message}`);
            sendLog(botId, 'warning', '🔑 Please re-authenticate via the + button → Add Microsoft Account.');
            return null;
        }
    } else {
        const needsRefresh = !tokenData.expiresAt ||
            (Date.now() + TOKEN_REFRESH_SKEW) > tokenData.expiresAt;
        if (needsRefresh) {
            sendLog(botId, 'info', '🔄 Refreshing token...');
            try {
                const auth = await liveAuthflow.getMinecraftJavaToken({ fetchProfile: true });
                core.storedTokens[identifier] = {
                    token:     auth.token,
                    profile:   auth.profile,
                    expiresAt: Date.now() + 50 * 60 * 1000,
                };
                core.saveStoredTokens();
                sendLog(botId, 'success', '✓ Token refreshed');
            } catch (err) {
                sendLog(botId, 'error', `Failed to refresh token: ${err.message}`);
            }
        }
    }

    const finalToken = core.storedTokens[identifier];
    sendLog(botId, 'info', `🔑 Connecting as "${finalToken.profile?.name ?? identifier}"...`);

    try {
        const mcVersion = core.botBehaviourSettings?.mcVersion || '1.21.1';
        const botInstance = mineflayer.createBot({
            host:            botConfig.server,
            port:            parseInt(botConfig.port) || 25565,
            username:        finalToken.profile.name,
            auth:            'microsoft',
            version:         mcVersion,
            connectTimeout:  30000,
            chatLengthLimit: 256,
            authflow:        liveAuthflow,
        });

        botInstance.botId             = botId;
        botInstance.accountIdentifier = botConfig.accountIdentifier;
        botInstance.loadPlugin(pathfinder);

botStates.set(botId, {
    sneaking:            false,
    following:           null,
    followInterval:      null,
    clicking:            null,
    clickInterval:       null,
    clickIntervalLeft:   null,
    clickIntervalRight:  null,
    clickTokenLeft:      null,
    clickTokenRight:     null,
    connectTime:         Date.now(),
    commandCount:        0,
    statsInterval:       null,
    tpsInterval:         null,
    tps:                 null,
    tpsSource:           null,
    tpsPlugin:           null,
    tpsPluginTime:       0,
    tpsEstimated:        null,
    mspt:                null,
    _tpsSamples:         [],
    _lastTickAge:        null,
    _lastTickWall:       null,
    chatReady:            false,
});

        botInstance._client.on('update_time', (packet) => {
            const state = botStates.get(botId);
            if (!state) return;

            let age = packet.age;
            if (typeof age === 'bigint') age = Number(age);
            else if (age && typeof age === 'object' && 'low' in age) age = age.low >>> 0;
            if (typeof age !== 'number' || !Number.isFinite(age)) return;

            const now = Date.now();

            if (state._lastTickAge != null && state._lastTickWall != null) {
                const deltaAge  = age - state._lastTickAge;
                const deltaWall = now - state._lastTickWall;

                if (deltaAge > 0 && deltaWall > 0) {
                    const instantTps = Math.min(20, (deltaAge / deltaWall) * 1000);

                    state._tpsSamples.push(instantTps);
                    if (state._tpsSamples.length > 12) state._tpsSamples.shift();

                    const avg = state._tpsSamples.reduce((a, b) => a + b, 0) / state._tpsSamples.length;
                    state.tpsEstimated = Math.round(avg * 100) / 100;
                    state.mspt         = Math.round((deltaWall / deltaAge) * 100) / 100;

                    const pluginFresh = state.tpsPlugin != null && (now - state.tpsPluginTime) < 15000;
                    if (pluginFresh) {
                        state.tps       = state.tpsPlugin;
                        state.tpsSource = 'plugin';
                    } else {
                        state.tps       = state.tpsEstimated;
                        state.tpsSource = 'estimated';
                    }
                }
            }

            state._lastTickAge  = age;
            state._lastTickWall = now;
        });

        botInstance._client.on('session', () => {
            if (core.activeBots.get(botId) !== botInstance) return;
            const state = botStates.get(botId);
            if (state) state.chatReady = true;
            sendLog(botId, 'info', 'Chat session ready');
        });

        botInstance._client.on('login', () => {
            if (core.activeBots.get(botId) !== botInstance) return;
            const state = botStates.get(botId);
            if (state) {
                state.chatReady = false;
                state._tpaRequester = null;
                state._tpaTime      = null;

                state._lastTickAge  = null;
                state._lastTickWall = null;
                state._tpsSamples   = [];

                if (state._clickerRestoreTimer) {
                    clearTimeout(state._clickerRestoreTimer);
                    state._clickerRestoreTimer = null;
                }
                const restoreLeft  = state.clicking?.left  ? { ...state.clicking.left }  : null;
                const restoreRight = state.clicking?.right ? { ...state.clicking.right } : null;
                if (restoreLeft || restoreRight) {
                    core._pendingClickerRestore = core._pendingClickerRestore || {};
                    core._pendingClickerRestore[botId] = { left: restoreLeft, right: restoreRight };
                }
                if (state.clickIntervalLeft)  { clearInterval(state.clickIntervalLeft);  state.clickIntervalLeft  = null; state.clickTokenLeft  = null; }
                if (state.clickIntervalRight) { clearInterval(state.clickIntervalRight); state.clickIntervalRight = null; state.clickTokenRight = null; }
                if (state.clickInterval)      { clearInterval(state.clickInterval);      state.clickInterval      = null; }
                try { botInstance.setControlState('attack', false); } catch {}
                try { botInstance.setControlState('use',    false); } catch {}

                sendLog(botId, 'info', 'Server transfer detected — waiting for new chat session...');
                setTimeout(() => {
                    if (core.activeBots.get(botId) !== botInstance) return;
                    const s = botStates.get(botId);
                    if (s && !s.chatReady) {
                        s.chatReady = true;
                        sendLog(botId, 'info', 'Chat session ready (transfer fallback)');
                    }
                }, 4000);
            }
        });

        botInstance.on('spawn', () => {
            if (core.activeBots.get(botId) !== botInstance) return;
            const state = botStates.get(botId);
            if (state && !state.chatReady) {
                setTimeout(() => {
                    if (core.activeBots.get(botId) !== botInstance) return;
                    const s = botStates.get(botId);
                    if (s && !s.chatReady) {
                        s.chatReady = true;
                        sendLog(botId, 'info', 'Chat session ready (spawn fallback)');
                    }
                }, 3000);
            }
        });

        // ── Event handlers ────────────────────────────────────────────────────
        botInstance.on('login', () => {
            sendLog(botId, 'success', `Logged in as ${botInstance.username}`);
            core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'online' });

            const state = botStates.get(botId);
            if (state) {
                // Restore persisted Auto-TPA player whitelist.
                try {
                    // Same DATA_DIR fix as the auth-cache path above.
                    const _autoTpaFile = path.join(core.DATA_DIR, 'autotpa.json');
                    const _raw   = require('fs').readFileSync(_autoTpaFile, 'utf8');
                    const _all   = JSON.parse(_raw);
                    const _players = Array.isArray(_all.players) ? _all.players : [];
                    state.autoTpa = { enabled: true, players: _players };
                    console.log('[AutoTPA] login botId=' + botId + ' players=' + JSON.stringify(_players));
                    sendLog(botId, 'info', `[Auto-TPA] Loaded whitelist: ${_players.length ? _players.join(', ') : '(empty — will accept nobody)'} — toggle is ON`);
                } catch (e) {
                    state.autoTpa = { enabled: true, players: [] };
                    sendLog(botId, 'info', '[Auto-TPA] No saved whitelist — starting enabled (empty whitelist, nobody accepted)');
                }

                state.statsInterval = setInterval(() => {
                if (activeBots.has(botId)) sendBotUpdate(botId);
               }, 2000);

                const pending = core._pendingClickerRestore?.[botId];
                if (pending) {
                    delete core._pendingClickerRestore[botId];
                    state._clickerRestoreTimer = setTimeout(() => {
                        state._clickerRestoreTimer = null;
                        if (core.activeBots.get(botId) !== botInstance) return;
                        const rearmClicker = (side, cfg) => {
                            if (!cfg) return;
                            const { ipcMain } = require('./electron-shim');
                            const cmd = `click ${side} ${cfg.ticks}${cfg.hold ? ' hold' : ''}`;
                            sendLog(botId, 'info', `[Clicker] Restoring ${side} clicker (${cfg.ticks} ticks${cfg.hold ? ', hold' : ''})`);
                            ipcMain.emit('execute-command', null, botId, cmd);
                        };
                        if (pending.left)  rearmClicker('left',  pending.left);
                        if (pending.right) rearmClicker('right', pending.right);
                    }, 5000);
                }
            }

            sendBotUpdate(botId);
        });

        botInstance.on('spawn',           () => sendBotUpdate(botId));
        botInstance.on('health',          () => sendBotUpdate(botId));
        botInstance.on('heldItemChanged', () => sendBotUpdate(botId));
        botInstance.on('inventoryUpdate', () => sendBotUpdate(botId));

        botInstance.on('entitySpawn', entity => {
            if (entity.type === 'player' && entity.username !== botInstance.username) {
                core.mainWindow?.webContents.send('player-enter-range', {
                    accountId: botId,
                    playerName: entity.username,
                });
            }
        });

        botInstance.on('death', () => {
            sendLog(botId, 'warning', '💀 Bot died!');
            core.mainWindow?.webContents.send('bot-death', { accountId: botId });
            const _bs = core.botBehaviourSettings;
            if (_bs?.autorespawn) {
                setTimeout(() => { try { botInstance.respawn(); } catch {} }, 1200);
            }
        });

        // ── Anti-AFK ──────────────────────────────────────────────────────────
        {
            const _state = botStates.get(botId);
            if (_state) _state.antiAfkTimer = null;
            const _startAntiAfk = () => {
                const st = botStates.get(botId);
                const bs = core.botBehaviourSettings;
                if (!st || !bs?.antiafk) return;
                if (st.antiAfkTimer) return;
                const interval = bs.antiafkInterval || 30000;
                st.antiAfkTimer = setInterval(() => {
                    const bs2 = core.botBehaviourSettings;
                    if (!bs2?.antiafk || !activeBots.has(botId)) {
                        const s2 = botStates.get(botId);
                        if (s2?.antiAfkTimer) { clearInterval(s2.antiAfkTimer); s2.antiAfkTimer = null; }
                        return;
                    }
                    try {
                        botInstance.setControlState('sneak', true);
                        setTimeout(() => { try { botInstance.setControlState('sneak', false); } catch {} }, 80);
                    } catch {}
                }, interval);
            };
            botInstance.once('spawn', _startAntiAfk);
        }

        // ── Auto-Eat ──────────────────────────────────────────────────────────
        let _autoEatBusy = false;
        botInstance.on('health', () => {
            const bs = core.botBehaviourSettings;
            if (!bs?.autoeat) return;
            if (_autoEatBusy) return;
            const threshold = bs.autoeatThreshold ?? 14;
            if (botInstance.food > threshold) return;
            const slots = botInstance.inventory?.slots || [];
            const registry = botInstance.registry;
            const isFoodItem = (item) => {
                if (!item) return false;
                const def = registry?.itemsByName?.[item.name] ?? registry?.itemsByName?.[item.name.replace('minecraft:', '')];
                if (def) {
                    if (def.foodPoints !== undefined || def.food !== undefined || def.saturation !== undefined) return true;
                }
                const name = (item.name || '').toLowerCase().replace('minecraft:', '');
                const foodNames = [
                    'bread','apple','beef','porkchop','chicken','mutton','rabbit','salmon',
                    'cod','tropical_fish','carrot','potato','baked_potato','beetroot',
                    'melon_slice','sweet_berries','glow_berries','cookie','cake','pie',
                    'golden_apple','enchanted_golden_apple','golden_carrot','chorus_fruit',
                    'dried_kelp','mushroom_stew','rabbit_stew','beetroot_soup','suspicious_stew',
                    'pumpkin_pie','cooked_beef','cooked_porkchop','cooked_chicken',
                    'cooked_mutton','cooked_rabbit','cooked_salmon','cooked_cod',
                    'spider_eye','rotten_flesh','poisonous_potato','pufferfish',
                ];
                return foodNames.some(f => name.includes(f));
            };
            for (let i = 36; i <= 44; i++) {
                const item = slots[i];
                if (!isFoodItem(item)) continue;
                const hotbarSlot = i - 36;
                _autoEatBusy = true;
                try {
                    botInstance.setQuickBarSlot(hotbarSlot);
                    setTimeout(() => {
                        try { botInstance.consume(); } catch {}
                        setTimeout(() => { _autoEatBusy = false; }, 1800);
                    }, 200);
                } catch {
                    _autoEatBusy = false;
                }
                break;
            }
        });

        // ── Health Disconnect ─────────────────────────────────────────────────
        botInstance.on('health', () => {
            const bs = core.botBehaviourSettings;
            if (!bs?.healthDisconnect || bs.healthDisconnect <= 0) return;
            if ((botInstance.health || 20) <= bs.healthDisconnect) {
                sendLog(botId, 'warning', `⚠️ Health at ${Math.round(botInstance.health || 0)} — disconnecting per settings`);
                try { botInstance.quit(); } catch {}
            }
        });

        botInstance.on('entityDead', entity => {
            if (!entity) return;
            try { entity.health = 0; } catch {}
            try { delete botInstance.entities[entity.id]; } catch {}
        });

        botInstance.on('entityGone', entity => {
            // no-op — entityDead above already handled cleanup
        });

        botInstance.on('windowOpen', openedWindow => {
            try {
                const buildAndSend = () => {
                    const slots = {};
                    for (let i = 0; i < openedWindow.slots.length; i++) {
                        const item = openedWindow.slots[i];
                        slots[i] = item ? { name: item.name, count: item.count, slot: i } : null;
                    }
                    core.mainWindow?.webContents.send('container-open', {
                        accountId: botId,
                        title:     openedWindow.title,
                        slotCount: openedWindow.slots.length,
                        slots,
                    });
                };

                buildAndSend();
                sendLog(botId, 'info', `Container opened | slotCount=${openedWindow.slots.length} | type=${openedWindow.type}`);

                const onWindowUpdate = (win) => { if (win === openedWindow) buildAndSend(); };
                botInstance.on('windowUpdate', onWindowUpdate);
                botInstance.once('windowClose', () => botInstance.removeListener('windowUpdate', onWindowUpdate));

            } catch (err) {
                sendLog(botId, 'error', `windowOpen error: ${err.message}`);
            }
        });

        botInstance.on('windowClose', () => {
            core.mainWindow?.webContents.send('container-close', { accountId: botId });
        });

        // ── Chat receiving ────────────────────────────────────────────────────
function handleChatText(text) {
    sendLog(botId, 'chat', text);

    const state = botStates.get(botId);

    const tpsMatch = /TPS[^0-9]*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
    if (tpsMatch && state) {
        state.tpsPlugin     = parseFloat(tpsMatch[1]);
        state.tpsPluginTime = Date.now();
        state.tps           = state.tpsPlugin;
        state.tpsSource      = 'plugin';
    }

    // ── Auto-TPA ──────────────────────────────────────────────────────
    if (state?.autoTpa?.enabled) {
        const reqMatch = /([A-Za-z0-9_]{1,16}) has requested/.exec(text);
        if (reqMatch) {
            state._tpaRequester = reqMatch[1];
            state._tpaTime      = Date.now();
            sendLog(botId, 'info', `[Auto-TPA] Cached requester: ${reqMatch[1]}`);
        }

        if (/tpaccept/.test(text) && state._tpaRequester && (Date.now() - (state._tpaTime || 0)) < 8000) {
            const requester = state._tpaRequester;
            const players   = state.autoTpa.players || [];
            const allowed   = players.length > 0 && players.some(p => p.toLowerCase() === requester.toLowerCase());
            sendLog(botId, 'info', `[Auto-TPA] Prompt detected — requester=${requester} allowed=${allowed} whitelist=${JSON.stringify(players)}`);
            if (allowed) {
                state._tpaRequester = null;
                state._tpaTime      = null;
                setTimeout(() => {
                    try {
                        if (!state.chatReady) {
                            sendLog(botId, 'warning', '[Auto-TPA] Chat not ready yet — skipping tpaccept');
                            return;
                        }
                        botInstance.chat('/tpaccept');
                        sendLog(botId, 'success', `[Auto-TPA] Accepted teleport from ${requester}`);
                    } catch (err) {
                        sendLog(botId, 'error', `[Auto-TPA] Failed: ${err.message}`);
                    }
                }, 500);
            } else {
                sendLog(botId, 'info', `[Auto-TPA] Denied teleport from ${requester} (not in whitelist)`);
                    state._tpaRequester = null;
                        state._tpaTime      = null;
                    }
                }
            }
        }

        botInstance.on('messagestr', (text) => handleChatText(text));

        function stopClickersNow() {
            const state = botStates.get(botId);
            if (!state) return;

            if (state._clickerRestoreTimer) {
                clearTimeout(state._clickerRestoreTimer);
                state._clickerRestoreTimer = null;
            }

            const restoreLeft  = state.clicking?.left  ? { ...state.clicking.left }  : null;
            const restoreRight = state.clicking?.right ? { ...state.clicking.right } : null;
            if (restoreLeft || restoreRight) {
                core._pendingClickerRestore = core._pendingClickerRestore || {};
                core._pendingClickerRestore[botId] = { left: restoreLeft, right: restoreRight };
            }

            if (state.clickIntervalLeft)  { clearInterval(state.clickIntervalLeft);  state.clickIntervalLeft  = null; state.clickTokenLeft  = null; }
            if (state.clickIntervalRight) { clearInterval(state.clickIntervalRight); state.clickIntervalRight = null; state.clickTokenRight = null; }
            if (state.clickInterval)      { clearInterval(state.clickInterval);      state.clickInterval      = null; }
            try { botInstance.setControlState('attack', false); } catch {}
            try { botInstance.setControlState('use',    false); } catch {}
        }

        // ── Reconnect helper ──────────────────────────────────────────────────
        function scheduleReconnect(attempt = 1, kickReason = '') {
            const rs = core.reconnectSettings;
            if (!rs.enabled) return;
            if (rs.maxTries > 0 && attempt > rs.maxTries) {
                sendLog(botId, 'error', `[Reconnect] Giving up after ${rs.maxTries} attempt(s)`);
                return;
            }
            if (core.reconnectCancelled.has(botId)) {
                core.reconnectCancelled.delete(botId);
                sendLog(botId, 'info', '[Reconnect] Cancelled by user — not reconnecting');
                return;
            }

            const alreadyConnected = /already connected/i.test(kickReason);
            const delayMs = alreadyConnected ? Math.max(15000, rs.delayMs * 3) : rs.delayMs;
            if (alreadyConnected) {
                sendLog(botId, 'warning', `[Reconnect] Server says "already connected" — waiting ${delayMs / 1000}s for session to clear…`);
            }

            const label = rs.maxTries > 0 ? ` (${attempt}/${rs.maxTries})` : ` (attempt ${attempt})`;
            sendLog(botId, 'info', `[Reconnect] Reconnecting in ${delayMs / 1000}s…${label}`);
            core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'reconnecting' });

            setTimeout(async () => {
                if (core.reconnectCancelled.has(botId)) {
                    core.reconnectCancelled.delete(botId);
                    sendLog(botId, 'info', '[Reconnect] Cancelled by user — not reconnecting');
                    core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
                    return;
                }
                if (core.activeBots.has(botId)) return;
                if (!core.bots[botId]) return;
                sendLog(botId, 'info', `[Reconnect] Connecting…${label}`);
                const newBot = await createBotConnection(botId);
                if (!newBot) {
                    scheduleReconnect(attempt + 1);
                }
            }, delayMs);
        }

        botInstance.on('kicked', reason => {
            if (core.activeBots.get(botId) !== botInstance) return;
            stopClickersNow();
            let reasonText;
            try {
                const parsed = typeof reason === 'string' ? JSON.parse(reason) : reason;
                function extractText(node) {
                    if (!node || typeof node !== 'object') return String(node ?? '');
                    if (node.type === 'string') return node.value ?? '';
                    if (node.type === 'byte')   return '';
                    if (node.type === 'compound') return extractText(node.value);
                    if (node.type === 'list')    return extractText(node.value);
                    let out = node.text?.value ?? node.text ?? '';
                    if (node.extra) {
                        const items = node.extra?.value?.value ?? node.extra?.value ?? node.extra ?? [];
                        const arr   = Array.isArray(items) ? items : [items];
                        out += arr.map(extractText).join('');
                    }
                    return out;
                }
                reasonText = extractText(parsed).replace(/\n/g, ' ').trim();
                if (!reasonText) reasonText = JSON.stringify(parsed);
            } catch {
                reasonText = String(reason);
            }
            sendLog(botId, 'error', `Kicked: ${reasonText}`);
            cleanupBot(botId);
            core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
            if (/profile not found/i.test(reasonText) || /does the account own minecraft/i.test(reasonText)) {
                core.authflows.delete(identifier);
                sendLog(botId, 'warning', '🔑 Auth error — the Minecraft profile could not be verified.');
                sendLog(botId, 'warning', '   → Make sure this account has logged into the official launcher at least once.');
                sendLog(botId, 'warning', '   → You can re-authenticate via + → Manage Accounts if the issue persists.');
                return;
            }
            scheduleReconnect(1, reasonText);
        });

        let _fatalAuthError = false;

        botInstance.on('error', err => {
            const msg = err.message || '';
            if (/profile not found/i.test(msg) || /does the account own minecraft/i.test(msg)) {
                _fatalAuthError = true;
                core.authflows.delete(identifier);
                sendLog(botId, 'error', `❌ Auth error: ${msg}`);
                sendLog(botId, 'warning', "🔑 The Minecraft profile could not be found on Mojang's servers.");
                sendLog(botId, 'warning', '   → Make sure this account has logged into the official launcher at least once to register its profile.');
                sendLog(botId, 'warning', '   → You can re-authenticate via + → Manage Accounts if the issue persists.');
            } else {
                sendLog(botId, 'error', msg);
            }
        });

        botInstance.on('end', () => {
            if (core.activeBots.get(botId) !== botInstance) return;
            stopClickersNow();
            sendLog(botId, 'warning', 'Disconnected');
            cleanupBot(botId);
            core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
            if (_fatalAuthError) {
                sendLog(botId, 'error', '[Reconnect] Skipping reconnect — fatal auth error, re-authentication required.');
                return;
            }
            scheduleReconnect();
        });

        activeBots.set(botId, botInstance);
        return botInstance;

    } catch (err) {
        sendLog(botId, 'error', `Connection failed: ${err.message}`);
        return null;
    }
}

// ── Follow a player ───────────────────────────────────────────────────────────
function startFollowing(botId, targetName) {
    const { activeBots, botStates, sendLog, sendBotUpdate } = core;
    const botInstance = activeBots.get(botId);
    const state       = botStates.get(botId);
    if (!botInstance || !state) return false;

    if (state.followInterval) { clearInterval(state.followInterval); state.followInterval = null; }
    stopAllMovement(botInstance);
    state.following = targetName;

    state.followInterval = setInterval(() => {
        if (!botInstance?.entity) { stopFollowing(botId); return; }

        const target = botInstance.players[targetName]?.entity;
        if (!target) {
            sendLog(botId, 'warning', `Player ${targetName} not found — stopping follow`);
            stopFollowing(botId);
            return;
        }

        const distance  = botInstance.entity.position.distanceTo(target.position);
        const targetPos = target.position;
        const botPos    = botInstance.entity.position;

        if (distance > 3) {
            const dx    = targetPos.x - botPos.x;
            const dz    = targetPos.z - botPos.z;
            const dy    = targetPos.y - botPos.y;
            const yaw   = Math.atan2(-dx, -dz);
            const pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
            botInstance.look(yaw, pitch, false);
            botInstance.setControlState('forward', true);
            botInstance.setControlState('sprint', distance > 6);
            const blockInFront = botInstance.blockAt(botPos.offset(Math.sin(yaw) * 0.5, 0, Math.cos(yaw) * 0.5));
            botInstance.setControlState('jump', (blockInFront?.boundingBox === 'block') || dy > 0.5);
        } else if (distance <= 2) {
            botInstance.setControlState('forward', false);
            botInstance.setControlState('sprint', false);
            botInstance.setControlState('jump', false);
        }
    }, 500);

    sendBotUpdate(botId);
    return true;
}

function stopFollowing(botId) {
    const { activeBots, botStates, sendBotUpdate } = core;
    const botInstance = activeBots.get(botId);
    const state       = botStates.get(botId);
    if (!botInstance || !state) return false;

    if (state.followInterval) { clearInterval(state.followInterval); state.followInterval = null; }
    state.following = null;
    stopAllMovement(botInstance);
    sendBotUpdate(botId);
    return true;
}

// ── Helper ────────────────────────────────────────────────────────────────────
function stopAllMovement(botInstance) {
    ['forward', 'back', 'left', 'right', 'jump', 'sprint'].forEach(ctrl => {
        try { botInstance.setControlState(ctrl, false); } catch {}
    });
}

module.exports = { createBotConnection, startFollowing, stopFollowing };
