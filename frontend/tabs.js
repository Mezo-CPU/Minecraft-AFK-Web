// tabs.js - Tab System: Console, Macros, Statistics, Inventory

let activeTab = 'console';
let macros = JSON.parse(localStorage.getItem('mc_macros') || '[]');
let sessionStats = {
    sessionStart:      Date.now(),
    chatMessagesSent:  0,
    commandsExecuted:  0,
    deathCount:        0,
};

// Inventory drag-drop state
let dragSource = null;

// ─── Tab Bootstrap ────────────────────────────────────────────────────────────
function initTabs() {
    buildTabBar();
    buildConsoleTab();
    buildMacrosTab();
    buildStatisticsTab();
    buildInventoryTab();
    buildContainersTab();
    switchTab('console');
    startStatsUpdater();
}

function buildTabBar() {
    let tabBar = document.getElementById('tabBar');
    if (!tabBar) {
        tabBar = document.createElement('div');
        tabBar.id = 'tabBar';
        tabBar.style.cssText = `
            display:flex;gap:2px;background:#111;
            border-bottom:2px solid #333;padding:4px 8px 0;
            flex-shrink:0;
        `;
        const main = document.querySelector('.console-area');
        main.insertBefore(tabBar, main.firstChild);
    }

    const tabs = [
        { id: 'console',    label: '💬 Console'   },
        { id: 'macros',     label: '⚡ Macros'    },
        { id: 'statistics', label: '📊 Statistics' },
        { id: 'inventory',  label: '🎒 Inventory'  },
        { id: 'containers', label: '📦 Containers' },
        { id: 'settings',   label: '⚙️ Settings'   },
    ];

    tabBar.innerHTML = tabs.map(t => `
        <button class="tab-btn" id="tab-btn-${t.id}" onclick="switchTab('${t.id}')"
            style="
                background:#1e1e1e;color:#aaa;border:1px solid #333;
                border-bottom:none;padding:6px 16px;cursor:pointer;
                border-radius:4px 4px 0 0;font-size:13px;font-family:inherit;
                transition:background .15s,color .15s;">
            ${t.label}
        </button>
    `).join('');
}

function switchTab(id) {
    activeTab = id;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const active = btn.id === `tab-btn-${id}`;
        btn.style.background   = active ? '#2d2d2d' : '#1e1e1e';
        btn.style.color        = active ? '#a78bfa' : '#aaa';
        btn.style.borderColor  = active ? '#a78bfa' : '#333';
    });
    // Include 'settings' so it always gets hidden when switching to any other tab
    ['console', 'macros', 'statistics', 'inventory', 'containers', 'settings'].forEach(name => {
        const el = document.getElementById(`tab-${name}`);
        if (!el) return;
        if (name === id) {
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });
    if (id === 'statistics') refreshStatisticsUI();
    if (id === 'inventory')  refreshInventoryUI();
    if (id === 'containers') refreshContainersTab();
    if (id === 'settings')   refreshSettingsTab();
}

function createTabPanel(id) {
    let panel = document.getElementById(`tab-${id}`);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = `tab-${id}`;
    // Console panel must NOT scroll itself (the inner #console div handles that).
    // Every other panel should scroll its own content vertically.
    const overflowVal = id === 'console' ? 'hidden' : 'auto';
    panel.style.cssText = `display:none;flex-direction:column;flex:1;overflow-y:${overflowVal};overflow-x:hidden;background:transparent;min-height:0;`;
    const consoleArea = document.querySelector('.console-area');
    consoleArea.appendChild(panel);
    return panel;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 1 — CONSOLE
// ═══════════════════════════════════════════════════════════════════════════════
function buildConsoleTab() {
    const panel = createTabPanel('console');
    panel.style.flexDirection = 'column';

    const existingConsole  = document.getElementById('console');
    const existingInputRow = document.querySelector('.input-area');
    if (existingConsole)  panel.appendChild(existingConsole);
    if (existingInputRow) panel.appendChild(existingInputRow);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 2 — MACROS
// ═══════════════════════════════════════════════════════════════════════════════
function buildMacrosTab() {
    const panel = createTabPanel('macros');
    panel.innerHTML = `
        <div style="padding:12px 16px;border-bottom:1px solid #333;background:#1e1e1e;
                    display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <span style="color:#a78bfa;font-size:14px;font-weight:bold;">⚡ Macros</span>
            <button onclick="openMacroEditor()" style="
                background:#a78bfa;color:#111;border:none;border-radius:4px;
                padding:6px 14px;cursor:pointer;font-weight:bold;font-size:13px;">+ New Macro</button>
        </div>

        <div id="macroList" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;"></div>

        <!-- Macro Editor Modal -->
        <div id="macroEditorModal" style="
            display:none;position:absolute;inset:0;background:rgba(0,0,0,.75);
            z-index:900;align-items:center;justify-content:center;">
            <div style="background:#222;border:1px solid #444;border-radius:8px;
                        padding:20px;width:520px;max-height:80vh;overflow-y:auto;">
                <div style="color:#a78bfa;font-size:16px;font-weight:bold;margin-bottom:14px;">✏️ Macro Editor</div>
                <label style="color:#aaa;font-size:12px;">Name</label>
                <input id="meditName" style="
                    display:block;width:100%;box-sizing:border-box;
                    background:#111;border:1px solid #555;border-radius:4px;
                    color:#fff;padding:6px 10px;font-size:13px;margin:4px 0 10px;outline:none;">
                <label style="color:#aaa;font-size:12px;">Hotkey (optional)</label>
                <input id="meditKey" placeholder="e.g. F5, Ctrl+1" style="
                    display:block;width:100%;box-sizing:border-box;
                    background:#111;border:1px solid #555;border-radius:4px;
                    color:#fff;padding:6px 10px;font-size:13px;margin:4px 0 10px;outline:none;">
                <label style="color:#aaa;font-size:12px;">Repeat Mode</label>
                <select id="meditRepeat" style="
                    display:block;width:100%;box-sizing:border-box;
                    background:#111;border:1px solid #555;border-radius:4px;
                    color:#fff;padding:6px 8px;font-size:13px;margin:4px 0 10px;outline:none;">
                    <option value="once">Once</option>
                    <option value="loop">Loop (interval)</option>
                    <option value="toggle">Toggle (on/off)</option>
                </select>
                <div id="meditLoopRow" style="display:none;margin-bottom:10px;">
                    <label style="color:#aaa;font-size:12px;">Loop Interval (ms)</label>
                    <input id="meditInterval" type="number" value="1000" min="50" style="
                        display:block;width:100%;box-sizing:border-box;
                        background:#111;border:1px solid #555;border-radius:4px;
                        color:#fff;padding:6px 10px;font-size:13px;margin:4px 0;outline:none;">
                </div>
                <label style="color:#aaa;font-size:12px;">Commands (one per line)</label>
                <textarea id="meditCommands" rows="8" placeholder="/command1&#10;chat message&#10;/command2" style="
                    display:block;width:100%;box-sizing:border-box;
                    background:#111;border:1px solid #555;border-radius:4px;
                    color:#fff;padding:6px 10px;font-family:monospace;font-size:12px;
                    margin:4px 0 14px;outline:none;resize:vertical;"></textarea>

                <!-- ── Auto-Trigger Section ── -->
                <div style="border-top:1px solid #333;margin-bottom:12px;padding-top:12px;">
                    <div style="color:#a78bfa;font-size:12px;font-weight:bold;margin-bottom:8px;">⚡ Auto-Trigger</div>

                    <label style="color:#aaa;font-size:12px;">Trigger Event</label>
                    <select id="meditTriggerType" style="
                        display:block;width:100%;box-sizing:border-box;
                        background:#111;border:1px solid #555;border-radius:4px;
                        color:#fff;padding:6px 8px;font-size:13px;margin:4px 0 10px;outline:none;"
                        onchange="onMeditTriggerTypeChange()">
                        <option value="none">— None (manual only) —</option>
                        <option value="on_hit">🩸 Bot gets hit</option>
                        <option value="on_chat_match">💬 Chat message contains…</option>
                        <option value="on_player_enter">👁️ Player enters render distance</option>
                    </select>

                    <!-- Chat match sub-options -->
                    <div id="meditTriggerChatRow" style="display:none;margin-bottom:10px;">
                        <label style="color:#aaa;font-size:12px;">Match Text (case-insensitive)</label>
                        <input id="meditTriggerChatText" placeholder="e.g. hello, attack, run" style="
                            display:block;width:100%;box-sizing:border-box;
                            background:#111;border:1px solid #555;border-radius:4px;
                            color:#fff;padding:6px 10px;font-size:13px;margin:4px 0 6px;outline:none;">
                        <label style="display:flex;align-items:center;gap:6px;color:#aaa;font-size:12px;cursor:pointer;">
                            <input id="meditTriggerChatWhisper" type="checkbox" style="accent-color:#a78bfa;">
                            Only whispers / direct messages
                        </label>
                    </div>

                    <!-- Player enter sub-options -->
                    <div id="meditTriggerPlayerRow" style="display:none;margin-bottom:10px;">
                        <label style="color:#aaa;font-size:12px;">Player Name Filter</label>
                        <input id="meditTriggerPlayerName" placeholder="Leave blank to trigger on any player" style="
                            display:block;width:100%;box-sizing:border-box;
                            background:#111;border:1px solid #555;border-radius:4px;
                            color:#fff;padding:6px 10px;font-size:13px;margin:4px 0 6px;outline:none;">
                        <div style="color:#555;font-size:11px;">Separate multiple names with commas</div>
                    </div>

                    <!-- Cooldown (shared) -->
                    <div id="meditTriggerCooldownRow" style="display:none;margin-bottom:4px;">
                        <label style="color:#aaa;font-size:12px;">Cooldown (ms) — prevent rapid re-fires</label>
                        <input id="meditTriggerCooldown" type="number" value="2000" min="0" style="
                            display:block;width:100%;box-sizing:border-box;
                            background:#111;border:1px solid #555;border-radius:4px;
                            color:#fff;padding:6px 10px;font-size:13px;margin:4px 0;outline:none;">
                    </div>
                </div>

                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button onclick="closeMacroEditor()" style="
                        background:#333;color:#ccc;border:none;border-radius:4px;
                        padding:7px 16px;cursor:pointer;">Cancel</button>
                    <button onclick="saveMacroFromEditor()" style="
                        background:#a78bfa;color:#111;border:none;border-radius:4px;
                        padding:7px 16px;cursor:pointer;font-weight:bold;">Save Macro</button>
                </div>
            </div>
        </div>
    `;

    document.addEventListener('keydown', e => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const combo = buildCombo(e);
        macros.forEach(macro => {
            if (macro.hotkey && macro.hotkey.toLowerCase() === combo.toLowerCase()) {
                e.preventDefault();
                runMacro(macro.id);
            }
        });
    });

    document.getElementById('meditRepeat')?.addEventListener('change', e => {
        const row = document.getElementById('meditLoopRow');
        if (row) row.style.display = e.target.value === 'loop' ? 'block' : 'none';
    });

    renderMacroList();
}

function buildCombo(e) {
    const parts = [];
    if (e.ctrlKey)  parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey)   parts.push('Alt');
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    return parts.join('+');
}

