// settings.js - Full implementation of the Settings tab
// Handles: Connection, Bot Behaviour, Console Display, Notifications, Auto-TPA
// All settings are persisted to localStorage under the key 'mc_settings'.
'use strict';

// ── Default values ────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'mc_settings';

const DEFAULTS = {
    // Connection
    autoreconnect:     true,
    reconnectDelay:    5000,
    reconnectMax:      0,
    mcVersion:         '1.21.1',

    // Bot Behaviour
    autorespawn:       false,
    antiafk:           false,
    antiafkInterval:   30000,
    autoeat:           false,
    autoeatThreshold:  14,
    healthDisconnect:  0,

    // Console Display
    timestamps:        true,
    maxLines:          500,
    logLevel:          'all',
    highlightWords:    '',

    // Notifications
    notifications:     false,
    mentionNotif:      true,
    mentionSound:      true,
};

// ── Load / save ───────────────────────────────────────────────────────────────
function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULTS };
}

function saveSettingsToStorage(obj) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj)); } catch {}
}

// ── Read current values from DOM ──────────────────────────────────────────────
function readSettingsFromDOM() {
    const get  = id => document.getElementById(id);
    const bool = id => { const el = get(id); return el ? el.checked : DEFAULTS[id]; };
    const num  = id => { const el = get(id); return el ? (parseInt(el.value) || 0) : 0; };
    const str  = id => { const el = get(id); return el ? el.value.trim() : ''; };

    return {
        autoreconnect:     bool('setting-autoreconnect'),
        reconnectDelay:    Math.max(500, num('setting-reconnect-delay')),
        reconnectMax:      Math.max(0,   num('setting-reconnect-max')),
        mcVersion:         str('setting-mc-version') || '1.21.1',

        autorespawn:       bool('setting-autorespawn'),
        antiafk:           bool('setting-antiafk'),
        antiafkInterval:   Math.max(5000, num('setting-antiafk-interval')),
        autoeat:           bool('setting-autoeat'),
        autoeatThreshold:  Math.min(19, Math.max(1, num('setting-autoeat-threshold'))),
        healthDisconnect:  Math.min(19, Math.max(0, num('setting-health-disconnect'))),

        timestamps:        bool('setting-timestamps'),
        maxLines:          Math.max(50, num('setting-maxlines')),
        logLevel:          str('setting-loglevel') || 'all',
        highlightWords:    str('setting-highlight-words'),

        notifications:     bool('setting-notifs'),
        mentionNotif:      bool('setting-mention-notif'),
        mentionSound:      bool('setting-mention-sound'),
    };
}

// ── Apply saved values to DOM inputs ─────────────────────────────────────────
function applySettingsToDOM(s) {
    const set     = (id, val) => { const el = document.getElementById(id); if (el) el.value   = val; };
    const setChk  = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    const setSel  = (id, val) => { const el = document.getElementById(id); if (el) el.value   = val; };

    setChk('setting-autoreconnect',    s.autoreconnect);
    set   ('setting-reconnect-delay',  s.reconnectDelay);
    set   ('setting-reconnect-max',    s.reconnectMax);
    setSel('setting-mc-version',       s.mcVersion);

    setChk('setting-autorespawn',      s.autorespawn);
    setChk('setting-antiafk',          s.antiafk);
    set   ('setting-antiafk-interval', s.antiafkInterval);
    setChk('setting-autoeat',          s.autoeat);
    set   ('setting-autoeat-threshold',s.autoeatThreshold);
    set   ('setting-health-disconnect',s.healthDisconnect);

    setChk('setting-timestamps',       s.timestamps);
    set   ('setting-maxlines',         s.maxLines);
    setSel('setting-loglevel',         s.logLevel);
    set   ('setting-highlight-words',  s.highlightWords);

    setChk('setting-notifs',           s.notifications);
    setChk('setting-mention-notif',    s.mentionNotif);
    setChk('setting-mention-sound',    s.mentionSound);
}

// ── Push connection + behaviour settings to main process ─────────────────────
async function pushSettingsToMain(s) {
    if (window.api?.setReconnectSettings) {
        await window.api.setReconnectSettings({
            enabled:  s.autoreconnect,
            delayMs:  s.reconnectDelay,
            maxTries: s.reconnectMax,
        });
    }
    if (window.api?.setBotBehaviourSettings) {
        await window.api.setBotBehaviourSettings({
            autorespawn:      s.autorespawn,
            antiafk:          s.antiafk,
            antiafkInterval:  s.antiafkInterval,
            autoeat:          s.autoeat,
            autoeatThreshold: s.autoeatThreshold,
            healthDisconnect: s.healthDisconnect,
            mcVersion:        s.mcVersion,
        });
    }
}

