// excavate.js - Box excavation
// Rewritten to use bot.dig() correctly (the mineflayer-native path) instead of
// raw block_dig packets, enable sprinting, use GoalGetToBlock so the bot
// actually gets adjacent to a block before digging, and spatially partition
// the volume so each bot in a multi-bot session works its own zone with
// minimal cross-region travel.
'use strict';

const { ipcMain } = require('./electron-shim');
const core = require('./main');

// ── Tool / block knowledge ────────────────────────────────────────────────────
const TOOL_PRIORITY = {
    pickaxe: new Set([
        'stone','cobblestone','deepslate','cobbled_deepslate','granite','diorite','andesite',
        'sandstone','red_sandstone','netherrack','basalt','blackstone','tuff','calcite',
        'dripstone_block','pointed_dripstone','amethyst_block','budding_amethyst',
        'iron_ore','deepslate_iron_ore','gold_ore','deepslate_gold_ore',
        'copper_ore','deepslate_copper_ore','coal_ore','deepslate_coal_ore',
        'diamond_ore','deepslate_diamond_ore','emerald_ore','deepslate_emerald_ore',
        'lapis_ore','deepslate_lapis_ore','redstone_ore','deepslate_redstone_ore',
        'nether_quartz_ore','nether_gold_ore','ancient_debris','obsidian','crying_obsidian',
        'iron_block','gold_block','diamond_block','emerald_block','lapis_block',
        'redstone_block','copper_block','quartz_block','purpur_block',
        'end_stone','end_stone_bricks','prismarine','prismarine_bricks','dark_prismarine',
        'sea_lantern','concrete','terracotta','glazed_terracotta',
        'nether_brick','red_nether_brick','magma_block','brick',
        'smooth_stone','stone_bricks','mossy_stone_bricks','cracked_stone_bricks',
        'chiseled_stone_bricks','polished_granite','polished_diorite','polished_andesite',
        'polished_deepslate','deepslate_bricks','deepslate_tiles','chiseled_deepslate',
        'raw_iron_block','raw_gold_block','raw_copper_block',
    ]),
    shovel: new Set([
        'dirt','grass_block','grass_path','dirt_path','mycelium','podzol','coarse_dirt',
        'rooted_dirt','mud','gravel','sand','red_sand','soul_sand','soul_soil',
        'snow','snow_block','clay','farmland','muddy_mangrove_roots',
    ]),
    axe: new Set([
        'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log',
        'mangrove_log','cherry_log','crimson_stem','warped_stem',
        'oak_wood','spruce_wood','birch_wood','jungle_wood','acacia_wood',
        'dark_oak_wood','mangrove_wood','cherry_wood','crimson_hyphae','warped_hyphae',
        'stripped_oak_log','stripped_spruce_log','stripped_birch_log','stripped_jungle_log',
        'stripped_acacia_log','stripped_dark_oak_log','stripped_mangrove_log',
        'oak_planks','spruce_planks','birch_planks','jungle_planks','acacia_planks',
        'dark_oak_planks','mangrove_planks','cherry_planks','crimson_planks','warped_planks',
        'bookshelf','chest','trapped_chest','crafting_table',
        'pumpkin','carved_pumpkin','melon','bamboo','bamboo_block',
    ]),
    hoe: new Set([
        'hay_block','nether_wart_block','warped_wart_block','shroomlight',
        'sponge','wet_sponge','target','moss_block',
        'oak_leaves','spruce_leaves','birch_leaves','jungle_leaves','acacia_leaves',
        'dark_oak_leaves','mangrove_leaves','cherry_leaves','azalea_leaves','flowering_azalea_leaves',
    ]),
};

const TIERS = ['netherite','diamond','golden','iron','stone','wooden'];

const UNBREAKABLE = new Set([
    'air','cave_air','void_air','bedrock','barrier',
    'command_block','chain_command_block','repeating_command_block','structure_block',
    'end_portal','end_portal_frame','end_gateway',
]);

// ── State ─────────────────────────────────────────────────────────────────────
const excavationJobs = new Map();
const multiSessions  = new Map();
let nextSessionId = 1;