let editingMacroId = null;
const loopTimers  = new Map();
const toggleState = new Map();

function openMacroEditor(id = null) {
    editingMacroId = id;
    const macro = id !== null ? macros.find(m => m.id === id) : null;
    document.getElementById('meditName').value     = macro?.name || '';
    document.getElementById('meditKey').value      = macro?.hotkey || '';
    document.getElementById('meditRepeat').value   = macro?.repeat || 'once';
    document.getElementById('meditInterval').value = macro?.interval || 1000;
    document.getElementById('meditCommands').value = (macro?.commands || []).join('\n');
    const loopRow = document.getElementById('meditLoopRow');
    if (loopRow) loopRow.style.display = macro?.repeat === 'loop' ? 'block' : 'none';

    // ── Trigger fields ──
    const trig = macro?.trigger || {};
    document.getElementById('meditTriggerType').value        = trig.type     || 'none';
    document.getElementById('meditTriggerChatText').value    = trig.chatText || '';
    document.getElementById('meditTriggerChatWhisper').checked = trig.chatWhisperOnly || false;
    document.getElementById('meditTriggerPlayerName').value  = trig.playerName || '';
    document.getElementById('meditTriggerCooldown').value    = trig.cooldown  ?? 2000;
    onMeditTriggerTypeChange();

    const modal = document.getElementById('macroEditorModal');
    if (modal) modal.style.display = 'flex';
}

function onMeditTriggerTypeChange() {
    const type = document.getElementById('meditTriggerType').value;
    document.getElementById('meditTriggerChatRow').style.display    = type === 'on_chat_match'   ? 'block' : 'none';
    document.getElementById('meditTriggerPlayerRow').style.display  = type === 'on_player_enter' ? 'block' : 'none';
    document.getElementById('meditTriggerCooldownRow').style.display = type !== 'none'            ? 'block' : 'none';
}

function closeMacroEditor() {
    const modal = document.getElementById('macroEditorModal');
    if (modal) modal.style.display = 'none';
    editingMacroId = null;
}

function saveMacroFromEditor() {
    const name     = document.getElementById('meditName').value.trim() || 'Untitled';
    const hotkey   = document.getElementById('meditKey').value.trim();
    const repeat   = document.getElementById('meditRepeat').value;
    const interval = parseInt(document.getElementById('meditInterval').value) || 1000;
    const commands = document.getElementById('meditCommands').value
        .split('\n').map(l => l.trim()).filter(Boolean);

    // ── Collect trigger config ──
    const trigType = document.getElementById('meditTriggerType').value;
    const trigger  = trigType === 'none' ? null : {
        type:            trigType,
        chatText:        document.getElementById('meditTriggerChatText').value.trim(),
        chatWhisperOnly: document.getElementById('meditTriggerChatWhisper').checked,
        playerName:      document.getElementById('meditTriggerPlayerName').value.trim(),
        cooldown:        parseInt(document.getElementById('meditTriggerCooldown').value) || 2000,
    };

    if (editingMacroId !== null) {
        const idx = macros.findIndex(m => m.id === editingMacroId);
        if (idx !== -1) macros[idx] = { ...macros[idx], name, hotkey, repeat, interval, commands, trigger };
    } else {
        macros.push({ id: Date.now(), name, hotkey, repeat, interval, commands, trigger });
    }
    saveMacros();
    renderMacroList();
    closeMacroEditor();
}

function deleteMacro(id) {
    stopMacroLoop(id);
    macros = macros.filter(m => m.id !== id);
    saveMacros();
    renderMacroList();
}

function saveMacros() {
    try { localStorage.setItem('mc_macros', JSON.stringify(macros)); } catch {}
}