// ── Main save handler (called by the Save Settings button) ────────────────────
async function saveSettings() {
    const s = readSettingsFromDOM();
    saveSettingsToStorage(s);
    await pushSettingsToMain(s);

    // Apply console display settings immediately
    _applyConsoleDisplaySettings(s);

    // Visual feedback on the save button
    const btn = document.querySelector('.settings-save-btn[onclick="saveSettings()"]');
    if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✅ Saved!';
        btn.style.background = 'linear-gradient(135deg,#166534,#15803d)';
        setTimeout(() => {
            btn.textContent = orig;
            btn.style.background = '';
        }, 1200);
    }

    // Update notification permission status display
    _updateNotifPermissionStatus();
}

// ── Console display: apply log-level, timestamp, maxLines, highlight ──────────
function _applyConsoleDisplaySettings(s) {
    // Toggle timestamp visibility via CSS class on #console
    const consoleEl = document.getElementById('console');
    if (consoleEl) {
        consoleEl.classList.toggle('hide-timestamps', !s.timestamps);
    }

    // Inject/update a <style> for log-level filtering and highlights
    let styleEl = document.getElementById('settings-console-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'settings-console-style';
        document.head.appendChild(styleEl);
    }

    const hiddenTypes = _hiddenLogTypes(s.logLevel);
    const hideRules = hiddenTypes.map(t => `.log-${t} { display: none !important; }`).join('\n');
    const tsRule   = s.timestamps ? '' : '.timestamp { display: none !important; }';
    styleEl.textContent = [hideRules, tsRule].filter(Boolean).join('\n');

    // Prune to maxLines immediately
    if (consoleEl) {
        while (consoleEl.children.length > s.maxLines) {
            consoleEl.removeChild(consoleEl.firstChild);
        }
    }
}

function _hiddenLogTypes(level) {
    // Severity order: info < success < chat < command < warning < error
    const all = ['info', 'success', 'chat', 'command', 'warning', 'error'];
    const show = {
        all:   all,
        info:  all,
        warn:  ['warning', 'error'],
        error: ['error'],
    }[level] ?? all;
    return all.filter(t => !show.includes(t));
}

// ── Notification permission ───────────────────────────────────────────────────
function _updateNotifPermissionStatus() {
    const statusEl = document.getElementById('notif-permission-status');
    const btnEl    = document.getElementById('notif-permission-btn');
    if (!statusEl) return;
    const perm = Notification?.permission ?? 'unsupported';
    const labels = {
        granted:  'Status: ✅ Granted',
        denied:   'Status: ❌ Denied — change in browser/OS settings',
        default:  'Status: ⚠️ Not yet requested',
        unsupported: 'Status: Not supported in this context',
    };
    statusEl.textContent = labels[perm] ?? `Status: ${perm}`;
    if (btnEl) btnEl.style.display = perm === 'granted' ? 'none' : '';
}

async function requestNotifPermission() {
    if (!('Notification' in window)) {
        alert('Desktop notifications are not supported in this context.');
        return;
    }
    const result = await Notification.requestPermission();
    _updateNotifPermissionStatus();
    if (result === 'granted') {
        new Notification('🎮 Notifications enabled!', {
            body: 'You will now receive alerts for bot events.',
            silent: true,
        });
    }
}

// ── Initialise on page load ───────────────────────────────────────────────────
function initSettings() {
    const s = loadSettings();
    applySettingsToDOM(s);
    _applyConsoleDisplaySettings(s);
    _updateNotifPermissionStatus();
    // Push persisted connection/behaviour settings to main on startup
    pushSettingsToMain(s);
}

// ── Export a live getter for renderer / botConnection to consume ──────────────
function getSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULTS };
}

// ── Patch addLog to respect display settings ──────────────────────────────────
// Called once during init — wraps the addLog defined in renderer.js.
function patchAddLog() {
    if (typeof window._originalAddLog !== 'undefined') return; // already patched
    if (typeof addLog !== 'function') return;
    window._originalAddLog = addLog;

    window.addLog = function(type, message) {
        const s = getSettings();

        // Log-level filter
        const hiddenTypes = _hiddenLogTypes(s.logLevel);
        if (hiddenTypes.includes(type)) return;

        const consoleEl = document.getElementById('console');
        const line = document.createElement('div');
        line.className = `console-line log-${type}`;
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

        // Escape and optionally highlight
        let escaped = escapeHtml(message);
        const words = s.highlightWords
            ? s.highlightWords.split(',').map(w => w.trim()).filter(Boolean)
            : [];
        if (words.length > 0) {
            words.forEach(word => {
                const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re   = new RegExp(`(${safe})`, 'gi');
                escaped    = escaped.replace(re, '<span class="log-highlight">$1</span>');
            });
        }

        if (s.timestamps) {
            line.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${escaped}`;
        } else {
            line.innerHTML = escaped;
        }

        consoleEl?.appendChild(line);
        if (consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
            // Prune to maxLines
            while (consoleEl.children.length > (s.maxLines || 500)) {
                consoleEl.removeChild(consoleEl.firstChild);
            }
        }
    };
}

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initSettings(); patchAddLog(); });
} else {
    initSettings();
    patchAddLog();
}