// ── IPC: single-bot ───────────────────────────────────────────────────────────
ipcMain.handle('start-excavation', async (_e, botId, coords) => {
    const bot = core.activeBots.get(botId);
    if (!bot) return { success: false, error: 'Bot not connected' };

    const { x1, y1, z1, x2, y2, z2 } = coords;
    if ([x1,y1,z1,x2,y2,z2].some(v => v == null || isNaN(v)))
        return { success: false, error: 'Invalid coordinates' };

    if (excavationJobs.has(botId)) {
        excavationJobs.get(botId).cancel = true;
        await sleep(300);
    }

    const job    = { cancel: false };
    excavationJobs.set(botId, job);
    const bounds = makeBounds(x1,y1,z1,x2,y2,z2);
    const queue  = buildQueue(bounds);
    const total  = queue.length;

    core.sendLog(botId, 'info',
        `Excavation started: ${total} blocks ` +
        `(${bounds.minX},${bounds.minY},${bounds.minZ}) -> (${bounds.maxX},${bounds.maxY},${bounds.maxZ})`);
    status(botId, { active: true, progress: 0, total });

    excavate(bot, botId, job, queue, total).catch(err => {
        core.sendLog(botId, 'error', 'Excavation crashed: ' + err.message);
        console.error('[excavate] crash:', err);
        excavationJobs.delete(botId);
        status(botId, { active: false });
    });
    return { success: true };
});

// ── IPC: multi-bot ────────────────────────────────────────────────────────────
ipcMain.handle('start-excavation-multi', async (_e, botIds, coords) => {
    const { x1, y1, z1, x2, y2, z2 } = coords;
    if ([x1,y1,z1,x2,y2,z2].some(v => v == null || isNaN(v)))
        return { success: false, error: 'Invalid coordinates' };

    const onlineBotIds = botIds.filter(id => core.activeBots.has(id));
    if (onlineBotIds.length === 0)
        return { success: false, error: 'No connected bots in selection' };

    for (const id of onlineBotIds) {
        const ex = excavationJobs.get(id);
        if (ex) ex.cancel = true;
    }
    await sleep(300);

    const bounds     = makeBounds(x1,y1,z1,x2,y2,z2);
    const allBlocks  = buildQueue(bounds);
    const total      = allBlocks.length;
    const sessionId  = nextSessionId++;

    // Spatially partition the volume into one zone per bot.
    // Each bot gets a spatially-contiguous slab so it travels minimally.
    const zones = partitionBlocks(allBlocks, onlineBotIds.length);

    const session = {
        mined: 0, skipped: 0, total,
        botIds: new Set(onlineBotIds),
    };
    multiSessions.set(sessionId, session);

    core.sendLog(onlineBotIds[0], 'info',
        `Multi-excavation started: ${total} blocks across ${onlineBotIds.length} bots`);

    for (let i = 0; i < onlineBotIds.length; i++) {
        const id  = onlineBotIds[i];
        const bot = core.activeBots.get(id);
        const job = { cancel: false, sessionId };
        excavationJobs.set(id, job);
        status(id, { active: true, progress: 0, total });
        excavate(bot, id, job, zones[i] ?? [], total, session).catch(err => {
            core.sendLog(id, 'error', 'Excavation crashed: ' + err.message);
            excavationJobs.delete(id);
            status(id, { active: false });
        });
    }
    return { success: true, sessionId, total, bots: onlineBotIds };
});

// ── IPC: stop ─────────────────────────────────────────────────────────────────
ipcMain.handle('stop-excavation', (_e, botId) => {
    const job = excavationJobs.get(botId);
    if (!job) return { success: false, error: 'No active excavation' };
    job.cancel = true;

    if (job.sessionId != null) {
        const session = multiSessions.get(job.sessionId);
        if (session) {
            for (const id of session.botIds) {
                const j = excavationJobs.get(id);
                if (j) j.cancel = true;
            }
            multiSessions.delete(job.sessionId);
        }
    }
    excavationJobs.delete(botId);
    core.sendLog(botId, 'warning', 'Excavation cancelled');
    status(botId, { active: false });

    // Halt the bot immediately so it doesn't keep walking after cancel.
    const bot = core.activeBots.get(botId);
    if (bot) {
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (_) {}
        ['forward','back','left','right','sprint','jump'].forEach(c => {
            try { bot.setControlState(c, false); } catch (_) {}
        });
    }

    return { success: true };
});