function renderMacroList() {
    const container = document.getElementById('macroList');
    if (!container) return;
    if (macros.length === 0) {
        container.innerHTML = `
            <div style="color:#555;text-align:center;width:100%;padding-top:40px;font-size:14px;">
                No macros yet. Click <strong style="color:#a78bfa;">+ New Macro</strong> to create one.
            </div>`;
        return;
    }
    container.innerHTML = macros.map(macro => {
        const isLooping = loopTimers.has(macro.id);
        const isToggled = toggleState.get(macro.id);
        const active    = isLooping || isToggled;
        const badge     = macro.repeat === 'loop'   ? `🔄 Loop ${macro.interval}ms`
                        : macro.repeat === 'toggle' ? `🔁 Toggle`
                        : `▶ Once`;
        const trigLabel = macro.trigger?.type === 'on_hit'          ? '🩸 On Hit'
                        : macro.trigger?.type === 'on_chat_match'   ? `💬 "${escHtml(macro.trigger.chatText || '…')}"`
                        : macro.trigger?.type === 'on_player_enter' ? (macro.trigger.playerName ? `👁️ ${escHtml(macro.trigger.playerName)}` : '👁️ Any Player')
                        : null;
        return `
            <div style="
                background:#222;border:1px solid ${active ? '#a78bfa' : '#333'};
                border-radius:6px;padding:12px 14px;width:220px;
                display:flex;flex-direction:column;gap:6px;position:relative;">
                <div style="color:#fff;font-size:14px;font-weight:bold;">${escHtml(macro.name)}</div>
                <div style="color:#888;font-size:11px;">
                    ${macro.hotkey ? `⌨️ <b style="color:#aaa">${escHtml(macro.hotkey)}</b> · ` : ''}${badge}
                </div>
                ${trigLabel ? `<div style="color:#f59e0b;font-size:11px;">⚡ ${trigLabel}</div>` : ''}
                <div style="color:#555;font-size:11px;">${macro.commands.length} command${macro.commands.length !== 1 ? 's' : ''}</div>
                <div style="display:flex;gap:6px;margin-top:4px;">
                    <button onclick="runMacro(${macro.id})" style="
                        flex:1;background:${active ? '#ff3366' : '#a78bfa'};
                        color:#111;border:none;border-radius:4px;
                        padding:5px;cursor:pointer;font-size:12px;font-weight:bold;">
                        ${active ? '⏹ Stop' : '▶ Run'}
                    </button>
                    <button onclick="openMacroEditor(${macro.id})" style="
                        background:#2d2d2d;color:#ccc;border:1px solid #444;
                        border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;">✏️</button>
                    <button onclick="deleteMacro(${macro.id})" style="
                        background:#2d2d2d;color:#ff3366;border:1px solid #444;
                        border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;">🗑</button>
                </div>
            </div>`;
    }).join('');
}

async function runMacro(id) {
    const macro = macros.find(m => m.id === id);
    if (!macro) return;
    if (macro.repeat === 'loop') {
        if (loopTimers.has(id)) {
            stopMacroLoop(id);
        } else {
            await executeMacroCommands(macro);
            const timer = setInterval(() => executeMacroCommands(macro), macro.interval);
            loopTimers.set(id, timer);
        }
    } else if (macro.repeat === 'toggle') {
        if (toggleState.get(id)) {
            toggleState.set(id, false);
        } else {
            toggleState.set(id, true);
            await executeMacroCommands(macro);
        }
    } else {
        await executeMacroCommands(macro);
    }
    renderMacroList();
}

function stopMacroLoop(id) {
    if (loopTimers.has(id)) { clearInterval(loopTimers.get(id)); loopTimers.delete(id); }
    toggleState.delete(id);
}

async function executeMacroCommands(macro) {
    // Run on all selected bots if any are shift-selected, else active bot
    const targets = (typeof selectedBots !== 'undefined' && selectedBots.size > 0)
        ? Array.from(selectedBots)
        : (typeof activeBotId !== 'undefined' && activeBotId !== null ? [activeBotId] : []);

    if (targets.length === 0) {
        addLog && addLog('error', `[Macro: ${macro.name}] No bot selected`);
        return;
    }

    for (const cmd of macro.commands) {
        if (!cmd) continue;
        await new Promise(r => setTimeout(r, 150));
        // Fire the command on every target bot in parallel so they stay in sync
        await Promise.all(targets.map(botId => {
            if (cmd.startsWith('/'))
                return window.api.executeCommand(botId, cmd.substring(1));
            else
                return window.api.sendChat(botId, cmd);
        }));
        sessionStats.commandsExecuted++;
    }
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 3 — STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════
function buildStatisticsTab() {
    const panel = createTabPanel('statistics');
    panel.innerHTML = `
        <div style="padding:12px 16px;border-bottom:1px solid #333;background:#1e1e1e;
                    display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#a78bfa;font-size:14px;font-weight:bold;">📊 Statistics</span>
            <button onclick="resetSessionStats()" style="
                background:#333;color:#aaa;border:1px solid #444;border-radius:4px;
                padding:5px 12px;cursor:pointer;font-size:12px;">🔄 Reset Session</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:16px;display:grid;
                    grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;align-content:start;">
        </div>
    `;
}

function statCard(icon, label, id, color = '#a78bfa') {
    return `
        <div style="background:#222;border:1px solid #333;border-radius:8px;padding:14px 16px;
                    display:flex;flex-direction:column;gap:6px;">
            <div style="color:#666;font-size:12px;">${icon} ${label}</div>
            <div id="${id}" style="color:${color};font-size:22px;font-weight:bold;">—</div>
        </div>`;
}

function refreshStatisticsUI() {
    const panel = document.getElementById('tab-statistics');
    if (!panel) return;
    const grid = panel.querySelector('div[style*="grid-template"]');
    if (!grid) return;

    const bot = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null)
        ? bots[activeBotId] : null;

    grid.innerHTML = `
        ${statCard('📍', 'Current Position',    'stat-pos',    '#818cf8')}
        ${statCard('⏱️', 'Session Uptime',      'stat-uptime', '#a78bfa')}
        ${statCard('❤️', 'Health',              'stat-health', '#ff3366')}
        ${statCard('🍖', 'Hunger',              'stat-hunger', '#ffaa00')}
        ${statCard('📶', 'Ping',                'stat-ping',   '#a78bfa')}
        ${statCard('💬', 'Messages Sent',       'stat-msgs',   '#818cf8')}
        ${statCard('⚡', 'Commands Run',         'stat-cmds',   '#ffaa00')}
        ${statCard('🗓️', 'Connected Since',     'stat-since',  '#818cf8')}
        ${statCard('☠️', 'Deaths (session)',     'stat-deaths', '#ff3366')}
        ${statCard('🌍', 'Dimension',           'stat-dim',    '#a78bfa')}
        ${statCard('🎮', 'Game Mode',           'stat-gm',     '#a78bfa')}
        ${statCard('🧭', 'Facing Direction',    'stat-facing', '#aaa')}
    `;
    updateStatsCards(bot);
}

function updateStatsCards(bot) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('stat-pos',    bot?.position ? `${bot.position.x}, ${bot.position.y}, ${bot.position.z}` : 'Not connected');
    set('stat-uptime', formatTime(Math.floor((Date.now() - sessionStats.sessionStart) / 1000)));
    set('stat-health', bot ? `${bot.health || 0} / 20` : '—');
    set('stat-hunger', bot ? `${bot.food  || 0} / 20` : '—');

    if (bot?.ping !== undefined) {
        const p   = bot.ping;
        const col = p < 50 ? '#a78bfa' : p < 100 ? '#818cf8' : p < 200 ? '#ffaa00' : '#ff3366';
        const el  = document.getElementById('stat-ping');
        if (el) { el.textContent = `${p}ms`; el.style.color = col; }
    } else {
        set('stat-ping', '—');
    }

    set('stat-msgs',   sessionStats.chatMessagesSent);
    set('stat-cmds',   sessionStats.commandsExecuted);
    set('stat-deaths', sessionStats.deathCount);

    if (bot?.uptime !== undefined) {
        set('stat-since', new Date(Date.now() - bot.uptime * 1000).toLocaleTimeString());
    } else {
        set('stat-since', '—');
    }

    set('stat-dim', bot?.dimension || 'overworld');
    set('stat-gm',  bot?.gameMode  || '—');

    if (bot?.yaw !== undefined) {
        const degrees = ((bot.yaw * (180 / Math.PI)) + 360) % 360;
        const dirs = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
        set('stat-facing', dirs[Math.round(degrees / 45) % 8]);
    } else {
        set('stat-facing', '—');
    }
}

