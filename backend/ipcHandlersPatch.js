// ipcHandlersPatch.js
// Adds two virtual commands used by macroBlocks.js:
//   move_ctrl <direction> <ms>  — holds a control key for N milliseconds
//   jump_once                   — performs a single jump
//
// USAGE: require('./ipcHandlersPatch') anywhere after main.js initialises,
//        e.g. add  require('./ipcHandlersPatch');  at the bottom of main.js
//        alongside the other require() calls.
'use strict';

const { ipcMain } = require('./electron-shim');
const core = require('./main');

ipcMain.handle('execute-move-ctrl', async (_e, botId, direction, ms) => {
    const bot = core.activeBots.get(botId);
    if (!bot) return { success: false, error: 'Bot not connected' };

    const validDirs = ['forward','back','left','right','sprint'];
    const dir = validDirs.includes(direction) ? direction : 'forward';
    const duration = Math.min(Math.max(parseInt(ms) || 500, 50), 10000);

    try {
        bot.setControlState(dir, true);
        await new Promise(r => setTimeout(r, duration));
        bot.setControlState(dir, false);
        return { success: true };
    } catch (err) {
        try { bot.setControlState(dir, false); } catch {}
        return { success: false, error: err.message };
    }
});

ipcMain.handle('execute-jump-once', async (_e, botId) => {
    const bot = core.activeBots.get(botId);
    if (!bot) return { success: false, error: 'Bot not connected' };
    try {
        bot.setControlState('jump', true);
        await new Promise(r => setTimeout(r, 100));
        bot.setControlState('jump', false);
        return { success: true };
    } catch (err) {
        try { bot.setControlState('jump', false); } catch {}
        return { success: false, error: err.message };
    }
});

// set-control-state: directly call bot.setControlState(control, bool)
// Controls: forward, back, left, right, jump, sprint, sneak
ipcMain.handle('set-control-state', (_e, botId, control, enabled) => {
    const bot = core.activeBots.get(botId);
    if (!bot) return { success: false, error: 'Bot not connected' };

    const valid = ['forward','back','left','right','jump','sprint','sneak'];
    if (!valid.includes(control)) return { success: false, error: `Unknown control: ${control}` };

    try {
        bot.setControlState(control, !!enabled);

        // Keep sneaking state in sync with botStates so the UI badge updates
        if (control === 'sneak') {
            const state = core.botStates.get(botId);
            if (state) {
                state.sneaking = !!enabled;
                core.sendBotUpdate(botId);
            }
        }

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});