ipcMain.handle('get-excavation-status', (_e, botId) => ({
    active: excavationJobs.has(botId),
}));

// ── Core excavation loop ──────────────────────────────────────────────────────
// Works for both single-bot (no session) and multi-bot (shared session for
// progress tracking). Each bot gets its own queue — no sharing, no racing.
async function excavate(bot, botId, job, queue, total, session = null) {
    const { Vec3 } = require('vec3');
    let mined = 0, skipped = 0;
    let consecutiveNavFailures = 0;
    const MAX_NAV_FAILURES = 10; // abort after 10 consecutive unreachable blocks

    // Navigate to first block so chunks are loaded before we begin iterating.
    if (queue.length > 0) {
        const f = queue[0];
        await navigate(bot, botId, f.x, f.y, f.z, job);
        try { await bot.waitForChunksToLoad(); } catch (_) {}
    }

    for (let i = 0; i < queue.length; i++) {
        if (job.cancel) break;
        if (consecutiveNavFailures >= MAX_NAV_FAILURES) {
            core.sendLog(botId, 'error',
                `Aborting: ${MAX_NAV_FAILURES} consecutive unreachable blocks — bot may be stuck`);
            break;
        }

        const { x, y, z } = queue[i];
        const pos   = new Vec3(x, y, z);

        // Skip blocks the bot is currently standing inside — digBlock would
        // immediately abort because the physics engine blocks it.
        if (bot.entity) {
            const bp = bot.entity.position.floored();
            if ((bp.x === x && bp.z === z) && (bp.y === y || bp.y - 1 === y)) {
                _skip(1); continue;
            }
        }

        let   block = bot.blockAt(pos);

        // Load chunk if needed — navigate close, wait, re-fetch.
        if (!block) {
            await navigate(bot, botId, x, y, z, job);
            if (job.cancel) break;
            try { await bot.waitForChunksToLoad(); } catch (_) {}
            block = bot.blockAt(pos);
        }
        if (!block) { _skip(1); consecutiveNavFailures++; continue; }

        const bname = block.name.replace('minecraft:', '');
        if (isAir(bname))           continue;   // already gone
        if (UNBREAKABLE.has(bname)) { _skip(1); continue; }

        // Navigate to digging position if not already in reach.
        if (!inReach(bot, x, y, z)) {
            await navigate(bot, botId, x, y, z, job);
            if (job.cancel) break;
        }

        // Re-read block after nav — it may have changed or been broken.
        block = bot.blockAt(pos);
        if (!block || isAir(block.name.replace('minecraft:', ''))) { consecutiveNavFailures = 0; continue; }
        if (UNBREAKABLE.has(block.name.replace('minecraft:', ''))) { _skip(1); continue; }

        if (!inReach(bot, x, y, z)) {
            core.sendLog(botId, 'warning', `Still unreachable after nav: (${x},${y},${z}), skipping`);
            _skip(1); consecutiveNavFailures++; continue;
        }
        consecutiveNavFailures = 0; // successfully reached a block

        // Stop pathfinder so the bot stands still while digging.
        stopPathfinder(bot);
        await equip(bot, botId, block.name);
        if (job.cancel) break;

        // Re-check after equip (async gap).
        block = bot.blockAt(pos);
        if (!block || isAir(block.name.replace('minecraft:', ''))) continue;

        const ok = await digBlock(bot, botId, block);
        if (ok) _mine(1); else _skip(1);

        const prog = mined + skipped;
        if (session) {
            if (prog % 5 === 0 || prog === queue.length)
                broadcastSharedStatus(session, job);
        } else {
            if (prog % 5 === 0 || prog === total)
                status(botId, { active: true, progress: prog, total, mined, skipped });
        }
    }

    // ── Finish ────────────────────────────────────────────────────────────────
    excavationJobs.delete(botId);
    stopPathfinder(bot); // ensure bot halts after finishing

    if (session) {
        session.botIds.delete(botId);
        if (session.botIds.size === 0) {
            multiSessions.delete(job.sessionId);
            const done = !job.cancel;
            status(botId, { active: false, progress: session.mined + session.skipped,
                total: session.total, mined: session.mined, skipped: session.skipped, done });
            if (done) core.sendLog(botId, 'success',
                `Multi-excavation done! Mined: ${session.mined}  Skipped: ${session.skipped}`);
        } else {
            status(botId, { active: false });
            core.sendLog(botId, 'info', `Bot done with its zone.`);
        }
    } else {
        const done = !job.cancel;
        status(botId, { active: false, progress: mined+skipped, total, mined, skipped, done });
        if (done) core.sendLog(botId, 'success', `Excavation done! Mined: ${mined}  Skipped: ${skipped}`);
    }

    function _mine(n) { mined += n; if (session) session.mined += n; }
    function _skip(n) { skipped += n; if (session) session.skipped += n; }
}