function resetSessionStats() {
    sessionStats = { sessionStart: Date.now(), chatMessagesSent: 0, commandsExecuted: 0, deathCount: 0 };
    if (activeTab === 'statistics') refreshStatisticsUI();
}

function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function startStatsUpdater() {
    setInterval(() => {
        if (activeTab !== 'statistics') return;
        const bot = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null)
            ? bots[activeBotId] : null;
        updateStatsCards(bot);
    }, 1000);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 4 — INVENTORY  (drag-and-drop)
// ═══════════════════════════════════════════════════════════════════════════════
function buildInventoryTab() {
    const panel = createTabPanel('inventory');
    panel.innerHTML = `
        <div style="padding:12px 16px;border-bottom:1px solid #333;background:#1e1e1e;
                    display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <span style="color:#a78bfa;font-size:14px;font-weight:bold;">🎒 Inventory</span>
            <div style="display:flex;gap:8px;align-items:center;">
                <button id="inv-close-container-btn" onclick="invCloseContainer()" style="
                    display:none;background:#7f1d1d;color:#fca5a5;border:1px solid #ef4444;
                    border-radius:4px;padding:5px 14px;cursor:pointer;font-size:12px;font-weight:bold;">
                    ✕ Close Container
                </button>
                <button onclick="invDropSelected()" style="
                    background:#333;color:#ff3366;border:1px solid #444;border-radius:4px;
                    padding:5px 12px;cursor:pointer;font-size:12px;">🗑 Drop Selected</button>
                <button onclick="invDropAll()" style="
                    background:#333;color:#ff3366;border:1px solid #444;border-radius:4px;
                    padding:5px 12px;cursor:pointer;font-size:12px;">🗑 Drop All</button>
            </div>
        </div>

        <!-- Normal inventory view -->
        <div id="inv-normal-sections" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;align-items:center;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;max-width:420px;">
                <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Armor</div>
                <div id="inv-armor" style="display:flex;gap:6px;justify-content:center;"></div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
                <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Off-hand</div>
                <div id="inv-offhand" style="display:flex;gap:6px;"></div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;max-width:420px;">
                <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Inventory</div>
                <div id="inv-main" style="display:grid;grid-template-columns:repeat(9,42px);gap:4px;
                    background:#111;border:2px solid #333;border-radius:6px;padding:8px;"></div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;max-width:420px;">
                <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Hotbar</div>
                <div id="inv-hotbar" style="display:grid;grid-template-columns:repeat(9,42px);gap:4px;
                    background:#111;border:2px solid #444;border-radius:6px;padding:8px;"></div>
            </div>
            <div id="inv-selected-info" style="color:#888;font-size:12px;min-height:20px;"></div>
        </div>

        <!-- Container view (shown when a chest/menu is open) -->
        <div id="inv-container-view" style="display:none;flex:1;overflow-y:auto;flex-direction:column;align-items:center;"></div>

        <div id="invDragGhost" style="
            position:fixed;pointer-events:none;z-index:9999;
            width:40px;height:40px;display:none;
            align-items:center;justify-content:center;font-size:22px;opacity:.85;"></div>
    `;
    refreshInventoryUI();
}

let selectedInvSlot = null;
let activeContainer = null; // { title, slotCount, slots } when a container is open

// Called from renderer.js when the bot opens a container
window.tabsOnContainerOpen = function(data) {
    if (data.accountId !== (typeof activeBotId !== 'undefined' ? activeBotId : null)) return;
    const slots = {};
    for (const k of Object.keys(data.slots)) {
        const item = data.slots[k];
        if (item !== null && item !== undefined) slots[parseInt(k)] = item;
    }

    if (activeContainer) {
        activeContainer.slots = slots;
        if (activeTab === 'inventory')  refreshInventoryUI();
        if (activeTab === 'containers') refreshContainersTab();
    } else {
        activeContainer = { title: data.title, slotCount: data.slotCount, slots };
        if (activeTab !== 'inventory' && activeTab !== 'containers') {
            switchTab('containers');
        } else {
            refreshInventoryUI();
            refreshContainersTab();
        }
    }
};

// Called from renderer.js when the bot closes a container
window.tabsOnContainerClose = function(data) {
    if (data.accountId !== (typeof activeBotId !== 'undefined' ? activeBotId : null)) return;
    activeContainer = null;
    if (activeTab === 'inventory')  refreshInventoryUI();
    if (activeTab === 'containers') refreshContainersTab();
};

function refreshInventoryUI() {
    // Show/hide the Close Container button in the Inventory tab toolbar
    const closeBtn = document.getElementById('inv-close-container-btn');
    if (closeBtn) closeBtn.style.display = activeContainer ? '' : 'none';

    if (activeContainer) {
        renderContainerView(activeContainer);
    } else {
        renderNormalInventory();
    }
}

async function invCloseContainer() {
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) return;
    await window.api.executeCommand(botId, 'closewindow');
    // tabsOnContainerClose will fire via IPC and clear activeContainer
}

function renderNormalInventory() {
    if (activeContainer) return; // container view takes priority
    const sections = document.getElementById('inv-normal-sections');
    const containerView = document.getElementById('inv-container-view');
    if (sections)      sections.style.display = 'flex';
    if (containerView) containerView.style.display = 'none';

    const bot = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null)
        ? bots[activeBotId] : null;
    renderArmorSlots(bot);
    renderOffhand(bot);
    renderMainInv(bot);
    renderHotbarInv(bot);
}

