// commands.js - execute-command IPC handler
'use strict';

const { ipcMain } = require('./electron-shim');
const { Movements, goals } = require('mineflayer-pathfinder');
const { GoalGetToBlock } = goals;

const core = require('./main');
const { startFollowing, stopFollowing } = require('./botConnection');

// ── Cache minecraft-data per version to avoid re-loading on every `go` call ───
const mcDataCache = {};

// ── Guard against attacking dead/despawned entities ──────────────────────────
// The server kicks with "Attempting to attack an invalid entity" if you send
// an attack packet for an entity that has already died or despawned.
// mineflayer keeps stale entity objects in bot.entities for a tick or two after
// death, so we must validate before every attack() call.
//
// Mob farms (endermen, blazes) are especially prone to this because many mobs
// die within the same tick — the entity is removed from bot.entities almost
// immediately, but a queued interval tick can still try to attack it.
function isValidAttackTarget(bot, entity) {
    if (!entity) return false;
    // Must still be tracked by mineflayer
    if (!bot.entities[entity.id]) return false;
    // Must have a position
    if (!entity.position) return false;
    // Reject objects (item drops, minecarts, etc.) — only mobs/players are attackable
    if (entity.type === 'object' || entity.type === 'orb') return false;
    // Reject the bot's own entity
    if (entity === bot.entity) return false;
    // Living entities report health — reject if at or below 0.
    // Also catch NaN which can appear transiently when mineflayer processes
    // a death packet but hasn't yet removed the entity from bot.entities.
    const health = entity.health;
    if (typeof health === 'number' && (health <= 0 || isNaN(health))) return false;
    // Extra check: mineflayer sets entity.isValid = false just before removal
    // in some versions. Honour it if present.
    if (entity.isValid === false) return false;
    return true;
}

// ── Map UI slot index → mineflayer window slot number ────────────────────────
// UI: 0-8=hotbar, 9-35=main inv, 36-39=armor, 40=offhand
// Mineflayer window: 36-44=hotbar, 9-35=main, 5-8=armor, 45=offhand
function uiSlotToWindow(uiSlot) {
    if (uiSlot >= 0  && uiSlot <= 8)  return uiSlot + 36;
    if (uiSlot >= 9  && uiSlot <= 35) return uiSlot;
    if (uiSlot >= 36 && uiSlot <= 39) return uiSlot - 31;
    if (uiSlot === 40)                return 45;
    return uiSlot;
}

// ── Swap inventory slots ──────────────────────────────────────────────────────
async function swapSlots(botInstance, slotA, slotB) {
    const winA = uiSlotToWindow(slotA);
    const winB = uiSlotToWindow(slotB);
    await botInstance.clickWindow(winA, 0, 0);
    await botInstance.clickWindow(winB, 0, 0);
    await botInstance.clickWindow(winA, 0, 0);
}