// ── Dig a single block via bot.dig() ─────────────────────────────────────────
// bot.dig(block, forceLook) is the correct mineflayer-native API:
//   - forceLook=true  → looks instantly and starts this tick
//   - Handles internally: lookAt, block_dig START, swing interval,
//     sequence numbers, acknowledge_player_digging, block_dig STOP,
//     diggingCompleted event
//   - Returns a Promise that resolves when the block is confirmed broken
async function digBlock(bot, botId, block) {
    if (!block || !bot.entity) return false;
    if (isAir(block.name.replace('minecraft:', ''))) return true;
    if (!bot.canDigBlock(block)) {
        core.sendLog(botId, 'warning', `Cannot dig ${block.name} at ${fmtPos(block.position)}`);
        return false;
    }

    // Generous timeout: 2x dig time + 1 s server-round-trip buffer.
    const digTimeMs = bot.digTime(block) ?? 3000;
    const timeout   = digTimeMs * 2 + 1000;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await Promise.race([
                bot.dig(block, true),
                new Promise((_, rej) => setTimeout(() => rej(new Error('dig timeout')), timeout)),
            ]);

            // Verify block is actually gone server-side.
            const after = bot.blockAt(block.position);
            if (!after || isAir(after.name.replace('minecraft:', ''))) return true;

            // Block still there — server rejected, retry once.
            if (attempt === 0) {
                core.sendLog(botId, 'warning',
                    `Block still present after dig ${fmtPos(block.position)}, retrying...`);
                await sleep(150);
                const fresh = bot.blockAt(block.position);
                if (!fresh || isAir(fresh.name.replace('minecraft:', ''))) return true;
                block = fresh;
            }
        } catch (err) {
            if (err.message === 'dig timeout') {
                core.sendLog(botId, 'warning', `Dig timed out at ${fmtPos(block.position)}`);
            } else if (err.message?.includes('diggingAborted')) {
                // Pathfinder or physics interrupted — just retry.
                if (attempt === 0) { await sleep(80); continue; }
            } else {
                core.sendLog(botId, 'warning', `Dig error at ${fmtPos(block.position)}: ${err.message}`);
            }
            if (attempt === 1) return false;
            await sleep(80);
        }
    }

    core.sendLog(botId, 'warning', `Failed to break ${block.name} at ${fmtPos(block.position)}`);
    return false;
}

// ── Navigation ────────────────────────────────────────────────────────────────
// GoalGetToBlock places the bot adjacent to the target block — exactly right
// for digging. Sprint enabled for full speed. Movements cached per bot.
const botMovements = new Map();
function getMovements(bot) {
    if (botMovements.has(bot)) return botMovements.get(bot);
    const { Movements } = require('mineflayer-pathfinder');
    const m = new Movements(bot);
    m.canDig         = false; // Don't let pathfinder dig autonomously
    m.allowSprinting = true;  // Full speed
    m.maxDropDown    = 3;     // Allow small drops during navigation
    botMovements.set(bot, m);
    return m;
}