function renderContainerView(container) {
    const sections      = document.getElementById('inv-normal-sections');
    const containerView = document.getElementById('inv-container-view');
    if (!sections || !containerView) return;
    sections.style.display             = 'none';
    containerView.style.display        = 'flex';
    containerView.style.flexDirection  = 'column';
    containerView.style.alignItems     = 'center';
    containerView.style.overflowY      = 'auto';

    console.log('[Container] title:', container.title, '| slotCount:', container.slotCount, '| slots:', container.slots);

    const playerSlotCount = 36;
    const chestSlotCount  = container.slotCount - playerSlotCount; // 27 for generic_9x3
    const chestCols       = Math.min(chestSlotCount, 9);

    const bot  = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null)
        ? bots[activeBotId] : null;
    const held = bot?.heldItem || 0;

    // Parse title — may be plain string or JSON chat component
    let titleText = 'Container';
    try {
        const parsed = typeof container.title === 'string' ? JSON.parse(container.title) : container.title;
        titleText = parsed?.text || parsed?.translate || titleText;
    } catch {
        titleText = typeof container.title === 'string' ? container.title : 'Container';
    }

    // Build chest grid (slots 0 to chestSlotCount-1)
    let chestHtml = '';
    for (let s = 0; s < chestSlotCount; s++) {
        chestHtml += makeContainerSlot(s, container.slots[s] || null);
    }

    // Player main inventory (slots chestSlotCount to chestSlotCount+26)
    let invHtml = '';
    for (let s = chestSlotCount; s < chestSlotCount + 27; s++) {
        invHtml += makeContainerSlot(s, container.slots[s] || null);
    }

    // Hotbar (slots chestSlotCount+27 to end)
    let hotbarHtml = '';
    for (let s = chestSlotCount + 27; s < container.slotCount; s++) {
        const isHeld = (s - chestSlotCount - 27) === held;
        hotbarHtml += makeContainerSlot(s, container.slots[s] || null, isHeld);
    }

    containerView.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;width:100%;">
            <div style="color:#a78bfa;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">
                📦 ${escHtml(titleText)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(${chestCols},42px);gap:4px;
                background:#111;border:2px solid #a78bfa;border-radius:6px;padding:8px;">
                ${chestHtml}
            </div>
            <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-top:4px;">
                Your Inventory
            </div>
            <div style="display:grid;grid-template-columns:repeat(9,42px);gap:4px;
                background:#111;border:2px solid #333;border-radius:6px;padding:8px;">
                ${invHtml}
            </div>
            <div style="display:grid;grid-template-columns:repeat(9,42px);gap:4px;
                background:#111;border:2px solid #444;border-radius:6px;padding:8px;">
                ${hotbarHtml}
            </div>
            <div id="inv-selected-info" style="color:#888;font-size:12px;min-height:20px;"></div>
        </div>
    `;
    addSlotHoverListeners();
}

function makeContainerSlot(slotIndex, item, isHeld = false) {
    const name   = item ? item.name.replace('minecraft:', '') : '';
    const getImg = typeof getItemImg === 'function' ? getItemImg : (typeof window.getItemImg === 'function' ? window.getItemImg : null);
    const img    = item && getImg ? getImg(name, '32px') : (item ? '📦' : '');
    const count  = item && item.count > 1
        ? `<span style="position:absolute;bottom:2px;right:3px;font-size:10px;color:#fff;font-weight:bold;text-shadow:1px 1px 0 #000;">${item.count}</span>`
        : '';
    const border = isHeld ? '#a78bfa' : '#444';
    return `
        <div class="inv-slot container-slot" data-slot="${slotIndex}"
            style="width:40px;height:40px;background:#1a1a1a;border:2px solid ${border};
                   border-radius:4px;display:flex;align-items:center;justify-content:center;
                   cursor:pointer;position:relative;user-select:none;"
            ondragover="invDragOver(event)"
            onclick="containerSlotClick(${slotIndex}, 0)"
            oncontextmenu="event.preventDefault(); event.stopPropagation(); containerSlotClick(${slotIndex}, 1)"
            title="${name}${item ? ' ×' + item.count : ''}">
            ${img}${count}
        </div>`;
}

async function containerSlotClick(slotIndex, button) {
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) return;
    const bot = bots?.[botId];
    if (!bot || bot.status !== 'online') return;
    selectedInvSlot = slotIndex;
    const result = await window.api.executeCommand(botId, `clickwindow ${slotIndex} ${button}`);
    const info = document.getElementById('inv-selected-info');
    if (info && activeContainer) {
        const item = activeContainer.slots[slotIndex];
        if (item) {
            const name = item.name.replace('minecraft:', '');
            info.textContent = `${button === 1 ? 'Right-clicked' : 'Clicked'}: ${name} ×${item.count}  (slot ${slotIndex})`;
            info.style.color = '#ccc';
        } else {
            info.textContent = `${button === 1 ? 'Right-clicked' : 'Clicked'}: empty slot ${slotIndex}`;
            info.style.color = '#555';
        }
    }
}

function makeSlot(slotIndex, item, isHeld = false) {
    const name  = item ? item.name.replace('minecraft:', '') : '';
    const img   = item ? (typeof getItemImg === 'function' ? getItemImg(name, '32px') : '📦') : '';
    const count = item && item.count > 1
        ? `<span style="position:absolute;bottom:2px;right:3px;font-size:10px;color:#fff;font-weight:bold;text-shadow:1px 1px 0 #000;">${item.count}</span>`
        : '';
    const border = isHeld ? '#a78bfa' : (selectedInvSlot === slotIndex ? '#818cf8' : '#444');
    return `
        <div class="inv-slot" data-slot="${slotIndex}"
            style="width:40px;height:40px;background:#1a1a1a;border:2px solid ${border};
                   border-radius:4px;display:flex;align-items:center;justify-content:center;
                   cursor:pointer;position:relative;user-select:none;"
            draggable="true"
            ondragstart="invDragStart(event,${slotIndex})"
            ondragover="invDragOver(event)"
            ondrop="invDrop(event,${slotIndex})"
            ondragend="invDragEnd(event)"
            onclick="invSlotClick(${slotIndex})"
            oncontextmenu="event.preventDefault(); invSlotRightClick(${slotIndex})"
            title="${name}${item ? ' ×' + item.count : ''}">
            ${img}${count}
        </div>`;
}

function renderArmorSlots(bot) {
    const el = document.getElementById('inv-armor');
    if (!el) return;
    const labels = ['⛑️ Helmet', '🛡️ Chest', '👖 Legs', '👢 Boots'];
    // UI armor slots: 36=helmet, 37=chestplate, 38=leggings, 39=boots
    // These map to mineflayer window slots 5-8 via uiSlotToWindow() in commands.js
    // inventorySlots is keyed by mineflayer window slot (5-8), so we read from there
    // but pass UI slot index (36-39) to makeSlot so swap/drag use correct mapping
    const mineflayerSlots = [5, 6, 7, 8];
    el.innerHTML = mineflayerSlots.map((mfSlot, i) => {
        const uiSlot = 36 + i; // 36, 37, 38, 39
        const item = bot?.inventorySlots?.[mfSlot] || null;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            ${makeSlot(uiSlot, item)}
            <div style="color:#555;font-size:10px;text-align:center;">${labels[i]}</div>
        </div>`;
    }).join('');
    addSlotHoverListeners();
}

function renderOffhand(bot) {
    const el = document.getElementById('inv-offhand');
    if (!el) return;
    // UI offhand slot: 40 → maps to mineflayer window slot 45 via uiSlotToWindow()
    // inventorySlots is keyed by mineflayer slot 45, read from there
    const item = bot?.inventorySlots?.[45] || null;
    el.innerHTML = makeSlot(40, item);
    addSlotHoverListeners();
}

function renderMainInv(bot) {
    const el = document.getElementById('inv-main');
    if (!el) return;
    let html = '';
    for (let s = 9; s <= 35; s++) html += makeSlot(s, bot?.inventorySlots?.[s] || null);
    el.innerHTML = html;
    addSlotHoverListeners();
}

function renderHotbarInv(bot) {
    const el = document.getElementById('inv-hotbar');
    if (!el) return;
    const held = bot?.heldItem || 0;
    let html = '';
    for (let s = 0; s <= 8; s++) html += makeSlot(s, bot?.hotbar?.[s] || null, s === held);
    el.innerHTML = html;
    addSlotHoverListeners();
}

function addSlotHoverListeners() {
    document.querySelectorAll('.inv-slot').forEach(slot => {
        slot.addEventListener('mouseenter', () => { slot.style.borderColor = '#666'; });
        slot.addEventListener('mouseleave', () => {
            const si  = parseInt(slot.dataset.slot);
            const bot = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null) ? bots[activeBotId] : null;
            const isHeld = si <= 8 && si === (bot?.heldItem || 0);
            slot.style.borderColor = isHeld ? '#a78bfa' : si === selectedInvSlot ? '#818cf8' : '#444';
        });
    });
}

function invDragStart(e, slotIndex) {
    dragSource = slotIndex;
    const bot  = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null) ? bots[activeBotId] : null;
    let item;
    if (slotIndex <= 8) {
        item = bot?.hotbar?.[slotIndex] || null;
    } else if (slotIndex >= 36 && slotIndex <= 39) {
        item = bot?.inventorySlots?.[slotIndex - 31] || null;
    } else if (slotIndex === 40) {
        item = bot?.inventorySlots?.[45] || null;
    } else {
        item = bot?.inventorySlots?.[slotIndex] || null;
    }
    const ghost = document.getElementById('invDragGhost');
    if (ghost) {
        const imgHtml = item && typeof getItemImg === 'function' ? getItemImg(item.name.replace('minecraft:', ''), '36px') : '📦';
        ghost.innerHTML = imgHtml;
        ghost.style.display = 'flex';
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(new Image(), 0, 0);
}

function invDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const ghost = document.getElementById('invDragGhost');
    if (ghost) { ghost.style.left = (e.clientX - 20) + 'px'; ghost.style.top = (e.clientY - 20) + 'px'; }
}

function invDragEnd() {
    dragSource = null;
    const ghost = document.getElementById('invDragGhost');
    if (ghost) ghost.style.display = 'none';
}