// ── Main command handler ──────────────────────────────────────────────────────
ipcMain.handle('execute-command', async (event, botId, command) => {
    const { activeBots, botStates, sendLog, sendBotUpdate } = core;

    const botInstance = activeBots.get(botId);
    if (!botInstance) return { success: false, error: 'Bot not connected' };

    try {
        const state = botStates.get(botId);
        if (state) state.commandCount = (state.commandCount || 0) + 1;

        // ── list ──────────────────────────────────────────────────────────────
        if (command === 'list') {
            const players = Object.keys(botInstance.players).filter(n => n !== botInstance.username);
            sendLog(botId, 'info', `Online players (${players.length}): ${players.join(', ') || 'None'}`);
            return { success: true };
        }

        // ── sneak ─────────────────────────────────────────────────────────────
        if (command === 'sneak') {
            if (state) {
                state.sneaking = !state.sneaking;
                botInstance.setControlState('sneak', state.sneaking);
                sendLog(botId, 'info', `Sneaking: ${state.sneaking ? 'ON' : 'OFF'}`);
                sendBotUpdate(botId);
            }
            return { success: true };
        }

        // ── follow <player|toggle> ────────────────────────────────────────────
        if (command.startsWith('follow')) {
            const parts = command.split(' ');
            if (parts.length < 2) {
                sendLog(botId, 'error', 'Usage: /follow <player> or /follow toggle');
                return { success: false, error: 'Missing argument' };
            }
            if (parts[1] === 'toggle') {
                if (state?.following) {
                    stopFollowing(botId);
                    sendLog(botId, 'info', `Stopped following ${state.following}`);
                } else {
                    sendLog(botId, 'error', 'Not currently following anyone');
                }
            } else {
                const playerNames = Object.keys(botInstance.players);
                const actualName  = playerNames.find(n => n.toLowerCase() === parts[1].toLowerCase());
                if (!actualName) {
                    sendLog(botId, 'error', `Player "${parts[1]}" not found`);
                    sendLog(botId, 'info', `Online: ${playerNames.filter(n => n !== botInstance.username).join(', ') || 'None'}`);
                    return { success: false, error: 'Player not found' };
                }
                startFollowing(botId, actualName);
                sendLog(botId, 'info', `Now following ${actualName}`);
            }
            return { success: true };
        }

        // ── go <x> <y> <z> ───────────────────────────────────────────────────
        if (command.startsWith('go')) {
            const parts = command.split(/[\s,]+/).filter(Boolean);
            if (parts.length < 4) {
                sendLog(botId, 'error', 'Usage: /go <x> <y> <z>');
                return { success: false, error: 'Missing coordinates' };
            }
            const [x, y, z] = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
            if ([x, y, z].some(isNaN)) {
                sendLog(botId, 'error', 'Invalid coordinates');
                return { success: false, error: 'Invalid coordinates' };
            }
            try {
                const mcData    = mcDataCache[botInstance.version] ||
                                  (mcDataCache[botInstance.version] = require('minecraft-data')(botInstance.version));
                const movements = new Movements(botInstance, mcData);
                movements.canDig = false;
                botInstance.pathfinder.setMovements(movements);
                botInstance.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1));
                sendLog(botId, 'info', `Navigating to ${x}, ${y}, ${z}`);
                botInstance.once('goal_reached', () => sendLog(botId, 'success', 'Reached destination!'));
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `Pathfinding failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── hotbar [1-9] ──────────────────────────────────────────────────────
        if (command.startsWith('hotbar')) {
            const parts = command.split(' ');
            if (parts.length < 2) {
                sendLog(botId, 'error', 'Usage: /hotbar [1-9]');
                return { success: false, error: 'Missing slot number' };
            }
            const slot = parseInt(parts[1]);
            if (isNaN(slot) || slot < 1 || slot > 9) {
                sendLog(botId, 'error', 'Hotbar slot must be 1-9');
                return { success: false, error: 'Invalid slot number' };
            }
            botInstance.setQuickBarSlot(slot - 1);
            sendLog(botId, 'info', `Switched to hotbar slot ${slot}`);
            sendBotUpdate(botId);
            return { success: true };
        }

        // ── face <direction> ──────────────────────────────────────────────────
        if (command.startsWith('face')) {
            const parts = command.split(' ');
            if (parts.length < 2) {
                sendLog(botId, 'error', 'Usage: /face [north|south|east|west]');
                return { success: false, error: 'Missing direction' };
            }
            const yawMap = {
                north: -Math.PI, n: -Math.PI,
                south:  0,       s:  0,
                east:  -Math.PI / 2, e: -Math.PI / 2,
                west:   Math.PI / 2, w:  Math.PI / 2,
            };
            const yaw = yawMap[parts[1].toLowerCase()];
            if (yaw === undefined) {
                sendLog(botId, 'error', 'Use: north, south, east, or west');
                return { success: false, error: 'Invalid direction' };
            }
            botInstance.look(yaw, 0, false);
            sendLog(botId, 'info', `Now facing ${parts[1].toUpperCase()}`);
            return { success: true };
        }

        // ── look <yaw> <pitch> ────────────────────────────────────────────────
        if (command.startsWith('look ')) {
            const parts = command.split(' ');
            const yaw   = parseFloat(parts[1]);
            const pitch = parseFloat(parts[2]);
            if (isNaN(yaw) || isNaN(pitch)) {
                sendLog(botId, 'error', 'Usage: /look <yaw_radians> <pitch_radians>');
                return { success: false, error: 'Invalid yaw/pitch' };
            }
            botInstance.look(yaw, pitch, false);
            return { success: true };
        }

        // ── drop <all|slot> [count] ───────────────────────────────────────────
        if (command.startsWith('drop')) {
            const parts = command.split(' ');
            if (parts.length < 2) {
                sendLog(botId, 'error', 'Usage: /drop <all|slot_number> [count]');
                return { success: false, error: 'Missing argument' };
            }
            try {
                if (parts[1] === 'all') {
                    const items = botInstance.inventory.items();
                    if (items.length === 0) { sendLog(botId, 'info', 'Inventory is empty'); return { success: true }; }
                    for (const item of items) await botInstance.tossStack(item);
                    sendLog(botId, 'success', `Dropped all items (${items.length} stacks)`);
                } else {
                    const slot = parseInt(parts[1]);
                    if (isNaN(slot) || slot < 0 || slot > 44) {
                        sendLog(botId, 'error', 'Slot must be 0-44');
                        return { success: false, error: 'Invalid slot' };
                    }
                    // Map UI slot number to mineflayer window slot number
                    // UI:        0-8  = hotbar, 9-35 = main inv, 36-39 = armor, 40 = offhand
                    // Mineflayer: 36-44 = hotbar, 9-35 = main inv, 5-8 = armor, 45 = offhand
                    const windowSlot = uiSlotToWindow(slot);
                    const item = botInstance.inventory.slots[windowSlot];
                    if (!item) {
                        sendLog(botId, 'error', `No item in slot ${slot} (window slot ${windowSlot})`);
                        return { success: false, error: 'Empty slot' };
                    }
                    const count = parts[2] ? parseInt(parts[2]) : item.count;
                    if (isNaN(count) || count < 1) {
                        sendLog(botId, 'error', 'Count must be a positive number');
                        return { success: false, error: 'Invalid count' };
                    }
                    if (count >= item.count) {
                        await botInstance.tossStack(item);
                    } else {
                        await botInstance.toss(item.type, null, count);
                    }
                    sendLog(botId, 'success', `Dropped ${item.name.replace('minecraft:', '')} ×${count}`);
                }
                sendBotUpdate(botId);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `Failed to drop item: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── swap <slotA> <slotB> ──────────────────────────────────────────────
        if (command.startsWith('swap')) {
            const parts = command.split(' ');
            const slotA = parseInt(parts[1]);
            const slotB = parseInt(parts[2]);
            if (isNaN(slotA) || isNaN(slotB)) {
                sendLog(botId, 'error', 'Usage: /swap <slotA> <slotB>');
                return { success: false, error: 'Invalid slots' };
            }
            try {
                await swapSlots(botInstance, slotA, slotB);
                sendLog(botId, 'info', `Swapped slot ${slotA} ↔ slot ${slotB}`);
                sendBotUpdate(botId);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `Swap failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── clickwindow <slot> <0=left|1=right> ──────────────────────────────
        // NOTE: this MUST be checked before the 'click' handler below,
        // because 'clickwindow' also starts with 'click'.
        if (command.startsWith('clickwindow')) {
            const parts  = command.split(' ');
            const slot   = parseInt(parts[1]);
            const button = parseInt(parts[2]) || 0; // 0=left, 1=right
            if (isNaN(slot)) {
                sendLog(botId, 'error', 'Usage: /clickwindow <slot> [0=left|1=right]');
                return { success: false, error: 'Invalid slot' };
            }
            try {
                // Capture window + its ID at call-time so we can detect if the
                // server closes it on us during the pre-click delay.
                const win = botInstance.currentWindow;
                if (!win) {
                    sendLog(botId, 'error', 'No container is open');
                    return { success: false, error: 'No open window' };
                }
                const capturedId = win.id;

                // Short human-like delay (80-200ms). The old 300-700ms range was
                // long enough for server GUIs to close themselves before the click
                // packet arrived, causing INTERRUPTED USER CONNECTION.
                const preDelay = 80 + Math.floor(Math.random() * 120);
                await new Promise(r => setTimeout(r, preDelay));

                // Re-check: window must still be open AND be the same window.
                if (!botInstance.currentWindow || botInstance.currentWindow.id !== capturedId) {
                    sendLog(botId, 'error', 'Container closed before click');
                    return { success: false, error: 'Window closed' };
                }

                await botInstance.clickWindow(slot, button, 0);
                sendLog(botId, 'info', `Clicked container slot ${slot} (${button === 1 ? 'right' : 'left'})`);

                // Do NOT close the window here. The server closes it when it
                // wants to (e.g. shop GUIs stay open between clicks). Sending
                // an extra close packet causes INTERRUPTED USER CONNECTION and
                // breaks multi-click flows. Use the closewindow command explicitly
                // when you actually want to close.

                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `clickwindow failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── clickonce <left|right> ────────────────────────────────────────────
        // Performs a single click immediately — does NOT start the auto-clicker.
        if (command.startsWith('clickonce ')) {
            const parts   = command.split(' ');
            const isRight = parts[1] === 'right';
            try {
                if (isRight) {
                    botInstance.activateItem();
                } else {
                    const entity = botInstance.entityAtCursor(3.5);
                    if (entity && isValidAttackTarget(botInstance, entity)) {
                        botInstance.attack(entity);
                    } else {
                        const block = botInstance.blockAtCursor(4.5);
                        if (block) {
                            botInstance.dig(block).catch(() => {});
                        } else {
                            botInstance.swingArm();
                        }
                    }
                }
                sendLog(botId, 'info', `${isRight ? 'Right' : 'Left'} clicked once`);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `clickonce failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── holdclick <left|right> <ticks> ───────────────────────────────────
        // Holds a click for the given number of ticks, then stops.
        // Does NOT touch the auto-clicker interval.
        if (command.startsWith('holdclick ')) {
            const parts   = command.split(' ');
            const isRight = parts[1] === 'right';
            const ticks   = Math.max(1, parseInt(parts[2]) || 10);
            const holdMs  = ticks * 50;
            try {
                botInstance.setControlState(isRight ? 'use' : 'attack', true);
                sendLog(botId, 'info', `Holding ${isRight ? 'right' : 'left'} click for ${ticks} ticks…`);
                await new Promise(r => setTimeout(r, holdMs));
                botInstance.setControlState(isRight ? 'use' : 'attack', false);
                sendLog(botId, 'info', `Released ${isRight ? 'right' : 'left'} click`);
                return { success: true };
            } catch (err) {
                // Always try to release on error
                try { botInstance.setControlState(isRight ? 'use' : 'attack', false); } catch {}
                sendLog(botId, 'error', `holdclick failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── click <left|right> <ticks> [hold] | click stop [left|right|all] ──
        // Supports two independent auto-clickers (left + right) running simultaneously.
        // "hold" mode keeps the button held via setControlState instead of pulsing.
        // Examples:
        //   click left 2          – pulse left every 2 ticks
        //   click right 4 hold    – hold right button, repeat-activate every 4 ticks
        //   click stop            – stop both
        //   click stop left       – stop only left clicker
        //   click stop right      – stop only right clicker
        if (command.startsWith('click')) {
            const parts = command.split(' ');
            const state = botStates.get(botId);

            // ── stop ──────────────────────────────────────────────────────────
            if (parts[1] === 'stop') {
                const which = parts[2]; // 'left', 'right', or undefined (= all)
                const stopLeft  = !which || which === 'left';
                const stopRight = !which || which === 'right';

                if (stopLeft && state?.clickIntervalLeft) {
                    clearInterval(state.clickIntervalLeft);
                    state.clickIntervalLeft = null;
                    state.clickTokenLeft = null; // kill any in-flight callback immediately
                    try { botInstance.setControlState('attack', false); } catch {}
                }
                if (stopRight && state?.clickIntervalRight) {
                    clearInterval(state.clickIntervalRight);
                    state.clickIntervalRight = null;
                    state.clickTokenRight = null; // kill any in-flight callback immediately
                    try { botInstance.setControlState('use', false); } catch {}
                }

                // Legacy single-interval cleanup
                if (state?.clickInterval) {
                    clearInterval(state.clickInterval);
                    state.clickInterval = null;
                }

                // Normalise clicking — null it out completely if both sides stopped
                if (state) {
                    if (state.clicking && typeof state.clicking === 'object') {
                        if (stopLeft)  state.clicking.left  = null;
                        if (stopRight) state.clicking.right = null;
                    }
                    const hasLeft  = !!state.clicking?.left;
                    const hasRight = !!state.clicking?.right;
                    if (!hasLeft && !hasRight) state.clicking = null;
                }

                const stoppedLabel = which ? `${which} clicker` : 'auto-clicker';
                sendLog(botId, 'info', `${stoppedLabel.charAt(0).toUpperCase() + stoppedLabel.slice(1)} stopped`);
                sendBotUpdate(botId);
                return { success: true };
            }

            // ── start ─────────────────────────────────────────────────────────
            const isRight = parts[1] === 'right';
            const ticks   = Math.max(1, parseInt(parts[2]) || 1);
            const holdMode = parts[3] === 'hold';
            const ms      = ticks * 50; // 1 tick = 50ms

            // Stop the specific side before (re)starting it.
            // Each run gets a unique Symbol token. doClick checks the token so any
            // already-dispatched async work bails out immediately when stop is called —
            // clearInterval alone only stops future ticks, not in-flight callbacks.
            const intervalKey = isRight ? 'clickIntervalRight' : 'clickIntervalLeft';
            const tokenKey    = isRight ? 'clickTokenRight'    : 'clickTokenLeft';
            if (state?.[intervalKey]) {
                clearInterval(state[intervalKey]);
                state[intervalKey] = null;
                state[tokenKey] = null; // invalidate any in-flight callback
                try { botInstance.setControlState(isRight ? 'use' : 'attack', false); } catch {}
            }
            // Also clear legacy single-interval if present
            if (state?.clickInterval) {
                clearInterval(state.clickInterval);
                state.clickInterval = null;
            }

            // Mint a fresh token for this run
            const myToken = Symbol();
            state[tokenKey] = myToken;

            const doClick = () => {
                // Validate this specific instance is still the registered bot.
                // activeBots.has() alone is not enough — after a kick+reconnect a
                // NEW instance is registered under the same botId, and the stale
                // closure would pass the has() check and attack on the new connection.
                if (activeBots.get(botId) !== botInstance) {
                    // Self-destruct: kill the interval from inside the callback so
                    // any tick that was already queued in the event loop doesn't fire again.
                    if (state[intervalKey]) { clearInterval(state[intervalKey]); state[intervalKey] = null; }
                    return;
                }
                // Also bail if the token was revoked (stop was called)
                if (state[tokenKey] !== myToken) return;
                try {
                    if (isRight) {
                        if (holdMode) {
                            botInstance.setControlState('use', true);
                        } else {
                            botInstance.activateItem();
                        }
                    } else {
                        if (holdMode) {
                            botInstance.setControlState('attack', true);
                        } else {
                            // Prefer cursor entity (bot is actively looking at it),
                            // then fall back to nearest living entity within 4 blocks.
                            // Do NOT fall through to swingArm — it looks active but
                            // does nothing useful and makes it look like it's clicking.
                            const cursorEntity = botInstance.entityAtCursor(3.5);
                            if (cursorEntity && isValidAttackTarget(botInstance, cursorEntity)) {
                                botInstance.attack(cursorEntity);
                            } else {
                                const pos = botInstance.entity?.position;
                                const nearest = pos ? Object.values(botInstance.entities)
                                    .filter(e =>
                                        e !== botInstance.entity &&
                                        e.type !== 'object' &&
                                        isValidAttackTarget(botInstance, e) &&
                                        e.position.distanceTo(pos) <= 4
                                    )
                                    .sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos))[0]
                                    : null;
                                if (nearest) {
                                    botInstance.attack(nearest);
                                } else {
                                    const block = botInstance.blockAtCursor(4.5);
                                    if (block && block.name !== 'air') {
                                        botInstance.dig(block).catch(() => {});
                                    }
                                    // Nothing in range — do nothing (no cosmetic swing)
                                }
                            }
                        }
                    }
                } catch {}
            };

            doClick();
            state[intervalKey] = setInterval(doClick, ms);

            // Initialise clicking as an object supporting both sides
            if (!state.clicking || typeof state.clicking !== 'object' || state.clicking.button) {
                // Migrate legacy format
                state.clicking = {};
            }
            const side = isRight ? 'right' : 'left';
            state.clicking[side] = { ticks, hold: holdMode };

            const modeLabel = holdMode ? 'hold' : 'pulse';
            sendLog(botId, 'info', `Auto-clicker: ${side} click [${modeLabel}] every ${ticks} tick(s)`);
            sendBotUpdate(botId);
            return { success: true };
        }


        // ── useitem ───────────────────────────────────────────────────────────
        if (command === 'useitem') {
            try {
                botInstance.activateItem();
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        // ── closewindow ───────────────────────────────────────────────────────
        // Closes any currently open inventory or container window.
        if (command === 'closewindow') {
            const win = botInstance.currentWindow;
            if (!win) {
                sendLog(botId, 'info', 'No open window to close');
                return { success: true };
            }
            try {
                botInstance.closeWindow(win);
                sendLog(botId, 'info', 'Closed inventory / container');
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `closewindow failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── printpos ──────────────────────────────────────────────────────────
        if (command === 'printpos') {
            const pos = botInstance.entity.position;
            sendLog(botId, 'info', `Position: X=${pos.x.toFixed(2)}  Y=${pos.y.toFixed(2)}  Z=${pos.z.toFixed(2)}`);
            return { success: true };
        }

        // ── printstats ────────────────────────────────────────────────────────
        if (command === 'printstats') {
            sendLog(botId, 'info',
                `Health: ${botInstance.health?.toFixed(1) ?? '?'}/20  ` +
                `Food: ${botInstance.food ?? '?'}/20  ` +
                `XP Level: ${botInstance.experience?.level ?? '?'}`
            );
            return { success: true };
        }

        // ── lookat <type> ─────────────────────────────────────────────────────
        if (command.startsWith('lookat')) {
            const typeFilter = command.split(' ').slice(1).join(' ').trim().toLowerCase();
            const entities = Object.values(botInstance.entities).filter(e => {
                if (e === botInstance.entity) return false;
                if (!typeFilter) return true;
                return (e.name || '').toLowerCase().includes(typeFilter) ||
                       (e.username || '').toLowerCase().includes(typeFilter);
            });
            if (!entities.length) {
                sendLog(botId, 'info', `No entity found${typeFilter ? ` matching "${typeFilter}"` : ''}`);
                return { success: true };
            }
            const pos = botInstance.entity.position;
            const nearest = entities.reduce((a, b) =>
                a.position.distanceTo(pos) < b.position.distanceTo(pos) ? a : b
            );
            await botInstance.lookAt(nearest.position.offset(0, nearest.height ?? 1.6, 0));
            sendLog(botId, 'info', `Looking at ${nearest.username || nearest.name || 'entity'}`);
            return { success: true };
        }

        // ── attacknearest <type> ──────────────────────────────────────────────
        if (command.startsWith('attacknearest')) {
            const typeFilter = command.split(' ').slice(1).join(' ').trim().toLowerCase();
            const entities = Object.values(botInstance.entities).filter(e => {
                if (e === botInstance.entity) return false;
                if (e.type === 'object') return false; // skip item drops & projectiles
                if (!typeFilter) return true;
                return (e.name || '').toLowerCase().includes(typeFilter) ||
                       (e.username || '').toLowerCase().includes(typeFilter);
            });
            if (!entities.length) {
                sendLog(botId, 'info', `No entity found${typeFilter ? ` matching "${typeFilter}"` : ''}`);
                return { success: true };
            }
            const pos = botInstance.entity.position;
            const nearest = entities.reduce((a, b) =>
                a.position.distanceTo(pos) < b.position.distanceTo(pos) ? a : b
            );
            await botInstance.lookAt(nearest.position.offset(0, nearest.height ?? 1, 0));
            botInstance.attack(nearest);
            sendLog(botId, 'info', `Attacked ${nearest.username || nearest.name || 'entity'}`);
            return { success: true };
        }

        // ── openchest <radius> ────────────────────────────────────────────────
        if (command.startsWith('openchest')) {
            const parts  = command.split(' ');
            const radius = parseInt(parts[1]) || 6;
            try {
                const mcData = mcDataCache[botInstance.version] ||
                               (mcDataCache[botInstance.version] = require('minecraft-data')(botInstance.version));
                // Collect all chest-like block IDs
                const chestIds = ['chest', 'trapped_chest', 'barrel', 'shulker_box'].reduce((acc, name) => {
                    const blk = mcData.blocksByName[name];
                    if (blk) acc.push(blk.id);
                    return acc;
                }, []);
                // Also include coloured shulker boxes
                for (const [name, blk] of Object.entries(mcData.blocksByName)) {
                    if (name.endsWith('_shulker_box') && !chestIds.includes(blk.id)) chestIds.push(blk.id);
                }
                const chestBlock = botInstance.findBlock({ matching: chestIds, maxDistance: radius });
                if (!chestBlock) {
                    sendLog(botId, 'info', `No chest found within ${radius} blocks`);
                    return { success: true };
                }
                const movements = new Movements(botInstance, mcData);
                movements.canDig = false;
                botInstance.pathfinder.setMovements(movements);
                await botInstance.pathfinder.goto(new GoalGetToBlock(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z));
                const container = await botInstance.openContainer(chestBlock);
                sendLog(botId, 'success', `Opened ${chestBlock.name} at ${chestBlock.position.x}, ${chestBlock.position.y}, ${chestBlock.position.z}`);
                core.mainWindow?.webContents.send('container-open', { accountId: botId, type: chestBlock.name, position: chestBlock.position });
                // Store reference so closewindow can close it later
                const state2 = botStates.get(botId);
                if (state2) state2.openContainer = container;
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `openchest failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── opencraftingtable ─────────────────────────────────────────────────
        if (command === 'opencraftingtable') {
            try {
                const mcData = mcDataCache[botInstance.version] ||
                               (mcDataCache[botInstance.version] = require('minecraft-data')(botInstance.version));
                const tableId = mcData.blocksByName['crafting_table']?.id;
                if (!tableId) {
                    sendLog(botId, 'error', 'minecraft-data does not know crafting_table');
                    return { success: false, error: 'Unknown block' };
                }
                const tableBlock = botInstance.findBlock({ matching: tableId, maxDistance: 6 });
                if (!tableBlock) {
                    sendLog(botId, 'info', 'No crafting table within 6 blocks');
                    return { success: true };
                }
                const movements = new Movements(botInstance, mcData);
                movements.canDig = false;
                botInstance.pathfinder.setMovements(movements);
                await botInstance.pathfinder.goto(new GoalGetToBlock(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z));
                await botInstance.openBlock(tableBlock);
                sendLog(botId, 'success', 'Opened crafting table');
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `opencraftingtable failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── craft <item> <count> <useTable:0|1> ───────────────────────────────
        if (command.startsWith('craft ')) {
            const parts    = command.split(' ');
            const itemName = parts[1];
            const count    = Math.max(1, parseInt(parts[2]) || 1);
            const useTable = parts[3] === '1';
            try {
                const mcData = mcDataCache[botInstance.version] ||
                               (mcDataCache[botInstance.version] = require('minecraft-data')(botInstance.version));
                const itemData = mcData.itemsByName[itemName] || mcData.itemsByName[itemName.replace('minecraft:', '')];
                if (!itemData) {
                    sendLog(botId, 'error', `Unknown item: ${itemName}`);
                    return { success: false, error: 'Unknown item' };
                }
                const recipes = botInstance.recipesFor(itemData.id, null, 1, useTable ? null : false);
                if (!recipes || !recipes.length) {
                    sendLog(botId, 'info', `No recipe found for ${itemName}${useTable ? ' (table)' : ' (2×2)'}`);
                    return { success: true };
                }
                let craftingTable = null;
                if (useTable) {
                    const tableId = mcData.blocksByName['crafting_table']?.id;
                    craftingTable = botInstance.findBlock({ matching: tableId, maxDistance: 6 });
                    if (!craftingTable) {
                        sendLog(botId, 'info', 'No crafting table within 6 blocks — move closer');
                        return { success: true };
                    }
                    const movements = new Movements(botInstance, mcData);
                    movements.canDig = false;
                    botInstance.pathfinder.setMovements(movements);
                    await botInstance.pathfinder.goto(new GoalGetToBlock(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z));
                }
                await botInstance.craft(recipes[0], count, craftingTable);
                sendLog(botId, 'success', `Crafted ${count}× ${itemName}`);
                sendBotUpdate(botId);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `craft failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── smelt <item> <count> ──────────────────────────────────────────────
        if (command.startsWith('smelt ')) {
            const parts    = command.split(' ');
            const itemName = parts[1];
            const count    = Math.max(1, parseInt(parts[2]) || 1);
            try {
                const mcData = mcDataCache[botInstance.version] ||
                               (mcDataCache[botInstance.version] = require('minecraft-data')(botInstance.version));
                const furnaceId = mcData.blocksByName['furnace']?.id;
                const litFurnaceId = mcData.blocksByName['lit_furnace']?.id;
                const ids = [furnaceId, litFurnaceId].filter(Boolean);
                const furnaceBlock = botInstance.findBlock({ matching: ids, maxDistance: 6 });
                if (!furnaceBlock) {
                    sendLog(botId, 'info', 'No furnace within 6 blocks');
                    return { success: true };
                }
                const movements = new Movements(botInstance, mcData);
                movements.canDig = false;
                botInstance.pathfinder.setMovements(movements);
                await botInstance.pathfinder.goto(new GoalGetToBlock(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z));
                const furnace = await botInstance.openFurnace(furnaceBlock);
                const itemData = mcData.itemsByName[itemName] || mcData.itemsByName[itemName.replace('minecraft:', '')];
                if (!itemData) {
                    furnace.close();
                    sendLog(botId, 'error', `Unknown item: ${itemName}`);
                    return { success: false, error: 'Unknown item' };
                }
                await furnace.putInput(itemData.id, null, count);
                sendLog(botId, 'success', `Smelting ${count}× ${itemName}`);
                furnace.close();
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `smelt failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── activateblock <blockName> <radius> ────────────────────────────────
        if (command.startsWith('activateblock ')) {
            const parts     = command.split(' ');
            const blockName = parts[1];
            const radius    = parseInt(parts[2]) || 4;
            try {
                const mcData = mcDataCache[botInstance.version] ||
                               (mcDataCache[botInstance.version] = require('minecraft-data')(botInstance.version));
                const blkData = mcData.blocksByName[blockName] || mcData.blocksByName[blockName.replace('minecraft:', '')];
                if (!blkData) {
                    sendLog(botId, 'error', `Unknown block: ${blockName}`);
                    return { success: false, error: 'Unknown block' };
                }
                const found = botInstance.findBlock({ matching: blkData.id, maxDistance: radius });
                if (!found) {
                    sendLog(botId, 'info', `No ${blockName} within ${radius} blocks`);
                    return { success: true };
                }
                const movements = new Movements(botInstance, mcData);
                movements.canDig = false;
                botInstance.pathfinder.setMovements(movements);
                await botInstance.pathfinder.goto(new GoalGetToBlock(found.position.x, found.position.y, found.position.z));
                await botInstance.activateBlock(found);
                sendLog(botId, 'success', `Activated ${blockName} at ${found.position.x}, ${found.position.y}, ${found.position.z}`);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `activateblock failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── pickup <radius> ───────────────────────────────────────────────────
        if (command.startsWith('pickup')) {
            const parts  = command.split(' ');
            const radius = parseInt(parts[1]) || 8;
            try {
                const mcData = mcDataCache[botInstance.version] ||
                               (mcDataCache[botInstance.version] = require('minecraft-data')(botInstance.version));
                // Dropped items are entities with type 'object' and objectType 'Item'
                const drops = Object.values(botInstance.entities).filter(e =>
                    e !== botInstance.entity &&
                    e.name === 'item' &&
                    botInstance.entity.position.distanceTo(e.position) <= radius
                );
                if (!drops.length) {
                    sendLog(botId, 'info', `No dropped items within ${radius} blocks`);
                    return { success: true };
                }
                const movements = new Movements(botInstance, mcData);
                movements.canDig = false;
                botInstance.pathfinder.setMovements(movements);
                for (const drop of drops) {
                    if (!botInstance.entities[drop.id]) continue; // already picked up
                    await botInstance.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
                }
                sendLog(botId, 'success', `Moved to collect ${drops.length} item stack(s)`);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `pickup failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── placeblock <x> <y> <z> ───────────────────────────────────────────
        if (command.startsWith('placeblock ')) {
            const parts = command.split(' ');
            const [x, y, z] = [parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3])];
            if ([x, y, z].some(isNaN)) {
                sendLog(botId, 'error', 'Usage: placeblock <x> <y> <z>');
                return { success: false, error: 'Invalid coordinates' };
            }
            try {
                const refBlock = botInstance.blockAt(new (require('vec3'))(x, y - 1, z));
                if (!refBlock) {
                    sendLog(botId, 'error', 'No reference block below target position');
                    return { success: false, error: 'No reference block' };
                }
                await botInstance.placeBlock(refBlock, new (require('vec3'))(0, 1, 0));
                sendLog(botId, 'success', `Placed block at ${x}, ${y}, ${z}`);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `placeblock failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── digblock <x> <y> <z> ─────────────────────────────────────────────
        if (command.startsWith('digblock ')) {
            const parts = command.split(' ');
            const [x, y, z] = [parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3])];
            if ([x, y, z].some(isNaN)) {
                sendLog(botId, 'error', 'Usage: digblock <x> <y> <z>');
                return { success: false, error: 'Invalid coordinates' };
            }
            try {
                const target = botInstance.blockAt(new (require('vec3'))(x, y, z));
                if (!target || target.name === 'air') {
                    sendLog(botId, 'info', `No block at ${x}, ${y}, ${z}`);
                    return { success: true };
                }
                await botInstance.dig(target);
                sendLog(botId, 'success', `Dug ${target.name} at ${x}, ${y}, ${z}`);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `digblock failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // ── fish <start|stop> ─────────────────────────────────────────────────
        if (command.startsWith('fish')) {
            const subCmd = command.split(' ')[1] || 'start';
            const fishState = botStates.get(botId);
            if (subCmd === 'stop') {
                if (fishState?.fishingInterval) {
                    clearInterval(fishState.fishingInterval);
                    fishState.fishingInterval = null;
                    // Reel in if bobber exists
                    try { botInstance.activateItem(); } catch {}
                    sendLog(botId, 'info', 'Stopped fishing');
                    sendBotUpdate(botId);
                }
                return { success: true };
            }
            // start: cast, then watch for 'fishing' events
            if (fishState?.fishingInterval) {
                sendLog(botId, 'info', 'Already fishing');
                return { success: true };
            }
            const rodItem = botInstance.inventory.items().find(i =>
                (i.name || '').toLowerCase().includes('fishing_rod')
            );
            if (!rodItem) {
                sendLog(botId, 'info', 'No fishing rod in inventory');
                return { success: true };
            }
            try {
                await botInstance.equip(rodItem, 'hand');
            } catch (err) {
                sendLog(botId, 'error', `Could not equip fishing rod: ${err.message}`);
                return { success: false, error: err.message };
            }
            const castAndWait = async () => {
                if (!core.activeBots.has(botId)) return;
                // Cast rod
                botInstance.activateItem();
                sendLog(botId, 'info', 'Cast fishing rod…');
            };
            botInstance.on('experience', () => {}); // keep-alive
            const onFish = async () => {
                if (!fishState?.fishingInterval) return;
                // Reel in then cast again
                botInstance.activateItem();
                sendLog(botId, 'success', 'Caught something! Reeling in…');
                sendBotUpdate(botId);
                await new Promise(r => setTimeout(r, 500));
                if (core.activeBots.has(botId) && fishState?.fishingInterval) castAndWait();
            };
            botInstance.on('playerCollect', (collector, collected) => {
                if (collector.username === botInstance.username) onFish();
            });
            await castAndWait();
            fishState.fishingInterval = setInterval(() => {
                // Safety: re-cast every 30s in case bobber de-spawned
                if (!core.activeBots.has(botId)) { clearInterval(fishState.fishingInterval); return; }
                botInstance.activateItem();
                setTimeout(() => { if (core.activeBots.has(botId)) botInstance.activateItem(); }, 600);
            }, 30000);
            sendLog(botId, 'info', 'Auto-fishing started');
            sendBotUpdate(botId);
            return { success: true };
        }

        // ── equip <item> <destination> ────────────────────────────────────────
        if (command.startsWith('equip ')) {
            const parts = command.split(' ');
            const itemName = parts[1];
            const dest     = parts[2] || 'hand';
            const validDests = ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'];
            if (!validDests.includes(dest)) {
                sendLog(botId, 'error', `Invalid destination: ${dest}. Use: ${validDests.join(', ')}`);
                return { success: false, error: 'Invalid destination' };
            }
            const item = botInstance.inventory.items().find(i =>
                (i.name || '').toLowerCase().includes(itemName.toLowerCase())
            );
            if (!item) {
                sendLog(botId, 'info', `No item matching "${itemName}" in inventory`);
                return { success: true };
            }
            try {
                await botInstance.equip(item, dest);
                sendLog(botId, 'success', `Equipped ${item.name} to ${dest}`);
                sendBotUpdate(botId);
                return { success: true };
            } catch (err) {
                sendLog(botId, 'error', `equip failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }

        // Fall-through: send as a raw chat command to the server.
        // Guard against calling chat before the TCP session is fully established.
        if (typeof botInstance._client?.chat !== 'function') {
            sendLog(botId, 'error', 'Bot is still connecting — please wait before sending commands');
            return { success: false, error: 'Bot not ready' };
        }
        const chatState = botStates.get(botId);
        if (!chatState?.chatReady) {
            sendLog(botId, 'error', 'Chat session not ready yet — please wait a moment');
            return { success: false, error: 'Chat not ready' };
        }
        botInstance.chat(`/${command}`);
        sendLog(botId, 'command', `/${command}`);
        return { success: true };

    } catch (err) {
        return { success: false, error: err.message };
    }
});