async function navigate(bot, botId, x, y, z, job) {
    if (!bot.pathfinder) return;
    if (inReach(bot, x, y, z, 3.5)) return; // Already close enough

    try {
        const { goals: { GoalGetToBlock } } = require('mineflayer-pathfinder');
        bot.pathfinder.setMovements(getMovements(bot));
        bot.pathfinder.setGoal(new GoalGetToBlock(x, y, z), true);

        await new Promise(resolve => {
            let done = false;
            const finish = () => {
                if (done) return; done = true;
                clearTimeout(timer);
                bot.removeListener('goal_reached', onDone);
                bot.removeListener('path_update',  onUpdate);
                try { bot.pathfinder.setGoal(null); } catch (_) {}
                resolve();
            };
            const onDone   = () => finish();
            const onUpdate = r => {
                if (r.status === 'noPath' || r.status === 'timeout' || r.status === 'arrived')
                    finish();
                if (r.status === 'noPath' || r.status === 'timeout')
                    core.sendLog(botId, 'warning', `Navigation ${r.status} -> (${x},${y},${z})`);
            };
            const timer = setTimeout(() => {
                core.sendLog(botId, 'warning', `Navigation hard-timeout -> (${x},${y},${z})`);
                finish();
            }, 12000);
            bot.once('goal_reached', onDone);
            bot.on('path_update',   onUpdate);
        });
    } catch (_) {}
}

function stopPathfinder(bot) {
    try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.setControlState('sprint',  false); } catch (_) {}
    try { bot.setControlState('forward', false); } catch (_) {}
}

// ── Tool equip ────────────────────────────────────────────────────────────────
function pickToolSlot(bot, blockName) {
    const name = blockName.replace('minecraft:', '');
    let toolType = null;
    for (const [type, set] of Object.entries(TOOL_PRIORITY)) {
        if (set.has(name)) { toolType = type; break; }
    }
    if (!toolType) return { hotbarSlot: -1, inventorySlot: -1 };

    let bestHotbarSlot = -1, bestTier = TIERS.length;
    for (let s = 0; s <= 8; s++) {
        const item = bot.inventory.slots[36 + s];
        if (!item) continue;
        const iname = item.name.replace('minecraft:', '');
        if (!iname.includes(toolType)) continue;
        const tier = TIERS.findIndex(t => iname.includes(t));
        const eff  = tier === -1 ? TIERS.length - 1 : tier;
        if (eff < bestTier) { bestTier = eff; bestHotbarSlot = s; }
    }
    if (bestHotbarSlot >= 0) return { hotbarSlot: bestHotbarSlot, inventorySlot: -1 };

    let bestInvSlot = -1; bestTier = TIERS.length;
    for (let s = 9; s <= 35; s++) {
        const item = bot.inventory.slots[s];
        if (!item) continue;
        const iname = item.name.replace('minecraft:', '');
        if (!iname.includes(toolType)) continue;
        const tier = TIERS.findIndex(t => iname.includes(t));
        const eff  = tier === -1 ? TIERS.length - 1 : tier;
        if (eff < bestTier) { bestTier = eff; bestInvSlot = s; }
    }
    return { hotbarSlot: -1, inventorySlot: bestInvSlot };
}