async function invDrop(e, targetSlot) {
    e.preventDefault();
    if (dragSource === null || dragSource === targetSlot) { invDragEnd(); return; }
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) { invDragEnd(); return; }
    const bot = bots?.[botId];
    if (!bot || bot.status !== 'online') {
        addLog && addLog('error', 'Bot must be connected to move items');
        invDragEnd();
        return;
    }
    const result = await window.api.executeCommand(botId, `swap ${dragSource} ${targetSlot}`);
    if (!result?.success) swapLocalSlots(botId, dragSource, targetSlot);
    invDragEnd();
    refreshInventoryUI();
}

function swapLocalSlots(botId, a, b) {
    const bot = bots[botId];
    if (!bot) return;
    // UI slot → stored data location:
    //   0-8:   bot.hotbar[s]
    //   9-35:  bot.inventorySlots[s]
    //   36-39: bot.inventorySlots[5-8]  (armor, mineflayer slots 5-8)
    //   40:    bot.inventorySlots[45]   (offhand)
    const uiToMf = s => {
        if (s >= 36 && s <= 39) return s - 31; // 36→5, 37→6, 38→7, 39→8
        if (s === 40) return 45;
        return s;
    };
    const get = s => {
        if (s <= 8) return bot.hotbar?.[s] ?? null;
        return bot.inventorySlots?.[uiToMf(s)] ?? null;
    };
    const set = (s, item) => {
        if (s <= 8) { if (!bot.hotbar) bot.hotbar = Array(9).fill(null); bot.hotbar[s] = item; }
        else { if (!bot.inventorySlots) bot.inventorySlots = {}; bot.inventorySlots[uiToMf(s)] = item; }
    };
    const tmp = get(a); set(a, get(b)); set(b, tmp);
}

async function invSlotRightClick(slotIndex) {
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) return;
    const bot = bots?.[botId];
    if (!bot || bot.status !== 'online') {
        addLog && addLog('error', 'Bot must be connected to use items');
        return;
    }
    // For hotbar slots, switch to that slot first then activate
    if (slotIndex <= 8) {
        await window.api.executeCommand(botId, `hotbar ${slotIndex + 1}`);
    }
    await window.api.executeCommand(botId, 'useitem');
    const info = document.getElementById('inv-selected-info');
    if (info) {
        const item = slotIndex <= 8 ? (bot.hotbar?.[slotIndex] || null) : (bot.inventorySlots?.[slotIndex] || null);
        const name = item ? item.name.replace('minecraft:', '') : 'empty slot';
        info.textContent = `Right-clicked: ${name} (slot ${slotIndex})`;
        info.style.color = '#ccc';
    }
}

function invSlotClick(slotIndex) {
    const bot  = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null) ? bots[activeBotId] : null;
    // Resolve UI slot → actual stored item
    let item;
    if (slotIndex <= 8) {
        item = bot?.hotbar?.[slotIndex] || null;
    } else if (slotIndex >= 36 && slotIndex <= 39) {
        // Armor: UI 36-39 → mineflayer 5-8
        item = bot?.inventorySlots?.[slotIndex - 31] || null;
    } else if (slotIndex === 40) {
        // Offhand: UI 40 → mineflayer 45
        item = bot?.inventorySlots?.[45] || null;
    } else {
        item = bot?.inventorySlots?.[slotIndex] || null;
    }
    if (slotIndex <= 8 && bot?.status === 'online') {
        typeof switchHotbarSlot === 'function' && switchHotbarSlot(slotIndex);
    }
    selectedInvSlot = slotIndex;
    const info = document.getElementById('inv-selected-info');
    if (info) {
        if (item) {
            const name = item.name.replace('minecraft:', '');
            info.textContent = `Selected: ${name} ×${item.count}  (slot ${slotIndex})`;
            info.style.color = '#ccc';
        } else {
            info.textContent = `Selected: empty slot ${slotIndex}`;
            info.style.color = '#555';
        }
    }
    refreshInventoryUI();
}

async function invDropSelected() {
    if (selectedInvSlot === null) return;
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) return;
    await window.api.executeCommand(botId, `drop ${selectedInvSlot}`);
    selectedInvSlot = null;
    setTimeout(refreshInventoryUI, 300);
}

async function invDropAll() {
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) return;
    if (!confirm('Drop ALL items?')) return;
    await window.api.executeCommand(botId, 'drop all');
    setTimeout(refreshInventoryUI, 300);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 5 — CONTAINERS
// ═══════════════════════════════════════════════════════════════════════════════

function buildContainersTab() {
    const panel = createTabPanel('containers');
    panel.innerHTML = `
        <div id="ct-toolbar" style="padding:10px 16px;border-bottom:1px solid #333;background:#1e1e1e;
                display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0;">
            <span style="color:#a78bfa;font-size:14px;font-weight:bold;">📦 Containers</span>
            <span id="ct-title" style="color:#888;font-size:12px;flex:1;"></span>
            <button id="ct-close-btn" onclick="ctCloseContainer()" style="
                display:none;background:#7f1d1d;color:#fca5a5;border:1px solid #ef4444;
                border-radius:4px;padding:5px 14px;cursor:pointer;font-size:12px;font-weight:bold;">
                ✕ Close Container
            </button>
        </div>
        <div id="ct-body" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;
                align-items:center;justify-content:center;padding:24px;gap:16px;">
            <div id="ct-empty" style="display:flex;flex-direction:column;align-items:center;gap:12px;opacity:.35;pointer-events:none;">
                <div style="font-size:52px;">📦</div>
                <div style="color:#888;font-size:13px;text-align:center;line-height:1.7;">
                    No container is open.<br>Walk up to a chest or other container<br>and open it in-game.
                </div>
            </div>
            <div id="ct-content" style="display:none;flex-direction:column;align-items:center;gap:14px;width:100%;"></div>
        </div>

        <!-- Tooltip -->
        <div id="ct-tooltip" style="
            position:fixed;z-index:9999;pointer-events:none;display:none;
            background:#111;border:1px solid #a78bfa;border-radius:6px;
            padding:6px 10px;font-size:11px;font-family:'Fira Code',monospace;
            line-height:1.6;max-width:220px;box-shadow:0 4px 16px rgba(0,0,0,.6);">
        </div>
    `;
    refreshContainersTab();
}

