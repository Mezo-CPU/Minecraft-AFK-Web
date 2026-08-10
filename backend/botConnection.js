// botConnection.js - Bot creation, event wiring, and movement helpers
'use strict';

const mineflayer = require('mineflayer');
const path       = require('path');
// (electron 'app' import removed — was unused in this file anyway)
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
    // prismarine-auth generates a new EC key pair on every new Authflow() call.
    // The XSTS token in the cache dir is bound to that key pair, so creating a
    // second instance with the same cache dir produces a mismatched key and forces
    // a full device-code re-auth. Fix: create Authflow once (in ipcHandlers) and
    // reuse the same instance here. If no live instance exists (app restart), we
    // create a new one pointing at the plain cache directory and call
    // getMinecraftJavaToken to silently refresh before mineflayer is created.
    const _fs         = require('fs');
    // Portable auth-cache location under the app's own data/ dir (the original
    // hardcoded a Windows-only path here, which never worked outside Windows).
    const _TOKENS_DIR = path.join(__dirname, 'data', 'auth-cache');

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
        // Live instance exists. If the token is close to expiry, silently refresh
        // using the same Authflow instance (preserves the EC key pair).
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
    tpsInterval:         null,   // NEW
    tps:                 null,   // NEW — last known TPS from /tps chat parsing
    chatReady:           false,
});

        // On 1.19+ servers with enforce-secure-profile, the server sends a
        // login_packet that initialises the signing session. mineflayer emits
        // 'session' once that handshake is complete. Sending chat BEFORE this
        // causes "Chat message validation failure" kicks.
        //
        // When the bot is transferred between servers/worlds (e.g. hub → survival),
        // the server issues a new login packet which resets the signing session.
        // We must reset chatReady=false and wait for the next 'session' event,
        // otherwise the bot sends chat with a stale signature and gets kicked.
        //
        // Use .on() (not .once()) so this fires on every server transfer.
        botInstance._client.on('session', () => {
            if (core.activeBots.get(botId) !== botInstance) return;
            const state = botStates.get(botId);
            if (state) state.chatReady = true;
            sendLog(botId, 'info', 'Chat session ready');
        });

        // Reset chatReady whenever the server sends a new login packet.
        // This happens on server transfers (hub → game server) on BungeeCord /
        // Velocity networks. The new signing session arrives shortly after via
        // the 'session' event above.
        botInstance._client.on('login', () => {
            if (core.activeBots.get(botId) !== botInstance) return;
            const state = botStates.get(botId);
            if (state) {
                state.chatReady = false;
                // Clear any pending TPA state so the re-sent TPA prompt on the new
                // server is not auto-accepted with a stale cached requester. Without
                // this the bot sends /tpaccept before the new chat session is ready,
                // causing a "Chat message validation failure" kick.
                state._tpaRequester = null;
                state._tpaTime      = null;

                // Stop the auto-clicker immediately on every server transfer.
                // The bot is switching worlds — all tracked entities from the
                // previous server are now invalid. Any attack packet sent during
                // the transition causes an "Attempting to attack an invalid entity"
                // kick. We stop here (not in stopClickersNow) because we want to
                // save the clicker config for restore, but NOT re-arm the restore
                // timer again — cancel any already-pending restore timer first.
                if (state._clickerRestoreTimer) {
                    clearTimeout(state._clickerRestoreTimer);
                    state._clickerRestoreTimer = null;
                }
                // Save clicker config so it can be restored after the new spawn
                const restoreLeft  = state.clicking?.left  ? { ...state.clicking.left }  : null;
                const restoreRight = state.clicking?.right ? { ...state.clicking.right } : null;
                if (restoreLeft || restoreRight) {
                    core._pendingClickerRestore = core._pendingClickerRestore || {};
                    core._pendingClickerRestore[botId] = { left: restoreLeft, right: restoreRight };
                }
                // Kill all clicker intervals immediately
                if (state.clickIntervalLeft)  { clearInterval(state.clickIntervalLeft);  state.clickIntervalLeft  = null; state.clickTokenLeft  = null; }
                if (state.clickIntervalRight) { clearInterval(state.clickIntervalRight); state.clickIntervalRight = null; state.clickTokenRight = null; }
                if (state.clickInterval)      { clearInterval(state.clickInterval);      state.clickInterval      = null; }
                try { botInstance.setControlState('attack', false); } catch {}
                try { botInstance.setControlState('use',    false); } catch {}

                sendLog(botId, 'info', 'Server transfer detected — waiting for new chat session...');
                // Safety fallback: servers that don't use signed chat (offline mode,
                // old versions, or Paper with enforce-secure-profile=false) never fire
                // the 'session' event after a login packet. If chatReady is still false
                // after 4 seconds, mark it ready so commands/chat aren't permanently blocked.
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

        // Fallback: if the server doesn't use signed chat the 'session' event
        // never fires, so mark ready after spawn instead.
        botInstance.on('spawn', () => {
            if (core.activeBots.get(botId) !== botInstance) return;
            const state = botStates.get(botId);
            if (state && !state.chatReady) {
                // Wait 3s so any pending session packet has time to arrive.
                // 1.19+ servers send the session packet within ~500ms of login,
                // but some proxies are slow. 3s covers all realistic cases while
                // still being short enough to not block legitimate commands.
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
                    const _autoTpaFile = path.join(__dirname, 'data', 'autotpa.json');
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

               // NEW — poll TPS every 10s via chat, since vanilla doesn't expose TPS to clients directly.
               // Assumes a plugin like Essentials/Spigot that responds to "/tps" in chat.
               state.tpsInterval = setInterval(() => {
               if (!activeBots.has(botId) || !state.chatReady) return;
                try { botInstance.chat('/tps'); } catch {}
                }, 10000);

                // Restore auto-clicker if it was running before disconnect.
                // Use a longer delay so the bot is fully spawned and stable.
                // We call ipcMain.emit directly which runs the 'execute-command'
                // handler synchronously — this avoids a second IPC round-trip and
                // keeps the token/instance check inside commands.js working correctly.
                const pending = core._pendingClickerRestore?.[botId];
                if (pending) {
                    delete core._pendingClickerRestore[botId];
                    state._clickerRestoreTimer = setTimeout(() => {
                        state._clickerRestoreTimer = null;
                        // Confirm this exact instance is still the active one
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
                    }, 5000); // 5s — enough time to fully spawn and settle after reconnect
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
            // Auto-respawn
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
        // Guard flag so we don't queue multiple simultaneous consume() calls
        // if 'health' fires several times before the eating animation finishes.
        let _autoEatBusy = false;
        botInstance.on('health', () => {
            const bs = core.botBehaviourSettings;
            if (!bs?.autoeat) return;
            if (_autoEatBusy) return;
            const threshold = bs.autoeatThreshold ?? 14;
            if (botInstance.food > threshold) return;
            // Find a food item in hotbar slots (36-44 in window slots = 0-8 hotbar).
            // minecraft-data identifies food items by the presence of `foodPoints`
            // (some versions) or `saturation` on the item definition — NOT a boolean
            // `food` property. We also accept items whose name contains common food
            // keywords as a fallback for versions where registry data is incomplete.
            const slots = botInstance.inventory?.slots || [];
            const registry = botInstance.registry;
            const isFoodItem = (item) => {
                if (!item) return false;
                // Primary: check minecraft-data registry
                const def = registry?.itemsByName?.[item.name] ?? registry?.itemsByName?.[item.name.replace('minecraft:', '')];
                if (def) {
                    // minecraft-data 3.x uses `foodPoints`, older versions use `food`
                    if (def.foodPoints !== undefined || def.food !== undefined || def.saturation !== undefined) return true;
                }
                // Fallback: name-based heuristic for items the registry misses
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
                        // Release busy flag after eating animation (~1.6s)
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

        // ── Stop auto-clicker if its target entity dies or despawns ──────────
        // Proactively delete the entity from bot.entities the moment it dies.
        // This closes the race window between the server removing the entity and
        // the next clicker tick firing — mineflayer keeps the stale object in
        // bot.entities for up to ~1 tick after the death packet, which is enough
        // to cause an "Attempting to attack an invalid entity" kick at mob farms
        // (endermen, blazes) where many mobs die near-simultaneously.
        botInstance.on('entityDead', entity => {
            if (!entity) return;
            // Mark health as 0 so isValidAttackTarget rejects it immediately,
            // even if mineflayer hasn't yet deleted it from bot.entities.
            try { entity.health = 0; } catch {}
            // Also remove from the tracked map so the id-existence check fails.
            try { delete botInstance.entities[entity.id]; } catch {}
        });

        botInstance.on('entityGone', entity => {
            // entityGone fires when mineflayer removes an entity from tracking.
            // isValidAttackTarget in commands.js guards every attack() call, so
            // no action needed here — entityDead above already handled cleanup.
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

                // Re-broadcast when slots update (items arrive after windowOpen)
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
        // In 1.19+, mineflayer's bot.on('message') only fires for system_chat
        // packets (server messages). Player chat arrives in a separate
        // playerChat packet that mineflayer does NOT forward to 'message'.
        // We handle both here with a shared processor.
        function handleChatText(text) {
        sendLog(botId, 'chat', text);

        // NEW — parse TPS out of the /tps command response (Spigot/Paper/Essentials format)
        const tpsMatch = /TPS[^0-9]*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
        if (tpsMatch) {
       state.tps = parseFloat(tpsMatch[1]);
        }

    // ── Auto-TPA ──────────────────────────────────────────────────────
    ...

            // ── Auto-TPA ──────────────────────────────────────────────────────
            const state = botStates.get(botId);
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
                    // Empty whitelist = deny everyone. Must be explicitly listed to be accepted.
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

        // 'messagestr' fires for ALL chat in mineflayer 4.x on 1.19+:
        // both system_chat (server messages) and player_chat (player messages).
        // Using this instead of 'message' + raw _client listener avoids
        // conflicts with mineflayer's own signed-chat pipeline.
        botInstance.on('messagestr', (text) => handleChatText(text));

        // Immediately kill all clicker intervals the moment this specific instance
        // loses its connection. This runs BEFORE cleanupBot so no in-flight interval
        // tick can fire an attack packet on a dead/invalid entity after the kick.
        // Clicker settings are saved to core._pendingClickerRestore so they can be
        // re-armed after a successful reconnect.
        function stopClickersNow() {
            const state = botStates.get(botId);
            if (!state) return;

            // Cancel any pending clicker-restore timer so it doesn't re-arm
            // the clicker on a bot that has been kicked or disconnected.
            if (state._clickerRestoreTimer) {
                clearTimeout(state._clickerRestoreTimer);
                state._clickerRestoreTimer = null;
            }

            // Save active clicker config for restore after reconnect
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
        // Called after kicked or end. Schedules a createBotConnection retry
        // if auto-reconnect is enabled in settings.
        // kickReason: optional string — detected to give longer delay on
        // "already connected" kicks where the old session hasn't cleared yet.
        function scheduleReconnect(attempt = 1, kickReason = '') {
            const rs = core.reconnectSettings;
            if (!rs.enabled) return;
            if (rs.maxTries > 0 && attempt > rs.maxTries) {
                sendLog(botId, 'error', `[Reconnect] Giving up after ${rs.maxTries} attempt(s)`);
                return;
            }
            // If the user manually disconnected (/disconnect), honour that and stop.
            if (core.reconnectCancelled.has(botId)) {
                core.reconnectCancelled.delete(botId);
                sendLog(botId, 'info', '[Reconnect] Cancelled by user — not reconnecting');
                return;
            }

            // "Already connected" means the old TCP session hasn't fully closed
            // server-side yet. Use a longer delay so the server can clear it.
            const alreadyConnected = /already connected/i.test(kickReason);
            const delayMs = alreadyConnected ? Math.max(15000, rs.delayMs * 3) : rs.delayMs;
            if (alreadyConnected) {
                sendLog(botId, 'warning', `[Reconnect] Server says "already connected" — waiting ${delayMs / 1000}s for session to clear…`);
            }

            const label = rs.maxTries > 0 ? ` (${attempt}/${rs.maxTries})` : ` (attempt ${attempt})`;
            sendLog(botId, 'info', `[Reconnect] Reconnecting in ${delayMs / 1000}s…${label}`);
            core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'reconnecting' });

            setTimeout(async () => {
                // Abort if the user disconnected while we were waiting in the delay.
                if (core.reconnectCancelled.has(botId)) {
                    core.reconnectCancelled.delete(botId);
                    sendLog(botId, 'info', '[Reconnect] Cancelled by user — not reconnecting');
                    core.mainWindow?.webContents.send('connection-status', { accountId: botId, status: 'offline' });
                    return;
                }
                // Abort if already reconnected manually, or bot config deleted
                if (core.activeBots.has(botId)) return;
                if (!core.bots[botId]) return;
                sendLog(botId, 'info', `[Reconnect] Connecting…${label}`);
                const newBot = await createBotConnection(botId);
                if (!newBot) {
                    // Connection failed — try again
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
                // Recursively extract all text values from NBT-style compound or plain chat JSON
                function extractText(node) {
                    if (!node || typeof node !== 'object') return String(node ?? '');
                    // NBT compound: { type: 'string', value: '...' }
                    if (node.type === 'string') return node.value ?? '';
                    if (node.type === 'byte')   return '';
                    if (node.type === 'compound') return extractText(node.value);
                    if (node.type === 'list')    return extractText(node.value);
                    // Plain chat JSON: { text: '...', extra: [...] }
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
            // Fatal auth kick — clear the stale live authflow so the next connect
            // attempt builds a fresh one, but keep the stored token so the account
            // is not lost. The user can manually delete the account if needed.
            if (/profile not found/i.test(reasonText) || /does the account own minecraft/i.test(reasonText)) {
                core.authflows.delete(identifier);
                sendLog(botId, 'warning', '🔑 Auth error — the Minecraft profile could not be verified.');
                sendLog(botId, 'warning', '   → Make sure this account has logged into the official launcher at least once.');
                sendLog(botId, 'warning', '   → You can re-authenticate via + → Manage Accounts if the issue persists.');
                return;
            }
            scheduleReconnect(1, reasonText);
        });

        // ── Fatal auth errors — do not reconnect ─────────────────────────────
        // "Profile not found" means Mojang's session server rejected the auth token.
        // This is a permanent failure until the token is refreshed. Retrying in a
        // loop is pointless and just hammers the auth servers.
        // We detect it on the 'error' event (thrown by yggdrasil during the session
        // join handshake) AND on 'end' in case the error surfaces there instead.
        let _fatalAuthError = false;

        botInstance.on('error', err => {
            const msg = err.message || '';
            if (/profile not found/i.test(msg) || /does the account own minecraft/i.test(msg)) {
                _fatalAuthError = true;
                // Clear the stale live authflow so the next manual connect builds a
                // fresh one, but keep the stored token — tokens are never auto-deleted.
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
            // Don't reconnect on fatal auth errors — the token is invalid and
            // retrying will just loop forever with the same rejection.
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