async function equip(bot, botId, blockName) {
    const { hotbarSlot, inventorySlot } = pickToolSlot(bot, blockName);

    if (hotbarSlot >= 0) {
        if (bot.quickBarSlot === hotbarSlot) return;
        bot.setQuickBarSlot(hotbarSlot);
        await sleep(50);
        return;
    }

    if (inventorySlot >= 0) {
        const item = bot.inventory.slots[inventorySlot];
        if (!item) return;
        let targetSlot = -1;
        for (let s = 0; s <= 8; s++) {
            if (!bot.inventory.slots[36 + s]) { targetSlot = s; break; }
        }
        if (targetSlot < 0) {
            let worstTier = -1;
            for (let s = 0; s <= 8; s++) {
                const ex    = bot.inventory.slots[36 + s];
                const iname = ex ? ex.name.replace('minecraft:', '') : '';
                const tier  = TIERS.findIndex(t => iname.includes(t));
                const eff   = tier === -1 ? TIERS.length : tier;
                if (eff > worstTier) { worstTier = eff; targetSlot = s; }
            }
        }
        if (targetSlot < 0) targetSlot = 0;
        try {
            await bot.inventory.move(inventorySlot, 36 + targetSlot);
            await sleep(150);
            bot.setQuickBarSlot(targetSlot);
            await sleep(50);
        } catch (err) {
            core.sendLog(botId, 'warning', `Could not move tool to hotbar: ${err.message}`);
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function inReach(bot, x, y, z, maxDist = 4.0) {
    if (!bot.entity) return false;
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0);
    const dx  = Math.max(0, Math.max(x - eye.x, eye.x - (x + 1)));
    const dy  = Math.max(0, Math.max(y - eye.y, eye.y - (y + 1)));
    const dz  = Math.max(0, Math.max(z - eye.z, eye.z - (z + 1)));
    return Math.sqrt(dx*dx + dy*dy + dz*dz) <= maxDist;
}

function isAir(name) {
    const n = name.replace('minecraft:', '');
    return n === 'air' || n === 'cave_air' || n === 'void_air';
}

function fmtPos(p) { return `(${p.x},${p.y},${p.z})`; }

function snake(lo, hi, flip) {
    const a = [];
    if (flip % 2 === 0) for (let i = lo; i <= hi; i++) a.push(i);
    else                for (let i = hi; i >= lo; i--) a.push(i);
    return a;
}

function makeBounds(x1,y1,z1,x2,y2,z2) {
    return {
        minX: Math.min(x1,x2), maxX: Math.max(x1,x2),
        minY: Math.min(y1,y2), maxY: Math.max(y1,y2),
        minZ: Math.min(z1,z2), maxZ: Math.max(z1,z2),
    };
}

// Top-down snake order: dig top layers first so blocks above are removed
// before blocks below, preventing falls onto your own dig site.
function buildQueue({ minX,maxX,minY,maxY,minZ,maxZ }) {
    const q = [];
    for (let y = maxY; y >= minY; y--)
        for (const x of snake(minX, maxX, maxY - y))
            for (const z of snake(minZ, maxZ, x))
                q.push({ x, y, z });
    return q;
}

// ── Spatial partitioning for multi-bot ───────────────────────────────────────
// Splits blocks into n spatially-contiguous zones by slicing along the
// longer horizontal axis. Each bot works a contiguous slab, minimising
// travel between consecutive blocks.
function partitionBlocks(blocks, n) {
    if (n <= 1) return [blocks];
    if (blocks.length === 0) return Array.from({ length: n }, () => []);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of blocks) {
        if (b.x < minX) minX = b.x; if (b.x > maxX) maxX = b.x;
        if (b.z < minZ) minZ = b.z; if (b.z > maxZ) maxZ = b.z;
    }

    const zones = Array.from({ length: n }, () => []);
    if ((maxX - minX) >= (maxZ - minZ)) {
        const w = (maxX - minX + 1) / n;
        for (const b of blocks)
            zones[Math.min(n-1, Math.floor((b.x - minX) / w))].push(b);
    } else {
        const w = (maxZ - minZ + 1) / n;
        for (const b of blocks)
            zones[Math.min(n-1, Math.floor((b.z - minZ) / w))].push(b);
    }
    return zones;
}

// ── Shared status broadcast ───────────────────────────────────────────────────
function broadcastSharedStatus(session, job) {
    const progress = session.mined + session.skipped;
    if (progress % 5 !== 0 && progress !== session.total) return;
    for (const id of session.botIds) {
        status(id, { active: !job.cancel, progress, total: session.total,
            mined: session.mined, skipped: session.skipped });
    }
}

function status(botId, data) {
    core.mainWindow?.webContents.send('excavation-status', { accountId: botId, ...data });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Diagnostic ────────────────────────────────────────────────────────────────
ipcMain.handle('debug-dig-one', async (_e, botId) => {
    const bot = core.activeBots.get(botId);
    if (!bot) return { success: false, error: 'Bot not connected' };
    const pos = bot.entity?.position;
    if (!pos) return { success: false, error: 'No entity position' };

    let target = null;
    outer: for (let dy = 0; dy >= -2; dy--) {
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                const bp = pos.offset(dx, dy, dz).floored();
                const b  = bot.blockAt(bp);
                if (b && !isAir(b.name) && !UNBREAKABLE.has(b.name.replace('minecraft:', ''))) {
                    target = b; break outer;
                }
            }
        }
    }
    if (!target) return { success: false, error: 'No breakable block found nearby' };

    const digTimeMs = bot.digTime(target) ?? 3000;
    const t0 = Date.now();
    const broken = await digBlock(bot, botId, target);
    return { success: true, block: target.name, position: target.position,
        digTimeMs, elapsed: Date.now()-t0, broken };
});

module.exports = { excavationJobs };