function refreshContainersTab() {
    const empty   = document.getElementById('ct-empty');
    const content = document.getElementById('ct-content');
    const titleEl = document.getElementById('ct-title');
    const closeBtn = document.getElementById('ct-close-btn');
    if (!empty || !content) return;

    if (!activeContainer) {
        empty.style.display   = 'flex';
        content.style.display = 'none';
        if (titleEl)  titleEl.textContent  = '';
        if (closeBtn) closeBtn.style.display = 'none';
        return;
    }

    empty.style.display   = 'none';
    content.style.display = 'flex';
    if (closeBtn) closeBtn.style.display = '';

    // Parse title
    let titleText = 'Container';
    try {
        const parsed = typeof activeContainer.title === 'string'
            ? JSON.parse(activeContainer.title) : activeContainer.title;
        titleText = parsed?.text || parsed?.translate || titleText;
    } catch {
        titleText = typeof activeContainer.title === 'string' ? activeContainer.title : 'Container';
    }
    if (titleEl) titleEl.textContent = titleText;

    const playerSlots = 36;
    const chestSlots  = activeContainer.slotCount - playerSlots;
    const cols        = Math.min(Math.max(chestSlots, 1), 9);

    // Build chest grid
    let chestHtml = '';
    for (let s = 0; s < chestSlots; s++) {
        chestHtml += ctMakeSlot(s, activeContainer.slots[s] || null);
    }

    // Player main inv
    let invHtml = '';
    for (let s = chestSlots; s < chestSlots + 27; s++) {
        invHtml += ctMakeSlot(s, activeContainer.slots[s] || null);
    }

    // Hotbar
    const bot  = (typeof bots !== 'undefined' && typeof activeBotId !== 'undefined' && activeBotId !== null) ? bots[activeBotId] : null;
    const held = bot?.heldItem || 0;
    let hotbarHtml = '';
    for (let s = chestSlots + 27; s < activeContainer.slotCount; s++) {
        const isHeld = (s - chestSlots - 27) === held;
        hotbarHtml += ctMakeSlot(s, activeContainer.slots[s] || null, isHeld);
    }

    content.innerHTML = `
        <div style="color:#a78bfa;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-weight:700;">
            ${escHtml(titleText)}
            <span style="color:#555;font-weight:400;margin-left:8px;">${chestSlots} slots</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(${cols},46px);gap:3px;
            background:#0d0d0d;border:2px solid rgba(167,139,250,0.4);border-radius:8px;padding:10px;">
            ${chestHtml}
        </div>

        <div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.08em;">Your Inventory</div>
        <div style="display:grid;grid-template-columns:repeat(9,46px);gap:3px;
            background:#0d0d0d;border:2px solid #333;border-radius:8px;padding:10px;">
            ${invHtml}
        </div>

        <div style="display:grid;grid-template-columns:repeat(9,46px);gap:3px;
            background:#0d0d0d;border:2px solid #444;border-radius:8px;padding:10px;">
            ${hotbarHtml}
        </div>

        <div id="ct-feedback" style="color:#888;font-size:11px;min-height:18px;font-family:'Fira Code',monospace;"></div>
    `;

    ctAttachTooltips();
}

function ctMakeSlot(slotIndex, item, isHeld = false) {
    const name    = item ? item.name.replace('minecraft:', '') : '';
    const getImg  = typeof getItemImg === 'function' ? getItemImg : null;
    const img     = item && getImg ? getImg(name, '34px') : (item ? '📦' : '');
    const count   = item && item.count > 1
        ? `<span style="position:absolute;bottom:2px;right:3px;font-size:10px;color:#fff;font-weight:bold;text-shadow:1px 1px 0 #000,0 0 4px #000;">${item.count}</span>`
        : '';
    const border  = isHeld ? '#a78bfa' : '#2a2a2a';
    const nameAttr = escHtml(name);
    return `
        <div class="ct-slot"
            data-slot="${slotIndex}"
            data-name="${nameAttr}"
            data-count="${item ? item.count : 0}"
            style="width:44px;height:44px;background:#111;border:2px solid ${border};
                   border-radius:4px;display:flex;align-items:center;justify-content:center;
                   cursor:pointer;position:relative;user-select:none;transition:border-color .1s,background .1s;"
            onclick="ctSlotClick(${slotIndex}, 0)"
            oncontextmenu="event.preventDefault();ctSlotClick(${slotIndex}, 1)">
            ${img}${count}
        </div>`;
}

function ctAttachTooltips() {
    const tooltip = document.getElementById('ct-tooltip');
    if (!tooltip) return;
    document.querySelectorAll('.ct-slot').forEach(el => {
        el.addEventListener('mouseenter', ev => {
            const slot  = el.dataset.slot;
            const name  = el.dataset.name;
            const count = el.dataset.count;
            if (!name) {
                tooltip.style.display = 'none';
                return;
            }
            tooltip.innerHTML = `
                <div style="color:#e0d0ff;font-weight:bold;">${name.replace(/_/g,' ')}</div>
                <div style="color:#888;">Slot <span style="color:#a78bfa;">${slot}</span></div>
                ${count > 0 ? `<div style="color:#aaa;">×${count}</div>` : ''}
                <div style="color:#555;font-size:10px;margin-top:3px;">Left/Right click to interact</div>
            `;
            tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', ev => {
            tooltip.style.left = (ev.clientX + 14) + 'px';
            tooltip.style.top  = (ev.clientY + 14) + 'px';
        });
        el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

        // Hover highlight
        el.addEventListener('mouseenter', () => { el.style.borderColor = '#a78bfa'; el.style.background = '#1a1a2e'; });
        el.addEventListener('mouseleave', () => {
            const isHeld = el.style.borderColor === 'rgb(167, 139, 250)' && el.classList.contains('held');
            el.style.borderColor = isHeld ? '#a78bfa' : '#2a2a2a';
            el.style.background = '#111';
        });
    });
}

async function ctSlotClick(slotIndex, button) {
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) return;
    const bot = bots?.[botId];
    if (!bot || bot.status !== 'online') return;

    const result = await window.api.executeCommand(botId, `clickwindow ${slotIndex} ${button}`);
    const fb = document.getElementById('ct-feedback');
    if (fb && activeContainer) {
        const item = activeContainer.slots[slotIndex];
        const label = item ? `${item.name.replace('minecraft:', '')} ×${item.count}` : 'empty slot';
        fb.textContent = `${button === 1 ? 'Right-clicked' : 'Left-clicked'}: ${label}  (slot ${slotIndex})`;
        fb.style.color = result?.success ? '#a78bfa' : '#ef4444';
    }
}

