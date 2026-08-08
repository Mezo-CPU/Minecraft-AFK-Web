// macroBlocks.js - Scratch-style Visual Block Macro Editor
'use strict';

// ─── CSS injected into <head> ─────────────────────────────────────────────────
(function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
    .bm-root { display:flex; flex-direction:column; height:100%; min-height:0; font-family:'Fira Code',monospace; overflow:hidden; background:transparent; }

    .bm-toolbar {
        display:flex; align-items:center; gap:8px; padding:8px 12px;
        background:rgba(0,0,0,0.3); border-bottom:1px solid rgba(193,68,14,0.22);
        flex-shrink:0; flex-wrap:wrap;
    }
    .bm-toolbar-title { color:#d4601a; font-size:13px; font-weight:700; letter-spacing:.5px; font-family:'Syne',sans-serif; }
    .bm-btn {
        border:none; border-radius:7px; padding:5px 12px; cursor:pointer;
        font-size:11px; font-weight:600; font-family:'Syne',sans-serif;
        letter-spacing:.5px; text-transform:uppercase; transition:opacity .15s;
    }
    .bm-btn:hover { opacity:.8; }
    .bm-btn-primary   { background:linear-gradient(135deg,#c1440e,#d4601a); color:#fff; }
    .bm-btn-secondary { background:rgba(255,255,255,0.07); color:#9a7050; border:1px solid rgba(193,68,14,0.22); }
    .bm-btn-green     { background:linear-gradient(135deg,#166534,#22c55e); color:#fff; }
    .bm-btn-danger    { background:linear-gradient(135deg,#7f1d1d,#ef4444); color:#fff; }
    .bm-btn-amber     { background:linear-gradient(135deg,#78350f,#f59e0b); color:#fff; }

    /* ── Preset toolbar section ── */
    .bm-preset-sep { width:1px; height:22px; background:rgba(193,68,14,0.22); flex-shrink:0; }
    .bm-preset-label { font-size:10px; color:#6a4828; font-family:'Syne',sans-serif; white-space:nowrap; }
    .bm-preset-select {
        background:rgba(0,0,0,0.4); border:1px solid rgba(193,68,14,0.3); border-radius:6px;
        color:#f2cba8; padding:3px 7px; font-size:10px; font-family:'Fira Code',monospace; outline:none;
        max-width:130px;
    }
    .bm-preset-select:focus { border-color:rgba(193,68,14,0.6); }

    .bm-body { display:flex; flex:1; min-height:0; overflow:hidden; }

    .bm-palette {
        width:200px; min-width:180px; background:rgba(0,0,0,0.25);
        border-right:1px solid rgba(193,68,14,0.18);
        display:flex; flex-direction:column; overflow:hidden; flex-shrink:0; min-height:0;
    }
    .bm-palette-search {
        margin:8px; padding:5px 9px; border-radius:7px;
        background:rgba(0,0,0,0.35); border:1px solid rgba(193,68,14,0.25); color:#f2cba8;
        font-size:11px; font-family:inherit; outline:none;
    }
    .bm-palette-search:focus { border-color:rgba(193,68,14,0.55); }
    .bm-palette-scroll { flex:1; overflow-y:auto; padding:0 6px 8px; }
    .bm-palette-scroll::-webkit-scrollbar { width:3px; }
    .bm-palette-scroll::-webkit-scrollbar-thumb { background:rgba(193,68,14,0.3); border-radius:3px; }
    .bm-cat-header {
        font-size:9px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
        padding:8px 6px 3px; color:rgba(154,112,80,0.7); user-select:none; font-family:'Syne',sans-serif;
    }
    .bm-palette-block {
        display:flex; align-items:center; gap:7px;
        border-radius:7px; padding:6px 8px; margin:2px 0;
        cursor:grab; font-size:11px; font-weight:600; color:#f2cba8;
        border-left:3px solid transparent;
        transition:filter .12s, transform .1s; user-select:none;
    }
    .bm-palette-block:hover { filter:brightness(1.3); transform:translateX(2px); }
    .bm-palette-block:active { cursor:grabbing; }

    .bm-canvas-wrap { flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0; min-height:0; }

    .bm-macro-tabs {
        display:flex; gap:2px; padding:6px 10px 0;
        background:rgba(0,0,0,0.2); border-bottom:1px solid rgba(193,68,14,0.18);
        flex-shrink:0; overflow-x:auto; align-items:flex-end;
    }
    .bm-macro-tabs::-webkit-scrollbar { height:3px; }
    .bm-macro-tabs::-webkit-scrollbar-thumb { background:rgba(193,68,14,0.3); }
    .bm-macro-tab {
        padding:4px 12px; border-radius:6px 6px 0 0; font-size:11px; font-weight:600;
        cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:5px;
        border:1px solid transparent; border-bottom:none; font-family:'Syne',sans-serif;
        letter-spacing:.3px; transition:background .1s;
    }
    .bm-macro-tab.active { background:rgba(193,68,14,0.18); border-color:rgba(193,68,14,0.4); color:#e8895a; }
    .bm-macro-tab:not(.active) { color:#6a4828; background:transparent; }
    .bm-macro-tab:not(.active):hover { color:#9a7050; background:rgba(255,255,255,0.03); }
    .bm-tab-del { color:#3a2210; font-size:10px; border:none; background:none; cursor:pointer; padding:0; line-height:1; }
    .bm-tab-del:hover { color:#ef4444; }
    .bm-add-tab { padding:4px 8px; font-size:16px; cursor:pointer; color:#3a2210; background:transparent; border:none; transition:color .1s; line-height:1; }
    .bm-add-tab:hover { color:#d4601a; }

    /* ── Parallel columns ── */
    .bm-sequence-wrap {
        flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column;
    }
    .bm-columns-scroll {
        flex:1; min-height:0; overflow-x:auto; overflow-y:hidden; display:flex;
    }
    .bm-columns-scroll::-webkit-scrollbar { height:4px; }
    .bm-columns-scroll::-webkit-scrollbar-thumb { background:rgba(193,68,14,0.25); border-radius:3px; }
    .bm-columns {
        display:flex; gap:0; align-items:stretch; min-width:min-content; width:100%;
    }

    /* each parallel column */
    .bm-col {
        display:flex; flex-direction:column; width:260px; min-width:240px; flex-shrink:0;
        border-right:1px solid rgba(193,68,14,0.13); min-height:0; overflow:hidden;
    }
    .bm-col:last-child { border-right:none; }

    .bm-col-header {
        display:flex; align-items:center; gap:5px;
        padding:5px 8px; background:rgba(0,0,0,0.18); border-bottom:1px solid rgba(193,68,14,0.13);
        flex-shrink:0;
    }
    .bm-col-title {
        font-size:10px; font-weight:700; letter-spacing:.8px; text-transform:uppercase;
        font-family:'Syne',sans-serif; color:#6a4828; flex:1;
    }
    .bm-col-btn {
        border:none; border-radius:4px; padding:2px 7px; cursor:pointer; font-size:9px;
        font-weight:600; font-family:'Syne',sans-serif; letter-spacing:.3px; text-transform:uppercase;
        transition:opacity .12s;
    }
    .bm-col-btn:hover { opacity:.75; }
    .bm-col-btn-add    { background:rgba(193,68,14,0.25); color:#e8895a; }
    .bm-col-btn-remove { background:rgba(127,29,29,0.35); color:#ef4444; }

    .bm-sequence {
        flex:1; min-height:0; overflow-y:auto; overflow-x:hidden;
        padding:10px 8px; display:flex; flex-direction:column; gap:5px;
        background:transparent; position:relative; align-content:flex-start;
    }
    .bm-sequence::-webkit-scrollbar { width:4px; }
    .bm-sequence::-webkit-scrollbar-thumb { background:rgba(193,68,14,0.3); border-radius:3px; }
    .bm-sequence.drag-over { outline:2px dashed rgba(212,96,26,0.4); outline-offset:-4px; border-radius:8px; }

    /* add-column button styled as a column slot */
    .bm-col-add-slot {
        display:flex; align-items:center; justify-content:center;
        width:52px; min-width:52px; flex-shrink:0; cursor:pointer;
        border-left:1px dashed rgba(193,68,14,0.15); background:transparent;
        transition:background .12s;
    }
    .bm-col-add-slot:hover { background:rgba(193,68,14,0.05); }
    .bm-col-add-slot span { color:#3a2210; font-size:20px; line-height:1; transition:color .12s; }
    .bm-col-add-slot:hover span { color:#d4601a; }

    .bm-empty-hint {
        position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:8px; pointer-events:none;
    }
    .bm-empty-icon { font-size:40px; opacity:.12; }
    .bm-empty-text { color:#3a2210; font-size:12px; text-align:center; line-height:1.7; }

    .bm-block {
        display:flex; align-items:stretch; border-radius:7px; overflow:hidden;
        user-select:none; cursor:default; flex-shrink:0;
        animation:bmDrop .15s ease-out;
    }
    @keyframes bmDrop { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
    .bm-block-notch {
        width:10px; flex-shrink:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:3px; cursor:grab;
    }
    .bm-block-notch:active { cursor:grabbing; }
    .bm-block-grip { width:3px; height:3px; border-radius:50%; background:rgba(255,255,255,0.2); }
    .bm-block-inner {
        flex:1; padding:7px 9px; display:flex; flex-direction:column; gap:5px; min-width:0;
        border-top:1px solid rgba(255,255,255,0.06);
        border-right:1px solid rgba(255,255,255,0.06);
        border-bottom:1px solid rgba(0,0,0,0.3);
        border-radius:0 7px 7px 0;
    }
    .bm-block-header { display:flex; align-items:center; gap:6px; flex-shrink:0; }
    .bm-block-icon   { font-size:12px; flex-shrink:0; }
    .bm-block-label  { font-size:11px; font-weight:700; color:#fff; font-family:'Syne',sans-serif; letter-spacing:.3px; }
    .bm-block-num    { font-size:9px; color:rgba(255,255,255,0.25); margin-left:auto; flex-shrink:0; }

    .bm-block-actions { display:flex; gap:3px; opacity:0; transition:opacity .12s; flex-shrink:0; }
    .bm-block:hover .bm-block-actions { opacity:1; }
    .bm-block-btn {
        border:none; border-radius:4px; width:20px; height:20px; cursor:pointer;
        font-size:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;
        background:rgba(0,0,0,0.35); color:#9a7050; transition:background .1s, color .1s;
    }
    .bm-block-btn:hover { background:rgba(0,0,0,0.6); color:#f2cba8; }
    .bm-block-btn.del:hover { color:#ef4444; }

    .bm-block-fields { display:flex; flex-wrap:wrap; gap:5px; flex-shrink:0; }
    .bm-field-group  { display:flex; align-items:center; gap:3px; flex-shrink:0; }
    .bm-field-lbl    { font-size:9px; color:rgba(255,255,255,0.4); white-space:nowrap; flex-shrink:0; }
    .bm-field-input, .bm-field-select {
        background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1);
        border-radius:5px; color:#f2cba8; padding:2px 6px; font-size:10px;
        font-family:'Fira Code',monospace; outline:none; flex-shrink:0;
        min-width:0;
    }
    .bm-field-input { width:80px; }
    .bm-field-input[type=number] { width:64px; }
    .bm-field-input:focus, .bm-field-select:focus { border-color:rgba(193,68,14,0.6); }

    .bm-run-bar {
        display:flex; align-items:center; gap:8px; padding:7px 12px;
        background:rgba(0,0,0,0.25); border-top:1px solid rgba(193,68,14,0.18);
        flex-shrink:0;
    }
    .bm-run-status { font-size:10px; color:#6a4828; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bm-run-status.running { color:#22c55e; }
    .bm-run-status.error   { color:#ef4444; }

    .bm-sidebar {
        width:190px; min-width:170px; background:rgba(0,0,0,0.2);
        border-left:1px solid rgba(193,68,14,0.18);
        padding:12px 10px; overflow-y:auto; display:flex; flex-direction:column;
        gap:10px; flex-shrink:0; min-height:0;
    }
    .bm-sidebar::-webkit-scrollbar { width:3px; }
    .bm-sidebar::-webkit-scrollbar-thumb { background:rgba(193,68,14,0.3); }
    .bm-s-title { font-size:9px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#3a2210; font-family:'Syne',sans-serif; }
    .bm-sidebar label { font-size:10px; color:#6a4828; display:block; margin-bottom:2px; }
    .bm-sidebar input:not([type=range]):not([type=checkbox]), .bm-sidebar select {
        width:100%; box-sizing:border-box; background:rgba(0,0,0,0.35);
        border:1px solid rgba(193,68,14,0.25); border-radius:6px; color:#f2cba8;
        padding:4px 7px; font-size:11px; font-family:inherit; outline:none;
    }
    .bm-sidebar input:not([type=range]):not([type=checkbox]):focus, .bm-sidebar select:focus { border-color:rgba(193,68,14,0.55); }
    .bm-sidebar input[type=range] { width:100%; box-sizing:border-box; padding:0; margin:0; background:transparent; border:none; outline:none; cursor:pointer; }
    .bm-loop-row { display:none; }
    .bm-block-count { color:#d4601a; font-size:22px; font-weight:700; font-family:'Syne',sans-serif; }

    /* ── Preset modal ── */
    .bm-modal-backdrop {
        position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:9000;
        display:flex; align-items:center; justify-content:center;
    }
    .bm-modal {
        background:#1a1008; border:1px solid rgba(193,68,14,0.4); border-radius:14px;
        padding:20px 22px; width:340px; max-width:90vw; display:flex; flex-direction:column; gap:14px;
        box-shadow:0 12px 48px rgba(0,0,0,0.7);
    }
    .bm-modal-title { font-family:'Syne',sans-serif; font-size:14px; font-weight:700; color:#d4601a; }
    .bm-modal input {
        width:100%; box-sizing:border-box; background:rgba(0,0,0,0.4);
        border:1px solid rgba(193,68,14,0.3); border-radius:7px; color:#f2cba8;
        padding:6px 10px; font-size:12px; font-family:'Fira Code',monospace; outline:none;
    }
    .bm-modal input:focus { border-color:rgba(193,68,14,0.65); }
    .bm-modal-row { display:flex; gap:8px; }
    .bm-modal-row .bm-btn { flex:1; }
    .bm-preset-list {
        display:flex; flex-direction:column; gap:4px; max-height:220px; overflow-y:auto;
    }
    .bm-preset-list::-webkit-scrollbar { width:3px; }
    .bm-preset-list::-webkit-scrollbar-thumb { background:rgba(193,68,14,0.3); border-radius:3px; }
    .bm-preset-item {
        display:flex; align-items:center; gap:8px;
        background:rgba(0,0,0,0.3); border:1px solid rgba(193,68,14,0.15); border-radius:8px;
        padding:7px 10px; cursor:default;
    }
    .bm-preset-item-name { flex:1; font-size:12px; color:#f2cba8; font-family:'Syne',sans-serif; }
    .bm-preset-item-count { font-size:10px; color:#6a4828; }
    .bm-preset-item-btn {
        border:none; border-radius:5px; padding:3px 9px; font-size:10px; font-weight:600;
        font-family:'Syne',sans-serif; cursor:pointer; letter-spacing:.3px; transition:opacity .12s;
    }
    .bm-preset-item-btn:hover { opacity:.8; }
    .bm-preset-load { background:rgba(193,68,14,0.3); color:#e8895a; }
    .bm-preset-del  { background:rgba(127,29,29,0.4); color:#ef4444; }
    .bm-preset-empty { color:#3a2210; font-size:11px; text-align:center; padding:14px 0; }
    `;
    document.head.appendChild(style);
})();

// ─── Block palette definition ─────────────────────────────────────────────────
const BLOCK_PALETTE = [
    {
        category: 'Chat', color: '#22c55e', icon: '💬',
        blocks: [
            { type: 'send_message', label: 'Send Message',
              fields: [{ name: 'text', placeholder: 'Hello world', type: 'text' }],
              toCommand: f => f.text || '', description: 'Send a chat message' },
            { type: 'whisper', label: 'Whisper / MSG',
              fields: [
                  { name: 'player', placeholder: 'Steve', type: 'text', label: 'Player' },
                  { name: 'text',   placeholder: 'Hello!', type: 'text', label: 'Message' },
              ],
              toCommand: f => `__cmd:w ${(f.player||'').trim()} ${(f.text||'').trim()}`, description: 'Send a private whisper/msg to a player' },
            { type: 'send_command', label: 'Run Command',
              fields: [{ name: 'cmd', placeholder: 'gamemode survival', type: 'text' }],
              toCommand: f => `__cmd:${f.cmd ? (f.cmd.startsWith('/') ? f.cmd.substring(1) : f.cmd) : ''}`, description: 'Run a slash command' },
            { type: 'repeat_message', label: 'Repeat Message',
              fields: [
                  { name: 'text',  placeholder: 'Hello!', type: 'text',   label: 'Message' },
                  { name: 'times', placeholder: '3',      type: 'number', label: 'Times' },
                  { name: 'delay', placeholder: '1000',   type: 'number', label: 'Delay ms' },
              ],
              toCommand: f => `__repeatchat ${Math.max(1,parseInt(f.times)||3)} ${Math.max(100,parseInt(f.delay)||1000)} ${(f.text||'').trim()}`, description: 'Send the same chat message N times with a delay between each' },
        ],
    },
    {
        category: 'Movement', color: '#3b82f6', icon: '🏃',
        blocks: [
            { type: 'move_forward', label: 'Move Forward',
              fields: [{ name: 'ticks', placeholder: '20', type: 'number', label: 'ticks' }],
              toCommand: f => `move_ctrl forward ${(f.ticks||20)*50}`, description: 'Walk forward N ticks' },
            { type: 'move_back', label: 'Move Back',
              fields: [{ name: 'ticks', placeholder: '20', type: 'number', label: 'ticks' }],
              toCommand: f => `move_ctrl back ${(f.ticks||20)*50}`, description: 'Walk backward N ticks' },
            { type: 'move_left', label: 'Move Left',
              fields: [{ name: 'ticks', placeholder: '20', type: 'number', label: 'ticks' }],
              toCommand: f => `move_ctrl left ${(f.ticks||20)*50}`, description: 'Strafe left N ticks' },
            { type: 'move_right', label: 'Move Right',
              fields: [{ name: 'ticks', placeholder: '20', type: 'number', label: 'ticks' }],
              toCommand: f => `move_ctrl right ${(f.ticks||20)*50}`, description: 'Strafe right N ticks' },
            { type: 'jump', label: 'Jump', fields: [],
              toCommand: () => 'jump_once', description: 'Jump once' },
            { type: 'sneak_toggle', label: 'Toggle Sneak', fields: [],
              toCommand: () => '__cmd:sneak', description: 'Toggle sneaking on/off' },
            { type: 'go_coords', label: 'Go To Coords',
              fields: [
                  { name: 'x', placeholder: '0',  type: 'number', label: 'X' },
                  { name: 'y', placeholder: '64', type: 'number', label: 'Y' },
                  { name: 'z', placeholder: '0',  type: 'number', label: 'Z' },
              ],
              toCommand: f => `__cmd:go ${f.x||0} ${f.y||64} ${f.z||0}`, description: 'Pathfind to coords' },
            { type: 'face_direction', label: 'Face Direction',
              fields: [{ name: 'dir', type: 'select', options: ['north','south','east','west'], label: 'Dir' }],
              toCommand: f => `__cmd:face ${f.dir||'north'}`, description: 'Face a compass direction' },
            { type: 'follow_player', label: 'Follow Player',
              fields: [{ name: 'player', placeholder: 'Steve', type: 'text', label: 'Player' }],
              toCommand: f => `__cmd:follow ${f.player||''}`, description: 'Start following a player' },
            { type: 'stop_follow', label: 'Stop Following', fields: [],
              toCommand: () => '__cmd:follow toggle', description: 'Stop following current target' },
            { type: 'stop_pathfinding', label: 'Stop Pathfinding', fields: [],
              toCommand: () => '__cmd:stopmovement', description: 'Cancel any active go/follow/pathfinding' },
            { type: 'sprint_toggle', label: 'Toggle Sprint', fields: [],
              toCommand: () => '__cmd:sprint', description: 'Toggle sprinting on/off' },
            { type: 'look_at_coords', label: 'Look At Coords',
              fields: [
                  { name: 'x', placeholder: '0',  type: 'number', label: 'X' },
                  { name: 'y', placeholder: '64', type: 'number', label: 'Y' },
                  { name: 'z', placeholder: '0',  type: 'number', label: 'Z' },
              ],
              toCommand: f => `__cmd:lookatcoords ${f.x||0} ${f.y||64} ${f.z||0}`, description: 'Turn the bot to face specific coordinates' },
            { type: 'respawn', label: 'Respawn', fields: [],
              toCommand: () => '__cmd:respawn', description: 'Trigger respawn after death' },
        ],
    },
    {
        category: 'Inventory', color: '#f59e0b', icon: '🎒',
        blocks: [
            { type: 'click_hotbar', label: 'Click Hotbar Slot',
              fields: [{ name: 'slot', placeholder: '1', type: 'number', label: 'Slot 1-9' }],
              toCommand: f => `__cmd:hotbar ${f.slot||1}`, description: 'Switch to hotbar slot 1-9' },
            { type: 'click_inv', label: 'Click Inventory Slot',
              fields: [
                  { name: 'slot',   placeholder: '9', type: 'number', label: 'Slot' },
                  { name: 'button', type: 'select', options: ['left','right'], label: 'Button' },
                  { name: 'times',  placeholder: '1', type: 'number', label: 'Times' },
              ],
              toCommand: f => `__clickwindow ${f.slot||9} ${f.button==='right'?1:0} ${Math.max(1,parseInt(f.times)||1)}`, description: 'Click a slot in inventory' },
            { type: 'click_container', label: 'Click Container Slot',
              fields: [
                  { name: 'slot',   placeholder: '0', type: 'number', label: 'Slot' },
                  { name: 'button', type: 'select', options: ['left','right'], label: 'Button' },
                  { name: 'times',  placeholder: '1', type: 'number', label: 'Times' },
              ],
              toCommand: f => `__clickwindow ${f.slot||0} ${f.button==='right'?1:0} ${Math.max(1,parseInt(f.times)||1)}`, description: 'Click a slot in an open container' },
            { type: 'drop_item', label: 'Drop Item',
              fields: [{ name: 'slot', placeholder: '36', type: 'number', label: 'Slot' }],
              toCommand: f => `__cmd:drop ${f.slot||36}`, description: 'Drop item from slot' },
            { type: 'drop_all', label: 'Drop All Items', fields: [],
              toCommand: () => '__cmd:drop all', description: 'Drop everything' },
            { type: 'swap_slots', label: 'Swap Slots',
              fields: [
                  { name: 'slotA', placeholder: '0', type: 'number', label: 'A' },
                  { name: 'slotB', placeholder: '9', type: 'number', label: 'B' },
              ],
              toCommand: f => `__cmd:swap ${f.slotA||0} ${f.slotB||9}`, description: 'Swap two inventory slots' },
            { type: 'use_item', label: 'Use Held Item', fields: [],
              toCommand: () => '__cmd:useitem', description: 'Activate held item' },
            { type: 'eat_food', label: 'Eat Food', fields: [],
              toCommand: () => '__cmd:eat', description: 'Eat the best available food from inventory' },
            { type: 'close_inventory', label: 'Close Inventory / Container', fields: [],
              toCommand: () => 'closewindow', description: 'Close the currently open inventory or container' },
        ],
    },
    {
        category: 'Click', color: '#ef4444', icon: '🖱️',
        blocks: [
            { type: 'left_click_once', label: 'Left Click Once', fields: [],
              toCommand: () => '__cmd:clickonce left', description: 'Perform a single left click (attack/break)' },
            { type: 'right_click_once', label: 'Right Click Once', fields: [],
              toCommand: () => '__cmd:clickonce right', description: 'Perform a single right click (use/interact)' },
            { type: 'hold_left_click', label: 'Hold Left Click',
              fields: [{ name: 'ticks', placeholder: '10', type: 'number', label: 'Ticks' }],
              toCommand: f => `__cmd:holdclick left ${Math.max(1, parseInt(f.ticks)||10)}`, description: 'Hold left click (attack) for N ticks then release' },
            { type: 'hold_right_click', label: 'Hold Right Click',
              fields: [{ name: 'ticks', placeholder: '10', type: 'number', label: 'Ticks' }],
              toCommand: f => `__cmd:holdclick right ${Math.max(1, parseInt(f.ticks)||10)}`, description: 'Hold right click (use/charge) for N ticks then release' },
            { type: 'auto_click_start', label: 'Start Auto-Click',
              fields: [
                  { name: 'button', type: 'select', options: ['left','right'], label: 'Button' },
                  { name: 'ticks',  placeholder: '2', type: 'number', label: 'Every N ticks' },
              ],
              toCommand: f => `__cmd:click ${f.button||'left'} ${f.ticks||2}`, description: 'Start auto-clicking at a set interval' },
            { type: 'auto_click_stop', label: 'Stop Auto-Click', fields: [],
              toCommand: () => '__cmd:click stop', description: 'Stop the auto-clicker' },
        ],
    },
    {
        category: 'Timing', color: '#a78bfa', icon: '⏱️',
        blocks: [
            { type: 'wait', label: 'Wait',
              fields: [{ name: 'ms', placeholder: '1000', type: 'number', label: 'ms' }],
              toCommand: f => `__wait ${f.ms||1000}`, description: 'Pause for N milliseconds' },
        ],
    },
    {
        category: 'World', color: '#f97316', icon: '🌍',
        blocks: [
            { type: 'open_nearest_chest', label: 'Open Nearest Chest',
              fields: [{ name: 'radius', placeholder: '6', type: 'number', label: 'Radius' }],
              toCommand: f => `__cmd:openchest ${Math.max(1,parseInt(f.radius)||6)}`, description: 'Walk to and open the nearest chest within N blocks' },
            { type: 'close_container', label: 'Close Container', fields: [],
              toCommand: () => 'closewindow', description: 'Close any open container or chest' },
            { type: 'activate_nearest_block', label: 'Activate Nearest Block',
              fields: [
                  { name: 'block',  placeholder: 'lever',  type: 'text',   label: 'Block' },
                  { name: 'radius', placeholder: '4',      type: 'number', label: 'Radius' },
              ],
              toCommand: f => `__cmd:activateblock ${(f.block||'').trim()} ${Math.max(1,parseInt(f.radius)||4)}`, description: 'Right-click the nearest block of the given type' },
            { type: 'attack_nearest_entity', label: 'Attack Nearest Entity',
              fields: [{ name: 'type', placeholder: 'zombie', type: 'text', label: 'Type (blank=any)' }],
              toCommand: f => `__cmd:attacknearest ${(f.type||'').trim()}`, description: 'Attack the nearest entity (optionally filter by type)' },
            { type: 'pickup_nearby_items', label: 'Pick Up Nearby Items',
              fields: [{ name: 'radius', placeholder: '8', type: 'number', label: 'Radius' }],
              toCommand: f => `__cmd:pickup ${Math.max(1,parseInt(f.radius)||8)}`, description: 'Pathfind to and pick up dropped items nearby' },
            { type: 'place_block', label: 'Place Block',
              fields: [
                  { name: 'x', placeholder: '0',  type: 'number', label: 'X' },
                  { name: 'y', placeholder: '64', type: 'number', label: 'Y' },
                  { name: 'z', placeholder: '0',  type: 'number', label: 'Z' },
              ],
              toCommand: f => `__cmd:placeblock ${f.x||0} ${f.y||64} ${f.z||0}`, description: 'Place the held block at the given coordinates' },
            { type: 'dig_block', label: 'Dig Block',
              fields: [
                  { name: 'x', placeholder: '0',  type: 'number', label: 'X' },
                  { name: 'y', placeholder: '64', type: 'number', label: 'Y' },
                  { name: 'z', placeholder: '0',  type: 'number', label: 'Z' },
              ],
              toCommand: f => `__cmd:digblock ${f.x||0} ${f.y||64} ${f.z||0}`, description: 'Dig/break the block at the given coordinates' },
            { type: 'fish_start', label: 'Start Fishing', fields: [],
              toCommand: () => '__cmd:fish start', description: 'Cast fishing rod and start auto-fishing' },
            { type: 'fish_stop', label: 'Stop Fishing', fields: [],
              toCommand: () => '__cmd:fish stop', description: 'Stop the auto-fishing loop' },
        ],
    },
    {
        category: 'Info', color: '#64748b', icon: '📊',
        blocks: [
            { type: 'print_position', label: 'Print Position', fields: [],
              toCommand: () => '__cmd:printpos', description: 'Print the bot\'s current X Y Z coordinates to chat log' },
            { type: 'print_stats', label: 'Print Health & Food', fields: [],
              toCommand: () => '__cmd:printstats', description: 'Print current health, food, and XP level to chat log' },
            { type: 'list_players', label: 'List Players', fields: [],
              toCommand: () => 'list', description: 'Log all online players to the chat log' },
            { type: 'look_at_nearest_entity', label: 'Look At Entity',
              fields: [{ name: 'type', placeholder: 'player', type: 'text', label: 'Type (blank=any)' }],
              toCommand: f => `__cmd:lookat ${(f.type||'').trim()}`, description: 'Look at the nearest entity of the given type' },
            { type: 'equip_item', label: 'Equip Item',
              fields: [
                  { name: 'item', placeholder: 'diamond_sword', type: 'text', label: 'Item Name' },
                  { name: 'dest', type: 'select', options: ['hand','off-hand','head','torso','legs','feet'], label: 'Slot' },
              ],
              toCommand: f => `__cmd:equip ${(f.item||'').trim()} ${f.dest||'hand'}`, description: 'Equip a named item from inventory to the specified slot' },
        ],
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getCat(type) { for (const c of BLOCK_PALETTE) for (const b of c.blocks) if (b.type===type) return c; return {color:'#888',icon:'?'}; }
function getDef(type) { for (const c of BLOCK_PALETTE) for (const b of c.blocks) if (b.type===type) return b; return null; }

// ─── State ────────────────────────────────────────────────────────────────────
// Macro shape: { id, name, hotkey, repeat, interval, columns: [ [block, ...], ... ] }
// For backwards compatibility, on load we migrate old { blocks:[] } to { columns:[[...]] }
let blockMacros = [];
try {
    const raw = JSON.parse(localStorage.getItem('mc_block_macros') || '[]');
    blockMacros = raw.map(m => {
        // migrate legacy flat blocks array → columns
        if (!m.columns) m.columns = [m.blocks || []];
        delete m.blocks;
        return m;
    });
} catch {}
function saveBlockMacros() { try { localStorage.setItem('mc_block_macros', JSON.stringify(blockMacros)); } catch {} }

// Presets: { name, macros[] } — a snapshot of all macros at save time
let bmPresets = [];
try { bmPresets = JSON.parse(localStorage.getItem('mc_bm_presets') || '[]'); } catch {}
function savePresets() { try { localStorage.setItem('mc_bm_presets', JSON.stringify(bmPresets)); } catch {} }

let bmActiveMacroId  = null;
let bmActiveColIndex = 0;          // which column is the drop/add target
const _bmLoops   = new Map();
const _bmToggles = new Map();
const _bmAbort   = new Map();

// ─── Main builder ─────────────────────────────────────────────────────────────
function buildBlockMacrosTab() {
    const panel = document.getElementById('tab-macros');
    if (!panel) { console.warn('[macroBlocks] #tab-macros not found'); return; }

    // Ensure the panel itself participates correctly in the flex height chain.
    // tabs.js sets overflow:hidden inline — we also need display:flex and min-height:0
    // so that the bm-root inside can fill the space and sub-columns can scroll.
    // Do NOT set display here — switchTab() controls visibility.
    // Only set the layout properties needed for internal flex chain.
    panel.style.flexDirection = 'column';
    panel.style.flex          = '1';
    panel.style.overflow      = 'hidden';
    panel.style.minHeight     = '0';
    panel.style.background    = 'transparent';

    panel.innerHTML = `
    <div class="bm-root" id="bmRoot">
      <div class="bm-toolbar">
        <span class="bm-toolbar-title">⚡ Block Macros</span>
        <button class="bm-btn bm-btn-primary"   onclick="bmNewMacro()">+ New Macro</button>
        <button class="bm-btn bm-btn-green"      id="bmRunBtn"    onclick="bmRunActive()"     style="display:none">▶ Run</button>
        <button class="bm-btn bm-btn-danger"     id="bmStopBtn"   onclick="bmStopActive()"    style="display:none">⏹ Stop</button>
        <button class="bm-btn bm-btn-secondary"  id="bmClearBtn"  onclick="bmClearSequence()" style="display:none">🗑 Clear</button>
        <button class="bm-btn bm-btn-secondary"  id="bmExportBtn" onclick="bmExportActive()"  style="display:none">⬇ Export</button>

        <div class="bm-preset-sep"></div>
        <span class="bm-preset-label">Preset:</span>
        <select class="bm-preset-select" id="bmPresetSelect" onchange="bmPresetSelectChange(this.value)">
          <option value="">— none —</option>
        </select>
        <button class="bm-btn bm-btn-amber" onclick="bmOpenPresetModal()">💾 Presets</button>
      </div>
      <div class="bm-body">
        <div class="bm-palette">
          <input class="bm-palette-search" id="bmSearch" placeholder="🔍 Search blocks…" oninput="bmFilterPalette(this.value)">
          <div class="bm-palette-scroll" id="bmPaletteScroll"></div>
        </div>
        <div class="bm-canvas-wrap">
          <div class="bm-macro-tabs" id="bmMacroTabs">
            <button class="bm-add-tab" onclick="bmNewMacro()" title="New macro">＋</button>
          </div>
          <div class="bm-sequence-wrap">
            <div class="bm-columns-scroll" id="bmColumnsScroll">
              <div class="bm-columns" id="bmColumns"></div>
            </div>
          </div>
          <div class="bm-run-bar">
            <span class="bm-run-status" id="bmStatus">No macro selected</span>
            <span id="bmBotIndicator" style="font-size:10px;color:#6a4828;white-space:nowrap;flex-shrink:0;"></span>
            <button class="bm-btn bm-btn-green" id="bmActivateBtn" onclick="bmActivate()" style="display:none;flex-shrink:0;">⚡ Activate</button>
          </div>
        </div>
        <div class="bm-sidebar" id="bmSidebar">
          <div style="color:#3a2210;font-size:11px;text-align:center;padding-top:16px;line-height:1.7;" id="bmSidebarEmpty">
            Select or create<br>a macro to begin
          </div>
          <div id="bmSidebarForm" style="display:none;flex-direction:column;gap:10px;">
            <div class="bm-s-title">Macro Settings</div>
            <div><label>Name</label><input id="bmSName" oninput="bmSaveMeta()"></div>
            <div><label>Hotkey</label><input id="bmSKey" placeholder="e.g. F5" oninput="bmSaveMeta()"></div>
            <div><label>Repeat</label>
              <select id="bmSRepeat" onchange="bmSaveMeta();bmRepeatChange()">
                <option value="once">Once</option>
                <option value="loop">Loop</option>
                <option value="toggle">Toggle</option>
              </select>
            </div>
            <div class="bm-loop-row" id="bmSLoopRow">
              <label>Interval (ms)</label>
              <input id="bmSInterval" type="number" value="1000" min="50" oninput="bmSaveMeta()">
            </div>
            <div style="border-top:1px solid rgba(193,68,14,0.15);padding-top:8px;">
              <div class="bm-s-title" style="margin-bottom:6px;">⚡ Execution Speed</div>
              <label>Speed Multiplier</label>
              <div style="display:flex;align-items:center;gap:6px;">
                <input id="bmSSpeed" type="range" min="0.25" max="10" step="0.25" value="1"
                  style="flex:1;accent-color:#d4601a;cursor:pointer;"
                  oninput="bmSaveMeta();document.getElementById('bmSSpeedVal').textContent=parseFloat(this.value).toFixed(2)+'×'">
                <span id="bmSSpeedVal" style="font-size:11px;color:#e8895a;width:38px;text-align:right;font-family:'Fira Code',monospace;">1.00×</span>
              </div>
              <div style="color:#3a2210;font-size:9px;margin-top:3px;line-height:1.5;">Scales movement &amp; action delays.<br>Wait blocks are never sped up.</div>
            </div>
            <div style="border-top:1px solid rgba(193,68,14,0.15);padding-top:8px;">
              <div class="bm-s-title" style="margin-bottom:4px;">Block Count</div>
              <div class="bm-block-count" id="bmSCount">0</div>
            </div>
            <div style="border-top:1px solid rgba(193,68,14,0.2);padding-top:8px;">
              <div class="bm-s-title" style="margin-bottom:6px;">⚡ Auto-Trigger</div>
              <label>Trigger Event</label>
              <select id="bmSTriggerType" onchange="bmSaveMeta();bmTriggerTypeChange()">
                <option value="none">— None (manual only) —</option>
                <option value="on_hit">🩸 Bot gets hit</option>
                <option value="on_chat_match">💬 Chat message contains…</option>
                <option value="on_player_enter">👁️ Player enters render distance</option>
              </select>
              <div id="bmSTriggerChatRow" style="display:none;margin-top:6px;">
                <label>Match Text (case-insensitive)</label>
                <input id="bmSTriggerChatText" placeholder="e.g. hello, attack" oninput="bmSaveMeta()">
                <label style="display:flex;align-items:center;gap:5px;margin-top:4px;cursor:pointer;">
                  <input id="bmSTriggerChatWhisper" type="checkbox" style="accent-color:#d4601a;" onchange="bmSaveMeta()">
                  <span style="font-size:10px;">Only whispers / DMs</span>
                </label>
              </div>
              <div id="bmSTriggerPlayerRow" style="display:none;margin-top:6px;">
                <label>Player Name Filter</label>
                <input id="bmSTriggerPlayerName" placeholder="Blank = any player" oninput="bmSaveMeta()">
                <div style="color:#3a2210;font-size:9px;margin-top:2px;">Separate multiple names with commas</div>
              </div>
              <div id="bmSTriggerCooldownRow" style="display:none;margin-top:6px;">
                <label>Cooldown (ms)</label>
                <input id="bmSTriggerCooldown" type="number" value="2000" min="0" oninput="bmSaveMeta()">
              </div>
            </div>
            <button class="bm-btn bm-btn-danger" style="width:100%;margin-top:4px;" onclick="bmDeleteActive()">🗑 Delete Macro</button>
          </div>
        </div>
      </div>
    </div>`;

    bmRenderPalette('');
    bmRenderPresetSelect();
    if (bmActiveMacroId === null && blockMacros.length > 0) bmActiveMacroId = blockMacros[0].id;
    bmActiveColIndex = 0;
    bmRenderTabs();
    bmRenderColumns();
    bmRenderSidebar();
}

// ─── Palette ──────────────────────────────────────────────────────────────────
function bmRenderPalette(filter) {
    const el = document.getElementById('bmPaletteScroll');
    if (!el) return;
    const q = filter.toLowerCase();
    let html = '';
    for (const cat of BLOCK_PALETTE) {
        const hits = cat.blocks.filter(b => !q || b.label.toLowerCase().includes(q) || cat.category.toLowerCase().includes(q));
        if (!hits.length) continue;
        html += `<div class="bm-cat-header" style="color:${cat.color}">${cat.icon} ${cat.category}</div>`;
        for (const b of hits) {
            html += `<div class="bm-palette-block"
                style="background:${cat.color}20;border-left-color:${cat.color};"
                draggable="true"
                ondragstart="bmPalDragStart(event,'${esc(b.type)}')"
                ondblclick="bmAddBlock('${esc(b.type)}')"
                title="${esc(b.description)} — double-click or drag">
                <span>${cat.icon}</span><span>${esc(b.label)}</span>
            </div>`;
        }
    }
    if (!html) html = `<div style="color:#3a2210;font-size:11px;padding:14px;text-align:center;">No results</div>`;
    el.innerHTML = html;
}
function bmFilterPalette(v) { bmRenderPalette(v); }

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function bmRenderTabs() {
    const bar = document.getElementById('bmMacroTabs');
    if (!bar) return;
    bar.innerHTML = blockMacros.map(m => {
        const trigBadge = m.trigger?.type && m.trigger.type !== 'none'
            ? (m.trigger.type === 'on_hit'          ? ' <span title="Triggers on hit" style="font-size:9px;">🩸</span>'
             : m.trigger.type === 'on_chat_match'   ? ' <span title="Triggers on chat match" style="font-size:9px;">💬</span>'
             : m.trigger.type === 'on_player_enter' ? ' <span title="Triggers on player enter" style="font-size:9px;">👁️</span>'
             : '') : '';
        return `
        <div class="bm-macro-tab ${bmActiveMacroId===m.id?'active':''}" onclick="bmSelectMacro(${m.id})">
            <span>${esc(m.name||'Untitled')}${trigBadge}</span>
            <button class="bm-tab-del" onclick="event.stopPropagation();bmDeleteMacro(${m.id})">✕</button>
        </div>`}).join('')
        + `<button class="bm-add-tab" onclick="bmNewMacro()" title="New macro">＋</button>`;

    const has = bmActiveMacroId !== null;
    ['bmRunBtn','bmStopBtn','bmClearBtn','bmExportBtn'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = has ? '' : 'none';
    });
    bmUpdateBotIndicator();
}

function bmSelectMacro(id) {
    bmActiveMacroId = id; bmActiveColIndex = 0;
    bmRenderTabs(); bmRenderColumns(); bmRenderSidebar();
}
function bmNewMacro() {
    const m = { id: Date.now(), name: `Macro ${blockMacros.length+1}`, hotkey:'', repeat:'once', interval:1000, speed:1, columns:[[]] };
    blockMacros.push(m); saveBlockMacros(); bmSelectMacro(m.id);
}
function bmDeleteActive() { if (bmActiveMacroId!==null) bmDeleteMacro(bmActiveMacroId); }
function bmDeleteMacro(id) {
    if (!confirm('Delete this macro?')) return;
    _bmStopLoop(id);
    blockMacros = blockMacros.filter(m => m.id !== id);
    saveBlockMacros();
    bmActiveMacroId = blockMacros.length > 0 ? blockMacros[blockMacros.length-1].id : null;
    bmActiveColIndex = 0;
    bmRenderTabs(); bmRenderColumns(); bmRenderSidebar();
}

// ─── Column management ────────────────────────────────────────────────────────
function bmActiveMacro() { return blockMacros.find(m => m.id === bmActiveMacroId) || null; }

function bmEnsureColumns(macro) {
    if (!macro.columns || !macro.columns.length) macro.columns = [[]];
}

function bmAddColumn() {
    const macro = bmActiveMacro(); if (!macro) return;
    bmEnsureColumns(macro);
    macro.columns.push([]);
    bmActiveColIndex = macro.columns.length - 1;
    saveBlockMacros(); bmRenderColumns(); bmRenderSidebar();
}

function bmRemoveColumn(colIdx) {
    const macro = bmActiveMacro(); if (!macro) return;
    bmEnsureColumns(macro);
    if (macro.columns.length <= 1) { alert('A macro needs at least one column.'); return; }
    if (!confirm('Remove this column and all its blocks?')) return;
    macro.columns.splice(colIdx, 1);
    if (bmActiveColIndex >= macro.columns.length) bmActiveColIndex = macro.columns.length - 1;
    saveBlockMacros(); bmRenderColumns(); bmRenderSidebar();
}

// ─── Columns renderer ─────────────────────────────────────────────────────────
function bmRenderColumns() {
    const wrap = document.getElementById('bmColumns');
    if (!wrap) return;
    wrap.innerHTML = '';

    const macro = bmActiveMacro();
    if (!macro) {
        wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;color:#3a2210;font-size:12px;">No macro selected</div>`;
        bmSetStatus('No macro selected');
        bmSetCount(0);
        return;
    }
    bmEnsureColumns(macro);

    macro.columns.forEach((col, colIdx) => {
        const colEl = document.createElement('div');
        colEl.className = 'bm-col';

        // header
        const hdr = document.createElement('div');
        hdr.className = 'bm-col-header';
        hdr.innerHTML = `
            <span class="bm-col-title">${macro.columns.length > 1 ? `Track ${colIdx+1}` : 'Sequence'}</span>
            <button class="bm-col-btn bm-col-btn-add" onclick="bmAddBlock(null,${colIdx})" title="Add block to this column">＋ Block</button>
            ${macro.columns.length > 1 ? `<button class="bm-col-btn bm-col-btn-remove" onclick="bmRemoveColumn(${colIdx})" title="Remove column">✕</button>` : ''}
        `;
        colEl.appendChild(hdr);

        // sequence drop zone
        const seq = document.createElement('div');
        seq.className = 'bm-sequence';
        seq.dataset.col = colIdx;
        seq.ondragover  = e => bmDragOver(e, colIdx);
        seq.ondrop      = e => bmDropOnSeq(e, colIdx);
        seq.ondragleave = e => bmDragLeave(e);

        if (!col.length) {
            const hint = document.createElement('div');
            hint.className = 'bm-empty-hint';
            hint.innerHTML = `<div class="bm-empty-icon">🧩</div><div class="bm-empty-text">Drag blocks here<br>or double-click palette</div>`;
            seq.appendChild(hint);
        } else {
            col.forEach((step, idx) => {
                const blockEl = bmMakeBlockEl(step, idx, colIdx);
                if (blockEl) seq.appendChild(blockEl);
            });
        }

        colEl.appendChild(seq);
        wrap.appendChild(colEl);
    });

    // add-column slot
    const addSlot = document.createElement('div');
    addSlot.className = 'bm-col-add-slot';
    addSlot.title = 'Add parallel column (runs simultaneously)';
    addSlot.onclick = () => bmAddColumn();
    addSlot.innerHTML = `<span>＋</span>`;
    wrap.appendChild(addSlot);

    const totalBlocks = macro.columns.reduce((s, c) => s + c.length, 0);
    bmSetCount(totalBlocks);
    const running = _bmLoops.has(bmActiveMacroId) || _bmToggles.get(bmActiveMacroId);
    bmSetStatus(running ? `▶ Running "${macro.name}"…` : `${totalBlocks} block${totalBlocks!==1?'s':''} — ready`, running ? 'running' : '');
}

function bmMakeBlockEl(step, idx, colIdx) {
    const def = getDef(step.type); if (!def) return null;
    const cat = getCat(step.type);
    let fieldsHtml = '';
    (def.fields || []).forEach(f => {
        const val = step.fields?.[f.name] ?? (f.type==='select' ? f.options[0] : '');
        if (f.type === 'select') {
            const opts = f.options.map(o => `<option value="${esc(o)}" ${val===o?'selected':''}>${esc(o)}</option>`).join('');
            fieldsHtml += `<div class="bm-field-group">${f.label?`<span class="bm-field-lbl">${esc(f.label)}</span>`:''}<select class="bm-field-select" onchange="bmFieldSet(${bmActiveMacroId},${colIdx},${idx},'${esc(f.name)}',this.value)">${opts}</select></div>`;
        } else {
            fieldsHtml += `<div class="bm-field-group">${f.label?`<span class="bm-field-lbl">${esc(f.label)}</span>`:''}<input class="bm-field-input" type="${f.type}" value="${esc(val)}" placeholder="${esc(f.placeholder||'')}" oninput="bmFieldSet(${bmActiveMacroId},${colIdx},${idx},'${esc(f.name)}',this.value)"></div>`;
        }
    });

    const div = document.createElement('div');
    div.className = 'bm-block'; div.dataset.idx = idx; div.dataset.col = colIdx; div.draggable = true;
    div.innerHTML = `
        <div class="bm-block-notch" style="background:${cat.color};" title="Drag to reorder">
            <div class="bm-block-grip"></div><div class="bm-block-grip"></div><div class="bm-block-grip"></div>
        </div>
        <div class="bm-block-inner" style="background:${cat.color}15;">
            <div class="bm-block-header">
                <span class="bm-block-icon">${cat.icon}</span>
                <span class="bm-block-label">${esc(def.label)}</span>
                <span class="bm-block-num">#${idx+1}</span>
                <div class="bm-block-actions">
                    <button class="bm-block-btn" onclick="bmMoveBlock(${colIdx},${idx},-1)" title="Up">▲</button>
                    <button class="bm-block-btn" onclick="bmMoveBlock(${colIdx},${idx},1)"  title="Down">▼</button>
                    <button class="bm-block-btn" onclick="bmDupBlock(${colIdx},${idx})"    title="Duplicate">⧉</button>
                    <button class="bm-block-btn del" onclick="bmRemoveBlock(${colIdx},${idx})" title="Remove">✕</button>
                </div>
            </div>
            ${fieldsHtml ? `<div class="bm-block-fields">${fieldsHtml}</div>` : ''}
        </div>`;
    div.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/bm-reorder', JSON.stringify({ idx, colIdx }));
        e.dataTransfer.effectAllowed = 'move';
    });
    return div;
}

function bmSetStatus(msg, cls) {
    const el = document.getElementById('bmStatus'); if (!el) return;
    el.textContent = msg; el.className = 'bm-run-status' + (cls ? ' '+cls : '');
}
function bmSetCount(n) { const el = document.getElementById('bmSCount'); if (el) el.textContent = n; }

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function bmRenderSidebar() {
    const macro = bmActiveMacro();
    const empty = document.getElementById('bmSidebarEmpty');
    const form  = document.getElementById('bmSidebarForm');
    if (!form || !empty) return;
    if (!macro) { empty.style.display=''; form.style.display='none'; return; }
    empty.style.display = 'none'; form.style.display = 'flex';
    document.getElementById('bmSName').value     = macro.name     || '';
    document.getElementById('bmSKey').value      = macro.hotkey   || '';
    document.getElementById('bmSRepeat').value   = macro.repeat   || 'once';
    document.getElementById('bmSInterval').value = macro.interval || 1000;
    const spd = macro.speed ?? 1;
    const spdEl = document.getElementById('bmSSpeed');
    const spdVal = document.getElementById('bmSSpeedVal');
    if (spdEl) spdEl.value = spd;
    if (spdVal) spdVal.textContent = parseFloat(spd).toFixed(2) + '×';
    bmRepeatChange();

    // ── Restore trigger fields ──
    const trig = macro.trigger || {};
    const trigType = trig.type || 'none';
    const trigEl = document.getElementById('bmSTriggerType');
    if (trigEl) trigEl.value = trigType;
    const chatText = document.getElementById('bmSTriggerChatText');
    if (chatText) chatText.value = trig.chatText || '';
    const chatWhisper = document.getElementById('bmSTriggerChatWhisper');
    if (chatWhisper) chatWhisper.checked = trig.chatWhisperOnly || false;
    const playerName = document.getElementById('bmSTriggerPlayerName');
    if (playerName) playerName.value = trig.playerName || '';
    const cooldown = document.getElementById('bmSTriggerCooldown');
    if (cooldown) cooldown.value = trig.cooldown ?? 2000;
    bmTriggerTypeChange();

    const total = macro.columns.reduce((s, c) => s + c.length, 0);
    bmSetCount(total);
}
function bmRepeatChange() {
    const rep = document.getElementById('bmSRepeat')?.value;
    const row = document.getElementById('bmSLoopRow');
    if (row) row.style.display = rep==='loop' ? 'block' : 'none';
}
function bmTriggerTypeChange() {
    const type = document.getElementById('bmSTriggerType')?.value || 'none';
    const show = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? 'block' : 'none'; };
    show('bmSTriggerChatRow',     type === 'on_chat_match');
    show('bmSTriggerPlayerRow',   type === 'on_player_enter');
    show('bmSTriggerCooldownRow', type !== 'none');
}
function bmSaveMeta() {
    const macro = bmActiveMacro(); if (!macro) return;
    macro.name     = document.getElementById('bmSName')?.value     || 'Untitled';
    macro.hotkey   = document.getElementById('bmSKey')?.value      || '';
    macro.repeat   = document.getElementById('bmSRepeat')?.value   || 'once';
    macro.interval = parseInt(document.getElementById('bmSInterval')?.value) || 1000;
    macro.speed    = parseFloat(document.getElementById('bmSSpeed')?.value)  || 1;

    const trigType = document.getElementById('bmSTriggerType')?.value || 'none';
    macro.trigger  = trigType === 'none' ? null : {
        type:            trigType,
        chatText:        document.getElementById('bmSTriggerChatText')?.value.trim()   || '',
        chatWhisperOnly: document.getElementById('bmSTriggerChatWhisper')?.checked     || false,
        playerName:      document.getElementById('bmSTriggerPlayerName')?.value.trim() || '',
        cooldown:        parseInt(document.getElementById('bmSTriggerCooldown')?.value) || 2000,
    };

    saveBlockMacros(); bmRenderTabs();
}

// ─── Drag & drop ──────────────────────────────────────────────────────────────
function bmPalDragStart(e, type) { e.dataTransfer.setData('text/bm-palette', type); e.dataTransfer.effectAllowed = 'copy'; }

function bmDragOver(e, colIdx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('text/bm-reorder') ? 'move' : 'copy';
    e.currentTarget.classList.add('drag-over');
}
function bmDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}
function bmDropOnSeq(e, colIdx) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const reorderRaw = e.dataTransfer.getData('text/bm-reorder');
    const pal        = e.dataTransfer.getData('text/bm-palette');
    if (reorderRaw) {
        try {
            const { idx: fromIdx, colIdx: fromCol } = JSON.parse(reorderRaw);
            const macro = bmActiveMacro(); if (!macro) return;
            bmEnsureColumns(macro);
            const tgtBlock = e.target.closest('.bm-block');
            const toIdx    = tgtBlock ? parseInt(tgtBlock.dataset.idx) : -1;
            const block    = macro.columns[fromCol].splice(fromIdx, 1)[0];
            if (!macro.columns[colIdx]) macro.columns[colIdx] = [];
            const at = toIdx < 0 ? macro.columns[colIdx].length : (fromCol === colIdx && toIdx > fromIdx ? toIdx - 1 : toIdx);
            macro.columns[colIdx].splice(Math.max(0, at), 0, block);
            saveBlockMacros(); bmRenderColumns();
        } catch {}
    } else if (pal) {
        bmActiveColIndex = colIdx;
        bmAddBlock(pal, colIdx);
    }
}

// ─── Block CRUD ───────────────────────────────────────────────────────────────
// colIdx defaults to bmActiveColIndex if null/undefined
function bmAddBlock(type, colIdx) {
    if (type === null) {
        // called from column header "＋ Block" with no palette type — just focus that column
        bmActiveColIndex = colIdx;
        return;
    }
    if (!bmActiveMacroId) bmNewMacro();
    const macro = bmActiveMacro(); if (!macro) return;
    bmEnsureColumns(macro);
    const ci = (colIdx !== undefined && colIdx !== null) ? colIdx : bmActiveColIndex;
    if (!macro.columns[ci]) macro.columns[ci] = [];
    const def = getDef(type); if (!def) return;
    const fields = {};
    (def.fields||[]).forEach(f => { fields[f.name] = f.type==='select' ? f.options[0] : (f.placeholder||''); });
    macro.columns[ci].push({ type, fields });
    saveBlockMacros(); bmRenderColumns(); bmRenderSidebar();
    // scroll to bottom of that column
    const seqEls = document.querySelectorAll('.bm-sequence');
    if (seqEls[ci]) seqEls[ci].scrollTop = seqEls[ci].scrollHeight;
}

function bmRemoveBlock(colIdx, idx) {
    const m=bmActiveMacro(); if(!m) return;
    bmEnsureColumns(m);
    m.columns[colIdx].splice(idx,1); saveBlockMacros(); bmRenderColumns(); bmRenderSidebar();
}
function bmMoveBlock(colIdx, idx, dir) {
    const m=bmActiveMacro(); if(!m) return;
    bmEnsureColumns(m);
    const col = m.columns[colIdx];
    const t=idx+dir; if(t<0||t>=col.length) return;
    [col[idx],col[t]]=[col[t],col[idx]]; saveBlockMacros(); bmRenderColumns();
}
function bmDupBlock(colIdx, idx) {
    const m=bmActiveMacro(); if(!m) return;
    bmEnsureColumns(m);
    m.columns[colIdx].splice(idx+1,0,JSON.parse(JSON.stringify(m.columns[colIdx][idx])));
    saveBlockMacros(); bmRenderColumns(); bmRenderSidebar();
}
function bmFieldSet(macroId, colIdx, idx, name, value) {
    const m=blockMacros.find(m=>m.id===macroId); if(!m) return;
    bmEnsureColumns(m);
    if(!m.columns[colIdx]?.[idx]) return;
    if(!m.columns[colIdx][idx].fields) m.columns[colIdx][idx].fields={};
    m.columns[colIdx][idx].fields[name]=value; saveBlockMacros();
}
function bmClearSequence() {
    const m=bmActiveMacro(); if(!m) return;
    bmEnsureColumns(m);
    const total = m.columns.reduce((s,c)=>s+c.length,0);
    if(!total) return;
    if(!confirm('Remove all blocks from all columns?')) return;
    m.columns = [[]]; saveBlockMacros(); bmRenderColumns(); bmRenderSidebar();
}

// ─── Compile + run ────────────────────────────────────────────────────────────
// Compile a single column into a command list
function bmCompileCol(col) {
    return col.map(s=>{ const d=getDef(s.type); return d?d.toCommand(s.fields||{}):null; }).filter(Boolean);
}

async function bmRun(id) {
    const macro=blockMacros.find(m=>m.id===id); if(!macro) return;
    bmEnsureColumns(macro);

    // Flatten all columns into command arrays — one per column
    const colCmds = macro.columns.map(col => bmCompileCol(col)).filter(c => c.length > 0);
    if (!colCmds.length) { bmSetStatus('No blocks to run'); return; }

    if (macro.repeat==='loop') {
        if (_bmLoops.has(id)) { _bmStopLoop(id); }
        else {
            _bmLoops.set(id, true);
            _bmLoopTick(id, macro, colCmds);
        }
    } else if (macro.repeat==='toggle') {
        if (_bmToggles.get(id)) { _bmToggles.set(id,false); bmSetStatus('Stopped'); }
        else {
            _bmToggles.set(id,true);
            const tok = { cancelled: false };
            _bmAbort.set(id, tok);
            await _bmExecParallel(macro, colCmds, tok);
            _bmToggles.delete(id);
            _bmAbort.delete(id);
        }
    } else {
        const tok = { cancelled: false };
        _bmAbort.set(id, tok);
        await _bmExecParallel(macro, colCmds, tok);
        _bmAbort.delete(id);
    }
    if (id===bmActiveMacroId) bmRenderColumns();
}

async function _bmLoopTick(id, macro, colCmds) {
    if (!_bmLoops.has(id)) return;
    const tok = { cancelled: false };
    _bmAbort.set(id, tok);
    await _bmExecParallel(macro, colCmds, tok);
    _bmAbort.delete(id);
    if (!_bmLoops.has(id)) return;
    await new Promise(r => setTimeout(r, macro.interval || 1000));
    if (!_bmLoops.has(id)) return;
    _bmLoopTick(id, macro, colCmds);
}

function bmRunActive()  { if (bmActiveMacroId) bmRun(bmActiveMacroId); }
function bmStopActive() {
    if (!bmActiveMacroId) return;
    _bmStopLoop(bmActiveMacroId);
    bmSetStatus('Stopped');
    bmRenderColumns();
}

// ─── Activate button ──────────────────────────────────────────────────────────
function bmActivate() {
    const sel    = (typeof selectedBots !== 'undefined' && selectedBots.size > 1) ? selectedBots : null;
    const single = (typeof activeBotId  !== 'undefined') ? activeBotId : null;
    if (!sel && single === null) {
        bmSetStatus('No bot selected — pick one from the sidebar', 'error');
        return;
    }
    bmRunActive();
}

function bmUpdateBotIndicator() {
    const indicator   = document.getElementById('bmBotIndicator');
    const activateBtn = document.getElementById('bmActivateBtn');
    if (!indicator) return;

    const sel    = (typeof selectedBots !== 'undefined' && selectedBots.size > 1) ? selectedBots : null;
    const single = (typeof activeBotId  !== 'undefined') ? activeBotId : null;

    if (sel) {
        // Multi-bot mode
        const allOnline = Array.from(sel).every(id =>
            typeof bots !== 'undefined' && bots[id]?.status === 'online'
        );
        indicator.textContent = `🤖 ${sel.size} bots selected`;
        indicator.style.color = allOnline ? '#22c55e' : '#f59e0b';
        if (activateBtn) activateBtn.style.display = bmActiveMacroId !== null ? '' : 'none';
    } else if (single !== null && typeof bots !== 'undefined' && bots[single]) {
        const online = bots[single].status === 'online';
        indicator.textContent = `🤖 ${bots[single].name} (${online ? 'online' : bots[single].status})`;
        indicator.style.color = online ? '#22c55e' : '#6a4828';
        if (activateBtn) activateBtn.style.display = bmActiveMacroId !== null ? '' : 'none';
    } else {
        indicator.textContent = 'No bot selected';
        indicator.style.color = '#3a2210';
        if (activateBtn) activateBtn.style.display = 'none';
    }
}
function _bmStopLoop(id) {
    const tok = _bmAbort.get(id);
    if (tok) tok.cancelled = true;
    _bmAbort.delete(id);
    _bmLoops.delete(id);
    _bmToggles.delete(id);
}

// Run all columns in parallel — each column is an independent async sequence.
// If multiple bots are selected (selectedBots.size > 1), the macro runs on
// ALL of them simultaneously. Otherwise falls back to activeBotId.
async function _bmExecParallel(macro, colCmds, tok) {
    // Resolve which bots to target
    const sel = (typeof selectedBots !== 'undefined' && selectedBots.size > 1)
        ? Array.from(selectedBots)
        : null;
    const single = (typeof activeBotId !== 'undefined') ? activeBotId : null;
    const botIds = sel ?? (single !== null ? [single] : []);

    if (botIds.length === 0) { bmSetStatus('No bot selected', 'error'); return; }

    const label = botIds.length > 1 ? `${botIds.length} bots` : (
        (typeof bots !== 'undefined' && bots[botIds[0]])
            ? bots[botIds[0]].name
            : `Bot ${botIds[0]}`
    );
    bmSetStatus(`Running "${macro.name}" on ${label}…`, 'running');

    // For each bot, launch all its columns in parallel; then wait for all bots
    await Promise.all(
        botIds.flatMap(botId =>
            colCmds.map(cmds => _bmExecCol(botId, macro, cmds, tok))
        )
    );

    if (!tok?.cancelled) {
        const loop = _bmLoops.has(macro.id);
        bmSetStatus(loop ? `Looping "${macro.name}" on ${label}…` : `Done ✓ (${label})`, loop ? 'running' : '');
    }
}

// Execute one column's command list sequentially
async function _bmExecCol(botId, macro, cmds, tok) {
    const speed = Math.max(0.1, macro.speed ?? 1);
    for (const cmd of cmds) {
        if (!cmd) continue;
        if (tok?.cancelled) break;

        if (cmd.startsWith('__wait ')) {
            // Wait blocks are NEVER sped up — always use the raw ms value
            const total = parseInt(cmd.split(' ')[1]) || 1000;
            const slice = 50;
            let elapsed = 0;
            while (elapsed < total) {
                if (tok?.cancelled) break;
                const step = Math.min(slice, total - elapsed);
                await new Promise(r => setTimeout(r, step));
                elapsed += step;
            }
            continue;
        }

        if (cmd.startsWith('move_ctrl ')) {
            if (tok?.cancelled) break;
            const p = cmd.split(' ');
            const rawMs = parseInt(p[2]) || 1000;
            const scaledMs = Math.max(1, Math.round(rawMs / speed));
            if (!window.api?.executeMoveCtrl) { bmSetStatus('executeMoveCtrl missing in preload', 'error'); }
            else { await window.api.executeMoveCtrl(botId, p[1], scaledMs); }
            continue;
        }

        if (cmd === 'jump_once') {
            if (tok?.cancelled) break;
            if (!window.api?.executeJumpOnce) { bmSetStatus('executeJumpOnce missing in preload', 'error'); }
            else { await window.api.executeJumpOnce(botId); }
            continue;
        }

        if (cmd === 'closewindow') {
            if (tok?.cancelled) break;
            await window.api.executeCommand(botId, 'closewindow');
            continue;
        }

        if (tok?.cancelled) break;
        // Inter-block delay: scales from 80ms at 1× down to 5ms at max speed.
        // The 5ms floor is intentional — it gives the event loop a tick between
        // IPC calls so commands never get dropped or raced at high speeds.
        const interDelay = Math.max(5, Math.round(80 / speed));
        await new Promise(r => setTimeout(r, interDelay));
        if (tok?.cancelled) break;

        if (cmd.startsWith('__clickwindow ')) {
            // format: __clickwindow <slot> <button> <times>
            const parts = cmd.split(' ');
            const slot   = parts[1] || '0';
            const button = parts[2] || '0';
            const times  = Math.max(1, parseInt(parts[3]) || 1);
            const clickDelay = Math.max(5, Math.round(80 / speed));
            for (let t = 0; t < times; t++) {
                if (tok?.cancelled) break;
                await window.api.executeCommand(botId, `clickwindow ${slot} ${button}`);
                if (t < times - 1) await new Promise(r => setTimeout(r, clickDelay));
            }
        } else if (cmd.startsWith('__repeatchat ')) {
            // format: __repeatchat <times> <delayMs> <message...>
            const parts   = cmd.split(' ');
            const times   = Math.max(1, parseInt(parts[1]) || 3);
            const delayMs = Math.max(100, parseInt(parts[2]) || 1000);
            const message = parts.slice(3).join(' ');
            for (let t = 0; t < times; t++) {
                if (tok?.cancelled) break;
                await window.api.sendChat(botId, message);
                if (t < times - 1) {
                    const slice = 50; let elapsed = 0;
                    while (elapsed < delayMs) {
                        if (tok?.cancelled) break;
                        await new Promise(r => setTimeout(r, Math.min(slice, delayMs - elapsed)));
                        elapsed += slice;
                    }
                }
            }
        } else if (cmd.startsWith('__cmd:')) {
            await window.api.executeCommand(botId, cmd.substring(6));
        } else if (cmd.startsWith('/')) {
            await window.api.executeCommand(botId, cmd.substring(1));
        } else {
            await window.api.sendChat(botId, cmd);
        }
        if (typeof sessionStats !== 'undefined') sessionStats.commandsExecuted++;
    }
}

function bmExportActive() {
    const macro=bmActiveMacro(); if(!macro) return;
    bmEnsureColumns(macro);
    let text = `# ${macro.name}\n# Hotkey: ${macro.hotkey||'none'} | Repeat: ${macro.repeat}\n\n`;
    macro.columns.forEach((col, i) => {
        if (macro.columns.length > 1) text += `## Track ${i+1}\n`;
        text += bmCompileCol(col).join('\n') + '\n\n';
    });
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text.trim()],{type:'text/plain'}));
    a.download=`${macro.name.replace(/[^a-z0-9]/gi,'_')}.txt`; a.click();
}

// ─── Presets ──────────────────────────────────────────────────────────────────
function bmRenderPresetSelect() {
    const sel = document.getElementById('bmPresetSelect');
    if (!sel) return;
    sel.innerHTML = `<option value="">— none —</option>`
        + bmPresets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
}

function bmPresetSelectChange(val) {
    if (val === '') return;
    const idx = parseInt(val);
    if (isNaN(idx) || !bmPresets[idx]) return;
    if (!confirm(`Load preset "${bmPresets[idx].name}"? This will replace all current macros.`)) {
        // reset selector
        document.getElementById('bmPresetSelect').value = '';
        return;
    }
    bmLoadPreset(idx);
    document.getElementById('bmPresetSelect').value = '';
}

function bmLoadPreset(idx) {
    const preset = bmPresets[idx]; if (!preset) return;
    // Deep-clone so edits don't mutate the preset
    blockMacros = JSON.parse(JSON.stringify(preset.macros)).map(m => {
        // ensure columns
        if (!m.columns) m.columns = [m.blocks || []];
        delete m.blocks;
        return m;
    });
    bmActiveMacroId = blockMacros.length > 0 ? blockMacros[0].id : null;
    bmActiveColIndex = 0;
    saveBlockMacros();
    bmRenderTabs(); bmRenderColumns(); bmRenderSidebar();
    bmSetStatus(`Preset "${preset.name}" loaded`);
}

function bmSavePreset(name) {
    if (!name.trim()) return;
    // deep clone current macros into the preset
    const snap = JSON.parse(JSON.stringify(blockMacros));
    const existing = bmPresets.findIndex(p => p.name.toLowerCase() === name.trim().toLowerCase());
    if (existing >= 0) {
        if (!confirm(`Overwrite preset "${name.trim()}"?`)) return;
        bmPresets[existing] = { name: name.trim(), macros: snap };
    } else {
        bmPresets.push({ name: name.trim(), macros: snap });
    }
    savePresets(); bmRenderPresetSelect();
    return true;
}

function bmDeletePreset(idx) {
    if (!confirm(`Delete preset "${bmPresets[idx]?.name}"?`)) return;
    bmPresets.splice(idx, 1);
    savePresets(); bmRenderPresetSelect(); bmOpenPresetModal(); // refresh modal
}

function bmOpenPresetModal() {
    // Remove old modal if present
    document.getElementById('bmPresetModal')?.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'bm-modal-backdrop';
    backdrop.id = 'bmPresetModal';
    backdrop.onclick = e => { if (e.target === backdrop) backdrop.remove(); };

    const listHtml = bmPresets.length === 0
        ? `<div class="bm-preset-empty">No saved presets yet.</div>`
        : bmPresets.map((p, i) => `
            <div class="bm-preset-item">
                <span class="bm-preset-item-name">${esc(p.name)}</span>
                <span class="bm-preset-item-count">${p.macros.length} macro${p.macros.length!==1?'s':''}</span>
                <button class="bm-preset-item-btn bm-preset-load" onclick="bmLoadPreset(${i});document.getElementById('bmPresetModal')?.remove()">Load</button>
                <button class="bm-preset-item-btn bm-preset-del"  onclick="bmDeletePreset(${i})">✕</button>
            </div>`).join('');

    backdrop.innerHTML = `
        <div class="bm-modal">
            <div class="bm-modal-title">💾 Macro Presets</div>
            <div>
                <label style="font-size:10px;color:#6a4828;margin-bottom:4px;display:block;">Save current macros as preset:</label>
                <input id="bmPresetNameInput" placeholder="Preset name…" style="margin-bottom:6px;">
                <div class="bm-modal-row">
                    <button class="bm-btn bm-btn-green" onclick="
                        const n=document.getElementById('bmPresetNameInput').value;
                        if(bmSavePreset(n)){document.getElementById('bmPresetModal')?.remove();bmOpenPresetModal();}
                    ">💾 Save</button>
                    <button class="bm-btn bm-btn-secondary" onclick="document.getElementById('bmPresetModal')?.remove()">Cancel</button>
                </div>
            </div>
            <div style="border-top:1px solid rgba(193,68,14,0.18);padding-top:10px;">
                <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#3a2210;font-family:'Syne',sans-serif;margin-bottom:8px;">Saved Presets</div>
                <div class="bm-preset-list">${listHtml}</div>
            </div>
        </div>`;

    document.body.appendChild(backdrop);
    document.getElementById('bmPresetNameInput')?.focus();
}

// ─── Auto-Trigger listeners ───────────────────────────────────────────────────
// Fires bmRun(id) for any block macro whose trigger conditions match.
// Runs independently from the tabs.js text-macro trigger system.
(function bmInitTriggers() {
    const lastFired = new Map(); // macroId → timestamp

    function canFire(macro) {
        const trig = macro?.trigger;
        if (!trig || trig.type === 'none' || !trig.type) return false;
        const botId = (typeof activeBotId !== 'undefined') ? activeBotId : null;
        if (botId === null) return false;
        const now  = Date.now();
        const last = lastFired.get(macro.id) || 0;
        if (now - last < (trig.cooldown ?? 2000)) return false;
        return true;
    }

    function fire(macro) {
        lastFired.set(macro.id, Date.now());
        bmRun(macro.id);
        const statusEl = document.getElementById('bmStatus');
        if (statusEl) bmSetStatus(`⚡ Triggered: "${macro.name}"`, 'running');
    }

    function eachTrigger(type, test) {
        blockMacros.forEach(macro => {
            const trig = macro?.trigger;
            if (!trig || trig.type !== type) return;
            if (!canFire(macro)) return;
            if (test && !test(trig)) return;
            fire(macro);
        });
    }

    // ── on_hit: detect health drops via bot-update ──
    let _prevHealth = {};
    if (typeof window.api?.onBotUpdate === 'function') {
        window.api.onBotUpdate(data => {
            if (data.health === undefined || data.accountId === undefined) return;
            const prev = _prevHealth[data.accountId];
            if (prev !== undefined && data.health < prev) {
                const botId = (typeof activeBotId !== 'undefined') ? activeBotId : null;
                if (data.accountId === botId) {
                    eachTrigger('on_hit', () => true);
                }
            }
            _prevHealth[data.accountId] = data.health;
        });
    }

    // ── on_chat_match: watch chat logs ──
    if (typeof window.api?.onLog === 'function') {
        window.api.onLog(data => {
            if (data.type !== 'chat') return;
            const botId = (typeof activeBotId !== 'undefined') ? activeBotId : null;
            if (data.accountId !== botId) return;
            const msg       = (data.message || '').toLowerCase();
            const isWhisper = /^[\w_]+ whispers(?: to you)?:/i.test(data.message || '');
            eachTrigger('on_chat_match', trig => {
                const text = (trig.chatText || '').trim().toLowerCase();
                if (text && !msg.includes(text)) return false;
                if (trig.chatWhisperOnly && !isWhisper) return false;
                return true;
            });
        });
    }

    // ── on_player_enter: IPC player-enter-range event ──
    if (typeof window.api?.onPlayerEnterRange === 'function') {
        window.api.onPlayerEnterRange(data => {
            const botId = (typeof activeBotId !== 'undefined') ? activeBotId : null;
            if (data.accountId !== botId) return;
            eachTrigger('on_player_enter', trig => {
                const filter = (trig.playerName || '').trim();
                if (!filter) return true;
                const names = filter.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
                return names.includes((data.playerName || '').toLowerCase());
            });
        });
    }
})();

// ─── Keyboard hotkeys ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    const parts=[]; if(e.ctrlKey)parts.push('Ctrl'); if(e.shiftKey)parts.push('Shift'); if(e.altKey)parts.push('Alt');
    parts.push(e.key.length===1?e.key.toUpperCase():e.key);
    const combo=parts.join('+');
    blockMacros.forEach(m=>{ if(m.hotkey&&m.hotkey.toLowerCase()===combo.toLowerCase()){e.preventDefault();bmRun(m.id);} });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
function _bmInit() {
    window.buildMacrosTab = buildBlockMacrosTab;
    window.bmUpdateBotIndicator = bmUpdateBotIndicator;
    buildBlockMacrosTab();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bmInit);
} else {
    _bmInit();
}