async function ctCloseContainer() {
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (botId === null) return;
    await window.api.executeCommand(botId, 'closewindow');
    // tabsOnContainerClose will fire via the IPC event and clear activeContainer
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 6 — SETTINGS  (panel lives in index.html; we only manage Auto-TPA state)
// ═══════════════════════════════════════════════════════════════════════════════

// Per-bot in-memory toggle state — survives tab switches, resets on page reload.
// Key: botId (number), Value: boolean
const _autoTpaEnabledByBot = new Map();

function _autoTpaEnabledFor(botId) {
    return _autoTpaEnabledByBot.get(botId) === true;
}

async function refreshSettingsTab() {
    // Only reload players from disk. Never overwrite the live toggle state.
    const botId    = typeof activeBotId !== 'undefined' ? activeBotId : null;
    const enabledEl = document.getElementById('autotpa-enabled');
    const label     = document.getElementById('autotpa-toggle-label');
    const playersEl = document.getElementById('autotpa-players');
    const statusEl  = document.getElementById('autotpa-status');
    if (!enabledEl || !playersEl) return;

    // Restore the toggle from our in-memory cache (not from the backend)
    const isOn = botId !== null ? _autoTpaEnabledFor(botId) : false;
    enabledEl.checked = isOn;
    if (label) label.dataset.enabled = String(isOn);
    _syncAutoTpaSlider();

    if (botId === null) {
        playersEl.value = '';
        if (statusEl) statusEl.textContent = 'No bot selected.';
        return;
    }

    // Load the player whitelist from the backend (disk-backed)
    try {
        const result = await window.api.getAutoTpa(botId);
        playersEl.value = (result.players || []).join('\n');
        if (statusEl) statusEl.textContent = isOn
            ? `✅ Active — ${result.players.length} player(s) whitelisted`
            : `⏸ Disabled`;
    } catch {
        if (statusEl) statusEl.textContent = 'Bot not connected — settings will apply on next connect.';
    }
}

function _buildSettingsTab_UNUSED() {
    const panel = createTabPanel('settings');
    panel.innerHTML = `
        <div style="padding:12px 16px;border-bottom:1px solid #333;background:#1e1e1e;
                    display:flex;gap:10px;align-items:center;">
            <span style="color:#a78bfa;font-size:14px;font-weight:bold;">⚙️ Settings</span>
        </div>

        <div style="padding:16px;display:flex;flex-direction:column;gap:16px;max-width:600px;">

            <!-- Auto-TPA card -->
            <div id="settings-autotpa-card" style="
                background:#1e1e1e;border:1px solid #333;border-radius:8px;padding:16px;
                display:flex;flex-direction:column;gap:12px;">

                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <div>
                        <div style="color:#e0d0ff;font-size:14px;font-weight:bold;">🚀 Auto TPA</div>
                        <div style="color:#666;font-size:12px;margin-top:2px;">
                            Automatically run <code style="color:#a78bfa;background:#111;padding:1px 5px;border-radius:3px;">/tpaccept &lt;player&gt;</code>
                            when a whitelisted player sends a teleport request.
                        </div>
                    </div>
                    <!-- Toggle switch -->
                    <label id="autotpa-toggle-label" style="
                        position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;cursor:pointer;">
                        <input type="checkbox" id="autotpa-enabled" style="opacity:0;width:0;height:0;"
                               onchange="onAutoTpaToggle()">
                        <span id="autotpa-slider" style="
                            position:absolute;inset:0;background:#333;border-radius:24px;
                            transition:background .2s;"></span>
                        <span id="autotpa-knob" style="
                            position:absolute;left:3px;bottom:3px;width:18px;height:18px;
                            background:#fff;border-radius:50%;transition:transform .2s;"></span>
                    </label>
                </div>

                <!-- Player whitelist -->
                <div>
                    <div style="color:#aaa;font-size:12px;margin-bottom:6px;">
                        Whitelisted Players
                        <span style="color:#555;"> — one username per line</span>
                    </div>
                    <textarea id="autotpa-players" rows="6" placeholder="Steve&#10;Alex&#10;Notch"
                        oninput="onAutoTpaPlayersInput()"
                        style="
                            display:block;width:100%;box-sizing:border-box;
                            background:#111;border:1px solid #444;border-radius:6px;
                            color:#e0d0ff;padding:8px 10px;font-family:'Fira Code',monospace;
                            font-size:13px;resize:vertical;outline:none;line-height:1.5;
                            transition:border-color .15s;">
                    </textarea>
                    <div id="autotpa-status" style="color:#666;font-size:11px;margin-top:5px;min-height:16px;"></div>
                </div>

                <div style="display:flex;gap:8px;">
                    <button onclick="saveAutoTpaSettings()" style="
                        background:#a78bfa;color:#111;border:none;border-radius:5px;
                        padding:7px 18px;cursor:pointer;font-weight:bold;font-size:13px;
                        transition:background .15s;">
                        💾 Save
                    </button>
                    <button onclick="reloadAutoTpaSettings()" style="
                        background:#333;color:#aaa;border:1px solid #444;border-radius:5px;
                        padding:7px 14px;cursor:pointer;font-size:13px;
                        transition:background .15s;">
                        ↺ Reload
                    </button>
                </div>
            </div>

        </div>
    `;
}

async function reloadAutoTpaSettings() {
    // Alias kept for the ↺ Reload button in the UI
    await refreshSettingsTab();
}

function _syncAutoTpaSlider() {
    const enabledEl = document.getElementById('autotpa-enabled');
    const slider    = document.getElementById('autotpa-slider');
    const knob      = document.getElementById('autotpa-knob');
    const label     = document.getElementById('autotpa-toggle-label');
    if (!slider || !knob) return;
    const isOn = label ? label.dataset.enabled === 'true' : (enabledEl?.checked || false);
    if (isOn) {
        slider.style.background = '#a78bfa';
        knob.style.transform    = 'translateX(20px)';
    } else {
        slider.style.background = '#333';
        knob.style.transform    = 'translateX(0)';
    }
}

function onAutoTpaToggle() {
    const enabledEl = document.getElementById('autotpa-enabled');
    const label     = document.getElementById('autotpa-toggle-label');
    if (!enabledEl) return;
    const isOn  = enabledEl.checked;
    const botId = typeof activeBotId !== 'undefined' ? activeBotId : null;
    if (label) label.dataset.enabled = String(isOn);
    // Persist in the per-bot cache so tab switches don't lose the state
    if (botId !== null) _autoTpaEnabledByBot.set(botId, isOn);
    _syncAutoTpaSlider();

    // Immediately push the new enabled state to the backend.
    // We only send `enabled` here — the backend will keep the existing players list intact.
    if (botId !== null) {
        window.api.setAutoTpaEnabled(botId, isOn).then(result => {
            const statusEl = document.getElementById('autotpa-status');
            const playersEl = document.getElementById('autotpa-players');
            const count = playersEl
                ? playersEl.value.split('\n').map(s => s.trim()).filter(s => /^[A-Za-z0-9_]{1,16}$/.test(s)).length
                : 0;
            if (statusEl) statusEl.textContent = isOn
                ? `✅ Active — ${count} player(s) whitelisted`
                : `⏸ Disabled`;
            console.log('[AutoTPA] toggle auto-save botId=' + botId + ' enabled=' + isOn + ' result=' + JSON.stringify(result));
        });
    }
}
function onAutoTpaPlayersInput() {
    // Live feedback: count non-empty lines
    const playersEl = document.getElementById('autotpa-players');
    const statusEl  = document.getElementById('autotpa-status');
    if (!playersEl || !statusEl) return;
    const count = playersEl.value.split('\n').map(s => s.trim()).filter(Boolean).length;
    statusEl.textContent = count > 0 ? `${count} player(s) listed — remember to Save` : '';
}

async function saveAutoTpaSettings() {
    const botId     = typeof activeBotId !== 'undefined' ? activeBotId : null;
    const enabledEl = document.getElementById('autotpa-enabled');
    const playersEl = document.getElementById('autotpa-players');
    const statusEl  = document.getElementById('autotpa-status');
    if (!enabledEl || !playersEl) return;

    const players = playersEl.value
        .split('\n')
        .map(s => s.trim())
        .filter(s => /^[A-Za-z0-9_]{1,16}$/.test(s)); // only valid MC names

    // Sync cleaned list back to textarea
    playersEl.value = players.join('\n');

    if (botId === null) {
        if (statusEl) statusEl.textContent = '⚠️ No bot selected — cannot save.';
        return;
    }

    try {
        const isEnabled = botId !== null ? _autoTpaEnabledFor(botId) : false;
        console.log('[AutoTPA] saving botId=' + botId + ' enabled=' + isEnabled + ' players=' + JSON.stringify(players));
        const result = await window.api.setAutoTpa(botId, { enabled: isEnabled, players });
        if (result?.success) {
            if (statusEl) statusEl.textContent = isEnabled
                ? `✅ Saved & active — ${players.length} player(s) whitelisted`
                : `💾 Saved — disabled`;
            // Flash the save button green
            const btn = document.querySelector('[onclick="saveAutoTpaSettings()"]');
            if (btn) {
                const orig = btn.style.background;
                btn.style.background = '#22c55e';
                setTimeout(() => { btn.style.background = orig; }, 800);
            }
        } else {
            if (statusEl) statusEl.textContent = `⚠️ ${result?.error || 'Failed to save'}`;
        }
    } catch (err) {
        if (statusEl) statusEl.textContent = `⚠️ Bot not connected — cannot save. Start the bot first.`;
    }
}

// ─── Hooks from renderer.js ───────────────────────────────────────────────────
window.tabsOnBotUpdate = function(data) {
    if (data.accountId !== (typeof activeBotId !== 'undefined' ? activeBotId : null)) return;
    if (data.inventorySlots) {
        const bot = bots?.[data.accountId];
        if (bot) bot.inventorySlots = data.inventorySlots;
    }
    if (activeTab === 'inventory' && !activeContainer) refreshInventoryUI();
    if (activeTab === 'statistics') {
        const bot = typeof bots !== 'undefined' ? bots[data.accountId] : null;
        updateStatsCards(bot);
    }
    // Settings tab is intentionally NOT refreshed on every bot-update to prevent
    // overwriting unsaved toggle/textarea edits. It reloads on tab-switch instead.
};

window.tabsOnBotDeath = function(data) {
    sessionStats.deathCount++;
    if (activeTab === 'statistics') refreshStatisticsUI();
};

window.tabsOnChatSent = function() {
    sessionStats.chatMessagesSent++;
};

// ─── Init ─────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabs);
} else {
    initTabs();
}