// renderer.js - With surround command support
let authenticatedAccounts = [];
let bots = [];
let activeBotId = null;
let selectedBots = new Set();
let isAuthenticating = false;
let commandHistories = {};   // botId → string[]
let historyIndex = -1;

async function init() {
    await loadBots();
    setupEventListeners();
}

async function loadBots() {
    bots = await window.api.getBots();
    authenticatedAccounts = await window.api.getAuthenticatedAccounts();
    renderBots();
    if (bots.length > 0 && activeBotId === null) {
        switchBot(0);
    }
}

function getPlayerUUID(accountIdentifier) {
    const account = authenticatedAccounts.find(acc => acc.identifier === accountIdentifier);
    return account ? account.uuid : null;
}

function formatUUID(uuid) {
    if (!uuid) return null;
    const clean = uuid.replace(/-/g, '');
    if (clean.length === 32) {
        return `${clean.substring(0, 8)}-${clean.substring(8, 12)}-${clean.substring(12, 16)}-${clean.substring(16, 20)}-${clean.substring(20)}`;
    }
    return uuid;
}

function renderBots() {
    const container = document.getElementById('accountList');
    container.innerHTML = bots.map((bot, idx) => {
        const isActive = idx === activeBotId;
        const isSelected = selectedBots.has(idx);
        const status = bot.status || 'offline';
        const uuid = getPlayerUUID(bot.accountIdentifier);
        const formattedUUID = formatUUID(uuid);
        const headUrl = formattedUUID 
            ? `https://minotar.net/avatar/${formattedUUID}/64` 
            : `https://minotar.net/avatar/MHF_Steve/64`;

        return `
            <div class="account-icon ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" 
                 data-index="${idx}"
                 title="${bot.name} (${bot.accountIdentifier}) - ${status}">
                <img src="${headUrl}" 
                     alt="${bot.name}" 
                     style="width: 48px; height: 48px; image-rendering: pixelated;"
                     onerror="this.onerror=null; this.src='https://mc-heads.net/avatar/${formattedUUID || 'MHF_Steve'}/64';">
                <div class="status-dot status-${status}"></div>
            </div>
        `;
    }).join('') + '<div class="add-account" id="addAccountBtn" title="Add Bot">+</div>';
    
    const addBtn = document.getElementById('addAccountBtn');
    if (addBtn) addBtn.addEventListener('click', showAddAccountModal);
    updateSelectionCounter();
}

function updateSelectionCounter() {
    let counter = document.getElementById('selectionCounter');
    if (!counter) {
        counter = document.createElement('div');
        counter.id = 'selectionCounter';
        counter.style.cssText = 'position: fixed; bottom: 60px; left: 10px; background: #2d2d2d; padding: 8px 12px; border-radius: 4px; font-size: 12px; border: 1px solid #4caf50; z-index: 999;';
        document.body.appendChild(counter);
    }
    if (selectedBots.size > 0) {
        counter.textContent = `📌 ${selectedBots.size} bot${selectedBots.size > 1 ? 's' : ''} selected`;
        counter.style.display = 'block';
    } else {
        counter.style.display = 'none';
    }
}

function handleBotClick(index, isShiftClick) {
    if (index < 0 || index >= bots.length) return;
    if (isShiftClick) {
        if (selectedBots.has(index)) {
            selectedBots.delete(index);
        } else {
            selectedBots.add(index);
        }
        renderBots();
    } else {
        selectedBots.clear();
        switchBot(index);
    }
}

function switchBot(index) {
    if (index < 0 || index >= bots.length) return;
    activeBotId = index;
    historyIndex = (commandHistories[index] || []).length;
    renderBots();
    const bot = bots[index];
    document.getElementById('promptText').textContent = `${bot.name} >`;
    addLog('info', `Switched to bot: ${bot.name} (using ${bot.accountIdentifier})`);
    updateHeaderStats(bot);
}

function updateHeaderStats(bot) {
    document.getElementById('username').textContent = bot.connectedUsername || bot.accountIdentifier || 'Not Connected';

    if (bot.position) {
        document.getElementById('coordinates').textContent = 
            `X: ${bot.position.x}, Y: ${bot.position.y}, Z: ${bot.position.z}`;
    } else {
        document.getElementById('coordinates').textContent = 'X: 0, Y: 0, Z: 0';
    }

    const healthBar = document.getElementById('healthBar');
    const health = bot.health || 0;
    const fullHearts = Math.floor(health / 2);
    const halfHeart = health % 2;
    const emptyHearts = 10 - fullHearts - halfHeart;
    healthBar.innerHTML = '❤️'.repeat(fullHearts) + (halfHeart ? '🤍' : '') + '🖤'.repeat(emptyHearts);

    const hungerBar = document.getElementById('hungerBar');
    const food = bot.food || 0;
    const fullFood = Math.floor(food / 2);
    const halfFood = food % 2;
    const emptyFood = 10 - fullFood - halfFood;
    hungerBar.innerHTML = '🍖'.repeat(fullFood) + (halfFood ? '🥩' : '') + '🖤'.repeat(emptyFood);
    
    const sneakStatus = document.getElementById('sneakStatus');
    const sneakText   = document.getElementById('sneakText');
    if (bot.sneaking) {
        sneakStatus.classList.remove('inactive');
        sneakStatus.classList.add('active');
        if (sneakText) sneakText.textContent = 'Sneaking';
    } else {
        sneakStatus.classList.remove('active');
        sneakStatus.classList.add('inactive');
        if (sneakText) sneakText.textContent = 'Sneak';
    }
    
    const attackStatus = document.getElementById('attackStatus');
    const attackText = document.getElementById('attackText');
    if (attackStatus && attackText) {
        if (bot.attacking) {
            attackStatus.classList.remove('inactive');
            attackStatus.classList.add('active');
            attackText.textContent = `Attack (${bot.attackTicks}t)`;
        } else {
            attackStatus.classList.remove('active');
            attackStatus.classList.add('inactive');
            attackText.textContent = 'Attack';
        }
    }

    const followStatus = document.getElementById('followStatus');
    const followText = document.getElementById('followText');
    if (bot.following) {
        followStatus.classList.remove('inactive');
        followStatus.classList.add('active');
        followText.textContent = `Follow: ${bot.following}`;
    } else if (bot.surrounding) {
        followStatus.classList.remove('inactive');
        followStatus.classList.add('active');
        followText.textContent = `Surround: ${bot.surrounding}`;
    } else {
        followStatus.classList.remove('active');
        followStatus.classList.add('inactive');
        followText.textContent = 'Follow';
    }

    const clickStatus = document.getElementById('clickStatus');
    const clickText   = document.getElementById('clickText');
    if (clickStatus && clickText) {
        const c = bot.clicking;
        if (c && typeof c === 'object' && !c.button && (c.left || c.right)) {
            // New dual-click format
            clickStatus.classList.remove('inactive');
            clickStatus.classList.add('active');
            const parts = [];
            if (c.left)  parts.push(`L${c.left.hold ? '(hold)' : ''}/${c.left.ticks}t`);
            if (c.right) parts.push(`R${c.right.hold ? '(hold)' : ''}/${c.right.ticks}t`);
            clickText.textContent = parts.join(' + ');
        } else if (c && c.button) {
            // Legacy single-button format
            clickStatus.classList.remove('inactive');
            clickStatus.classList.add('active');
            clickText.textContent = `${c.button === 'right' ? 'Right' : 'Left'} click / ${c.ticks}t`;
        } else {
            clickStatus.classList.remove('active');
            clickStatus.classList.add('inactive');
            clickText.textContent = 'Mouse Control';
        }
    }

    const hotbarEl = document.getElementById('hotbar');
    if (bot.hotbar && bot.hotbar.length > 0) {
        hotbarEl.innerHTML = bot.hotbar.map((item, idx) => {
            const isSelected = idx === (bot.heldItem || 0);
            const slotClass = isSelected ? 'hotbar-slot selected' : 'hotbar-slot';
            if (item) {
                const itemName = item.name.replace('minecraft:', '');
                const img = getItemImg(itemName);
                const count = item.count > 1 ? `<span class="count">${item.count}</span>` : '';
                return `<div class="${slotClass}" data-slot="${idx}" title="${itemName} x${item.count}">${img}${count}</div>`;
            } else {
                return `<div class="${slotClass}" data-slot="${idx}"></div>`;
            }
        }).join('');
    } else {
        hotbarEl.innerHTML = Array(9).fill(0).map((_, idx) => {
            const isSelected = idx === 0;
            return `<div class="${isSelected ? 'hotbar-slot selected' : 'hotbar-slot'}" data-slot="${idx}"></div>`;
        }).join('');
    }
    
}

function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

function getPingColor(ping) {
    if (ping === undefined || ping === 0) return '#888';
    if (ping < 50) return '#00ff88';
    if (ping < 100) return '#1e90ff';
    if (ping < 200) return '#ffaa00';
    return '#ff3366';
}

const MC_ASSET_BASE = 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures';

// Items that live under block/ instead of item/ in the asset repo
const BLOCK_ITEMS = new Set([
    'grass_block','dirt','coarse_dirt','rooted_dirt','podzol','mycelium',
    'stone','granite','diorite','andesite','cobblestone','mossy_cobblestone',
    'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log',
    'oak_planks','spruce_planks','birch_planks','jungle_planks','acacia_planks','dark_oak_planks',
    'sand','red_sand','gravel','coal_ore','iron_ore','gold_ore','diamond_ore',
    'emerald_ore','lapis_ore','redstone_ore','copper_ore',
    'iron_block','gold_block','diamond_block','emerald_block','coal_block',
    'netherrack','soul_sand','soul_soil','glowstone','obsidian','bedrock',
    'tnt','crafting_table','furnace','chest','ender_chest','trapped_chest',
    'bookshelf','jukebox','note_block','dispenser','dropper','hopper',
    'torch','redstone_torch','lantern','soul_lantern',
    'glass','white_glass','oak_leaves','spruce_leaves',
    'water','lava','ice','packed_ice','blue_ice','snow_block','snow',
    'cactus','melon','pumpkin','carved_pumpkin','hay_block',
    'white_wool','orange_wool','magenta_wool','light_blue_wool','yellow_wool',
    'lime_wool','pink_wool','gray_wool','light_gray_wool','cyan_wool',
    'purple_wool','blue_wool','brown_wool','green_wool','red_wool','black_wool',
    'white_concrete','orange_concrete','yellow_concrete','lime_concrete',
    'sandstone','red_sandstone','quartz_block','purpur_block',
    'terracotta','white_terracotta','orange_terracotta',
    'nether_brick','red_nether_bricks','end_stone','end_stone_bricks',
    'crying_obsidian','blackstone','gilded_blackstone',
    'shroomlight','sea_lantern','magma_block',
]);

function getItemImg(itemName, size = '100%') {
    if (!itemName) return '';
    const name = itemName.replace('minecraft:', '');
    const subdir = BLOCK_ITEMS.has(name) ? 'block' : 'item';
    const url = `${MC_ASSET_BASE}/${subdir}/${name}.png`;
    return `<img src="${url}" style="width:${size};height:${size};image-rendering:pixelated;"
        onerror="this.onerror=null;this.src='${MC_ASSET_BASE}/block/${name}.png';this.onerror=function(){this.style.display='none';this.nextSibling&&(this.nextSibling.style.display='');};">`;
}

function addLog(type, message) {
    const consoleEl = document.getElementById('console');
    const line = document.createElement('div');
    line.className = `console-line log-${type}`;
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    line.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${escapeHtml(message)}`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    while (consoleEl.children.length > 500) consoleEl.removeChild(consoleEl.firstChild);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showAddAccountModal() {
    document.getElementById('addAccountModal').classList.add('active');
}

function showCreateAccountModal() {
    closeModal();
    document.getElementById('createAccountModal').classList.add('active');
    document.getElementById('accountIdentifier').value = '';
    setTimeout(() => {
        document.getElementById('accountIdentifier').focus();
    }, 100);
}

async function showCreateBotModal() {
    closeModal();
    authenticatedAccounts = await window.api.getAuthenticatedAccounts();
    const select = document.getElementById('botAccountSelect');

    if (authenticatedAccounts.length === 0) {
        select.innerHTML = '<option value="">No authenticated accounts found!</option>';
        addLog('warning', 'You need to authenticate a Microsoft account first!');
    } else {
        select.innerHTML = authenticatedAccounts.map(acc => {
            const date = new Date(acc.lastModified).toLocaleDateString();
            return `<option value="${acc.identifier}">${acc.identifier} (cached ${date})</option>`;
        }).join('');
    }

    document.getElementById('botName').value = '';
    document.getElementById('botServerAddress').value = '';
    document.getElementById('botServerPort').value = '25565';
    document.getElementById('createBotModal').classList.add('active');
}

function showBotSettings(index) {
    const bot = bots[index];
    activeBotId = index;
    document.getElementById('editAccountName').value = bot.name || '';
    document.getElementById('editUsername').value = bot.accountIdentifier || '';
    document.getElementById('editServerAddress').value = bot.server;
    document.getElementById('editServerPort').value = bot.port;
    document.getElementById('accountSettingsModal').classList.add('active');
}

function closeModal() {
    if (isAuthenticating) {
        addLog('error', '❌ Cannot close - authentication in progress!');
        return;
    }
    document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('active'));
}

async function showManageAccountsModal() {
    closeModal();
    authenticatedAccounts = await window.api.getAuthenticatedAccounts();
    const list = document.getElementById('manageAccountsList');
    if (!list) return;

    if (authenticatedAccounts.length === 0) {
        list.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:16px 0;">No authenticated accounts found.</div>';
    } else {
        list.innerHTML = authenticatedAccounts.map(acc => {
            const date = acc.lastModified ? new Date(acc.lastModified).toLocaleDateString() : '—';
            const tokenValid = acc.hasValidToken;
            const statusColor = tokenValid ? 'var(--terra)' : '#e8a020';
            const statusLabel = tokenValid ? '✓ Token valid' : '⚠ Token expired';
            return `
            <div style="
                display:flex; align-items:center; gap:10px;
                background:rgba(0,0,0,0.25); border:1px solid var(--border);
                border-radius:9px; padding:9px 11px;">
                <img src="https://minotar.net/avatar/${acc.uuid || 'MHF_Steve'}/32"
                     style="width:32px;height:32px;image-rendering:pixelated;border-radius:6px;flex-shrink:0;"
                     onerror="this.src='https://minotar.net/avatar/MHF_Steve/32'">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;color:var(--sand);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(acc.username || acc.identifier)}</div>
                    <div style="font-size:10px;color:var(--dim);margin-top:1px;">${escapeHtml(acc.identifier)} &nbsp;·&nbsp; <span style="color:${statusColor}">${statusLabel}</span> &nbsp;·&nbsp; ${date}</div>
                </div>
                <button onclick="deleteAuthAccount('${escapeHtml(acc.identifier)}')"
                    style="flex-shrink:0;padding:5px 11px;border-radius:7px;border:1px solid rgba(216,48,32,0.4);
                           background:rgba(216,48,32,0.12);color:#e05040;cursor:pointer;
                           font-family:'Syne',sans-serif;font-size:10px;font-weight:700;
                           letter-spacing:.5px;text-transform:uppercase;
                           transition:background .15s,border-color .15s;"
                    onmouseover="this.style.background='rgba(216,48,32,0.25)';this.style.borderColor='rgba(216,48,32,0.7)'"
                    onmouseout="this.style.background='rgba(216,48,32,0.12)';this.style.borderColor='rgba(216,48,32,0.4)'">
                    🗑 Delete
                </button>
            </div>`;
        }).join('');
    }

    document.getElementById('manageAccountsModal').classList.add('active');
}

async function deleteAuthAccount(identifier) {
    const acc = authenticatedAccounts.find(a => a.identifier === identifier);
    const label = acc ? `"${acc.username || identifier}"` : `"${identifier}"`;

    if (!confirm(`Delete account ${label}?\n\nThis will:\n• Remove the stored Microsoft token\n• Delete the auth cache from disk\n• Disconnect any bots using this account\n\nYou will need to re-authenticate to use this account again.`)) return;

    const result = await window.api.deleteAccount(identifier);
    if (result.success) {
        addLog('success', `✅ Account ${label} deleted — tokens and cache removed`);
        // Refresh the list in-place
        await showManageAccountsModal();
        // Also refresh the bots list since some may have been disconnected
        await loadBots();
    } else {
        addLog('error', `❌ Failed to delete account: ${result.error || 'Unknown error'}`);
    }
}

async function createMicrosoftAccount() {
    if (isAuthenticating) {
        addLog('error', '❌ Authentication already in progress!');
        return;
    }

    const usernameInput = document.getElementById('accountIdentifier');
    const username = usernameInput.value.trim();
    
    if (!username) {
        addLog('error', '❌ Please enter an account identifier');
        usernameInput.focus();
        return;
    }

    isAuthenticating = true;
    const btn = document.getElementById('createAcctBtn');
    const cancelBtn = document.getElementById('cancelCreateAcctBtn');
    const originalText = btn.textContent;

    btn.textContent = 'Authenticating...';
    btn.disabled = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Please Wait...';
    usernameInput.disabled = true;

    try {
        addLog('info', `🔑 Starting Microsoft authentication for "${username}"...`);
        const result = await window.api.createMicrosoftAccount(username);

        if (result.success) {
            addLog('success', `✅ Authentication successful!`);
            await loadBots(); 
            closeModal();
        } else {
            addLog('error', `❌ Authentication failed: ${result.error || 'Unknown error'}`);
        }
    } catch (err) {
        addLog('error', `❌ Authentication error: ${err.message || err.toString()}`);
    } finally {
        isAuthenticating = false;
        btn.textContent = originalText;
        btn.disabled = false;
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel';
        usernameInput.disabled = false;
    }
}

async function createBot() {
    const accountIdentifier = document.getElementById('botAccountSelect').value;
    if (!accountIdentifier) {
        addLog('error', 'Please select an authenticated account');
        return;
    }

    const serverAddress = document.getElementById('botServerAddress').value.trim();
    if (!serverAddress) {
        addLog('error', '❌ Please enter a server address');
        document.getElementById('botServerAddress').focus();
        return;
    }
    const serverPort = parseInt(document.getElementById('botServerPort').value.trim()) || 25565;

    if (serverPort < 1 || serverPort > 65535) {
        addLog('error', 'Invalid port number (must be 1-65535)');
        return;
    }

    // Get Discord configuration (optional — fields may not exist in all UI versions)
    const discordToken = document.getElementById('botDiscordToken')?.value.trim() ?? '';
    const discordChannelsInput = document.getElementById('botDiscordChannels')?.value.trim() ?? '';

    // Parse channel IDs
    let discordChannels = [];
    if (discordChannelsInput) {
        discordChannels = discordChannelsInput
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0);
    }

    const botData = {
        name: document.getElementById('botName').value.trim() || accountIdentifier,
        accountIdentifier,
        server: serverAddress,
        port: serverPort,
        discordToken: discordToken || null,
        discordChannels: discordChannels
    };

    const result = await window.api.createBot(botData);

    if (result.success) {
        addLog('success', `✅ Bot "${botData.name}" created successfully`);
        if (discordToken) {
            addLog('info', '💬 Discord integration will be activated when bot connects');
        }
        await loadBots();
        switchBot(bots.length - 1);
        closeModal();
    } else {
        addLog('error', `Failed to create bot: ${result.error}`);
    }
}

async function saveBotSettings() {
    if (activeBotId === null) return;

    const server = document.getElementById('editServerAddress').value.trim();
    const port = parseInt(document.getElementById('editServerPort').value.trim());

    if (!server || port < 1 || port > 65535) {
        addLog('error', 'Invalid server address or port');
        return;
    }

    const result = await window.api.updateBot(activeBotId, { server, port });

    if (result.success) {
        addLog('success', 'Bot settings updated');
        await loadBots();
        closeModal();
    } else {
        addLog('error', `Failed to update bot: ${result.error}`);
    }
}

async function deleteCurrentBot() {
    if (activeBotId === null) return;

    const botToDelete = bots[activeBotId];
    if (!confirm(`Delete bot "${botToDelete.name}"?`)) return;

    const result = await window.api.deleteBot(activeBotId);

    if (result.success) {
        addLog('success', 'Bot deleted');
        const wasActive = activeBotId;
        activeBotId = null;
        selectedBots.clear();
        await loadBots();
        
        if (bots.length > 0) {
            const newIndex = Math.min(wasActive, bots.length - 1);
            switchBot(newIndex);
        }
        
        closeModal();
    } else {
        addLog('error', `Failed to delete bot: ${result.error}`);
    }
}

async function sendCommand() {
    const input = document.getElementById('commandInput');
    const text = input.value.trim();
    if (!text) return;

    // Add to per-bot command history
    if (activeBotId !== null) {
        if (!commandHistories[activeBotId]) commandHistories[activeBotId] = [];
        commandHistories[activeBotId].push(text);
        historyIndex = commandHistories[activeBotId].length;
    }

    input.value = '';

    if (selectedBots.size > 0) {
        addLog('info', `📌 Executing for ${selectedBots.size} bot(s)...`);
        
        for (const botId of selectedBots) {
            const bot = bots[botId];
            if (!bot) continue;
            
            if (text === '/connect' || text === 'connect') {
                addLog('info', `[${bot.name}] Connecting to ${bot.server}:${bot.port}...`);
                await window.api.connectBot(botId);
            } else if (text === '/disconnect' || text === 'disconnect') {
                addLog('info', `[${bot.name}] Disconnecting...`);
                await window.api.disconnectBot(botId);
            } else if (text === 'help' || text === '/help') {
                if (Array.from(selectedBots)[0] === botId) {
                    showHelp();
                }
            } else {
                const isConnected = bot.status === 'online' || bot.status === 'connecting';
                if (!isConnected) {
                    addLog('error', `[${bot.name}] Bot is not connected. Use "/connect" to connect first.`);
                    continue;
                }

                if (text.startsWith('/')) {
                    const result = await window.api.executeCommand(botId, text.substring(1));
                    if (!result.success) addLog('error', `[${bot.name}] ${result.error}`);
                } else {
                    const result = await window.api.sendChat(botId, text);
                    if (!result.success) addLog('error', `[${bot.name}] ${result.error}`);
                }
            }
        }
        
        return;
    }

    if (activeBotId === null || !bots[activeBotId]) {
        addLog('error', 'No bot selected');
        return;
    }

    const bot = bots[activeBotId];

    if (text === '/connect' || text === 'connect') {
        addLog('info', `Connecting ${bot.name} to ${bot.server}:${bot.port}...`);
        const result = await window.api.connectBot(activeBotId);
        if (!result.success) addLog('error', result.error);
        return;
    }

    if (text === '/disconnect' || text === 'disconnect') {
        addLog('info', 'Disconnecting...');
        const result = await window.api.disconnectBot(activeBotId);
        if (!result.success) addLog('error', result.error);
        return;
    }

    if (text === 'help' || text === '/help') {
        showHelp();
        return;
    }

    const isConnected = bot.status === 'online' || bot.status === 'connecting';
    if (!isConnected) {
        addLog('error', 'Bot is not connected. Use "/connect" to connect first.');
        return;
    }

    if (text.startsWith('/')) {
        const result = await window.api.executeCommand(activeBotId, text.substring(1));
        if (!result.success) addLog('error', result.error);
    } else {
        const result = await window.api.sendChat(activeBotId, text);
        if (!result.success) addLog('error', result.error);
    }
}

function showHelp() {
    addLog('info', '=== Available Commands ===');
    addLog('info', '/connect - Connect bot to server');
    addLog('info', '/disconnect - Disconnect bot');
    addLog('info', '/sneak - Toggle sneaking on/off');
    addLog('info', '/attack [0-50] - Attack entities (0=fastest, stop with /attack)');
    addLog('info', '/follow <player> - Follow a player');
    addLog('info', '/follow toggle - Stop following');
    addLog('info', '/surround <player> [radius] - Surround player in circle');
    addLog('info', '/surround toggle - Stop surrounding');
    addLog('info', '/punch <player> <run|circle> - Punch player and run/circle');
    addLog('info', '/punch stop - Stop punching');
    addLog('info', '/go <x> <y> <z> - Navigate to coordinates');
    addLog('info', '/hotbar [1-9] - Switch to hotbar slot');
    addLog('info', '/face [north|south|east|west] - Face a direction');
    addLog('info', '/list - List online players');
    addLog('info', '/formation <line|square|diamond|circle|stop> - Bot formations');
    addLog('info', '/emote or /sync - All bots crouch together');
    addLog('info', '/wave - Sequential crouch wave pattern');
    addLog('info', '/leader <bot_number|stop> - All bots follow one bot');
    addLog('info', '/tracker <save|stop> - Alert when players near position (Discord)');
    addLog('info', '/ai <prompt> - Natural language bot control (requires API key)');
    addLog('info', '/aikey <key> - Set Anthropic API key for AI commands');
    addLog('info', 'Shift+Click bots to multi-select');
}

// ── Mention sound (Web Audio API — no file needed) ────────────────────────────
function playMentionSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        // Two-tone "ping": a high note then a slightly lower follow-through
        const tones = [
            { freq: 880, start: 0,    dur: 0.12, vol: 0.55 },
            { freq: 1100, start: 0.05, dur: 0.18, vol: 0.7  },
            { freq: 880, start: 0.20, dur: 0.22, vol: 0.35 },
        ];

        tones.forEach(({ freq, start, dur, vol }) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
            gain.gain.setValueAtTime(0, ctx.currentTime + start);
            gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
            osc.start(ctx.currentTime + start);
            osc.stop(ctx.currentTime + start + dur + 0.05);
        });

        // Auto-close context after sounds finish
        setTimeout(() => { try { ctx.close(); } catch {} }, 800);
    } catch (e) {
        // AudioContext not available — silently ignore
    }
}

// ── Desktop / mention notification helper ─────────────────────────────────────
function fireMentionNotification(botName, message) {
    const s = getSettings();

    // Sound (independent of notification permission)
    if (s.mentionSound !== false) {
        playMentionSound();
    }

    // Desktop notification
    if ((s.mentionNotif !== false) && Notification.permission === 'granted') {
        try {
            new Notification(`📢 ${botName} was mentioned!`, {
                body: message,
                silent: true, // we handle sound ourselves
            });
        } catch (e) {}
    }
}

function fireEventNotification(title, body) {
    const s = getSettings();
    if (!s.notifications) return;
    if (Notification.permission !== 'granted') return;
    try {
        new Notification(title, { body, silent: false });
    } catch (e) {}
}

// Read current settings — delegates to localStorage so settings.js and renderer.js share state
function getSettings() {
    const DEFAULTS = {
        notifications: false, mentionNotif: true, mentionSound: true,
        timestamps: true, maxLines: 500, logLevel: 'all', highlightWords: '',
    };
    try {
        const raw = localStorage.getItem('mc_settings');
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {}
    // Fallback: read live from DOM for backwards-compat
    const get  = id => document.getElementById(id);
    const bool = id => { const el = get(id); return el ? el.checked : true; };
    return {
        ...DEFAULTS,
        notifications: bool('setting-notifs'),
        mentionNotif:  bool('setting-mention-notif'),
        mentionSound:  bool('setting-mention-sound'),
    };
}

function setupEventListeners() {
    window.api.onLog(data => {
        if (data.accountId === null || data.accountId === activeBotId) {
            addLog(data.type, data.message);
        }

        // ── Chat mention detection (runs for all bots, not just active) ──
        if (data.type === 'chat' && data.accountId !== null && data.accountId !== undefined) {
            const bot = bots[data.accountId];
            const botUsername = bot?.connectedUsername || bot?.accountIdentifier;
            if (botUsername && data.message) {
                // Case-insensitive whole-word match so "Steve" doesn't trigger on "Stevenson"
                const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex   = new RegExp(`\\b${escaped}\\b`, 'i');
                if (regex.test(data.message)) {
                    const displayName = bot.name || botUsername;
                    fireMentionNotification(displayName, data.message);
                }
            }
        }
    });

    // ── Bot death notification ─────────────────────────────────────────────
    if (typeof window.api.onBotDeath === 'function') {
        window.api.onBotDeath(data => {
            const bot = bots[data.accountId];
            const name = bot?.name || bot?.connectedUsername || `Bot ${data.accountId}`;
            fireEventNotification(`💀 ${name} died`, data.message || 'Your bot has died.');
            addLog('error', `💀 ${name} died: ${data.message || ''}`);
        });
    }

    window.api.onBotUpdate(data => { 
        if (data.accountId === activeBotId) {
            bots[activeBotId] = { 
                ...bots[activeBotId], 
                connectedUsername: data.username, 
                health: data.health, 
                food: data.food, 
                position: data.position,
                sneaking: data.sneaking,
                attacking: data.attacking,
                attackTicks: data.attackTicks,
                following: data.following,
                surrounding: data.surrounding,
                clicking: data.clicking,
                hotbar: data.hotbar,
                inventorySlots: data.inventorySlots,
                heldItem: data.heldItem,
                ping: data.ping,
                uptime: data.uptime,
                commandCount: data.commandCount
            };
            updateHeaderStats(bots[activeBotId]);
            if (typeof window.tabsOnBotUpdate === 'function') window.tabsOnBotUpdate(data);
        }
    });

    window.api.onConnectionStatus(data => { 
        if (data.accountId >= 0 && data.accountId < bots.length) {
            bots[data.accountId].status = data.status;
            if (data.status === 'offline' || data.status === 'disconnected' || data.status === 'reconnecting') {
                bots[data.accountId].sneaking    = false;
                bots[data.accountId].clicking    = null;
                bots[data.accountId].following   = null;
                bots[data.accountId].surrounding = null;
            }
            renderBots();
            if (data.accountId === activeBotId) {
                updateHeaderStats(bots[activeBotId]);
            }
        }
    });

    window.api.onBotAdded(async () => await loadBots());

    if (typeof window.api.onContainerOpen === 'function') {
        window.api.onContainerOpen(data => {
            if (data.accountId === activeBotId) {
                if (typeof window.tabsOnContainerOpen === 'function') window.tabsOnContainerOpen(data);
            }
        });
    }

    if (typeof window.api.onContainerClose === 'function') {
        window.api.onContainerClose(data => {
            if (data.accountId === activeBotId) {
                if (typeof window.tabsOnContainerClose === 'function') window.tabsOnContainerClose(data);
            }
        });
    }

    const commandInput = document.getElementById('commandInput');
    if (commandInput) {
        commandInput.addEventListener('keypress', e => { 
            if (e.key === 'Enter') sendCommand(); 
        });
        
        // Arrow key navigation for command history
        commandInput.addEventListener('keydown', e => {
            const history = (activeBotId !== null ? commandHistories[activeBotId] : null) || [];
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (history.length > 0 && historyIndex > 0) {
                    historyIndex--;
                    commandInput.value = history[historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex < history.length - 1) {
                    historyIndex++;
                    commandInput.value = history[historyIndex];
                } else {
                    historyIndex = history.length;
                    commandInput.value = '';
                }
            }
        });
    }

    document.addEventListener('keydown', e => { 
        if (e.key === 'Escape') {
            closeModal();
            closeClickerMenu();
            closeDirectionMenu();
            closeMovementMenu();
            closeFollowMenu();
            if (selectedBots.size > 0) {
                selectedBots.clear();
                renderBots();
            }
        }
    });
    
    document.addEventListener('click', e => {
        const icon = e.target.closest('.account-icon');
        if (icon) {
            const index = parseInt(icon.dataset.index);
            if (!isNaN(index)) {
                handleBotClick(index, e.shiftKey);
            }
        }
    });
    
    document.addEventListener('contextmenu', e => {
        const icon = e.target.closest('.account-icon');
        if (icon) {
            e.preventDefault();
            const index = parseInt(icon.dataset.index);
            if (!isNaN(index)) {
                showBotSettings(index);
            }
        }
    });
    
    // Clicker modal backdrop
    document.getElementById('clickerModal')?.addEventListener('click', function(e) {
        if (e.target === this) closeClickerMenu();
    });

    // Hotbar click handler - using mousedown to not interfere with other click handlers
    document.addEventListener('mousedown', e => {
        const hotbarSlot = e.target.closest('.hotbar-slot');
        if (hotbarSlot && activeBotId !== null && e.button === 0) { // Left click only
            e.stopPropagation(); // Prevent other handlers from processing this
            const slotIndex = parseInt(hotbarSlot.dataset.slot);
            if (!isNaN(slotIndex)) {
                switchHotbarSlot(slotIndex);
            }
        }
    });

    // ── Macro auto-trigger listeners ─────────────────────────────────────────
    // Cooldown tracker per macro id
    window._macroTriggerLastFired = window._macroTriggerLastFired || new Map();

    function fireMacroTrigger(triggerType, botId, extraData) {
        if (typeof macros === 'undefined') return;
        macros.forEach(macro => {
            const trig = macro?.trigger;
            if (!trig || trig.type !== triggerType) return;
            // Only fire for the active bot
            if (botId !== activeBotId) return;

            // Cooldown check
            const now  = Date.now();
            const last = window._macroTriggerLastFired.get(macro.id) || 0;
            if (now - last < (trig.cooldown ?? 2000)) return;

            // Per-type validation
            if (triggerType === 'on_chat_match') {
                const text = (trig.chatText || '').trim().toLowerCase();
                if (text && !extraData.message?.toLowerCase().includes(text)) return;
                if (trig.chatWhisperOnly && !extraData.isWhisper) return;
            }
            if (triggerType === 'on_player_enter') {
                const filter = (trig.playerName || '').trim();
                if (filter) {
                    const names = filter.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
                    if (!names.includes((extraData.playerName || '').toLowerCase())) return;
                }
            }

            window._macroTriggerLastFired.set(macro.id, now);
            if (typeof runMacro === 'function') runMacro(macro.id);
            addLog && addLog('info', `[Trigger] Macro "${macro.name}" fired — ${triggerType}`);
        });
    }

    // Bot hit trigger — watch for health drops in bot-update
    let _prevHealth = {};
    const _origOnBotUpdate = window.__macroTriggerBotUpdateBound;
    if (!_origOnBotUpdate) {
        window.__macroTriggerBotUpdateBound = true;
        window.api.onBotUpdate(data => {
            if (data.health !== undefined && data.accountId !== undefined) {
                const prev = _prevHealth[data.accountId];
                if (prev !== undefined && data.health < prev) {
                    fireMacroTrigger('on_hit', data.accountId, { damage: prev - data.health });
                }
                _prevHealth[data.accountId] = data.health;
            }
        });
    }

    // Chat-match trigger — watch chat logs
    window.api.onLog(data => {
        if (data.type === 'chat' && data.accountId !== null && data.accountId !== undefined) {
            const isWhisper = /^[\w_]+ whispers(?: to you)?:/i.test(data.message || '');
            fireMacroTrigger('on_chat_match', data.accountId, {
                message:   data.message || '',
                isWhisper,
            });
        }
    });

    // Player-enter-render-distance trigger — exposed via IPC event
    if (typeof window.api.onPlayerEnterRange === 'function') {
        window.api.onPlayerEnterRange(data => {
            fireMacroTrigger('on_player_enter', data.accountId, { playerName: data.playerName || '' });
        });
    }
}

async function switchHotbarSlot(slotIndex) {
    if (activeBotId === null || !bots[activeBotId]) return;
    
    const bot = bots[activeBotId];
    const isConnected = bot.status === 'online' || bot.status === 'connecting';
    if (!isConnected) {
        addLog('error', 'Bot is not connected');
        return;
    }

    // Immediate visual feedback before the bot-update event arrives
    const slotEls = document.querySelectorAll('.hotbar-slot');
    const slotEl  = slotEls[slotIndex];
    if (slotEl) {
        slotEl.style.transition  = 'none';
        slotEl.style.background  = 'rgba(193,68,14,0.4)';
        slotEl.style.borderColor = 'var(--terra)';
        setTimeout(() => {
            slotEl.style.transition  = '';
            slotEl.style.background  = '';
            slotEl.style.borderColor = '';
        }, 160);
    }
    
    await window.api.executeCommand(activeBotId, `hotbar ${slotIndex + 1}`);
}

// ── Auto-clicker UI ───────────────────────────────────────────────────────────
// Each side (left / right) has independent ticks and an optional "hold" mode.
const _clicker = {
    left:  { ticks: 1, hold: false },
    right: { ticks: 1, hold: false },
};

function toggleClickerMenu() {
    const m = document.getElementById('clickerModal');
    if (!m) return;
    if (m.style.display === 'flex') {
        m.style.display = 'none';
    } else {
        _refreshClickerModal();
        m.style.display = 'flex';
    }
}

function closeClickerMenu() {
    const m = document.getElementById('clickerModal');
    if (m) m.style.display = 'none';
}

/** Sync modal UI from live bot state so it always reflects reality on open. */
function _refreshClickerModal() {
    if (activeBotId === null) return;
    const bot = bots[activeBotId];
    const c = bot?.clicking;
    if (c && typeof c === 'object' && !c.button) {
        if (c.left)  { _clicker.left.ticks  = c.left.ticks;  _clicker.left.hold  = c.left.hold;  }
        if (c.right) { _clicker.right.ticks = c.right.ticks; _clicker.right.hold = c.right.hold; }
    }
    _updateClickerSideUI('left');
    _updateClickerSideUI('right');
}

/** Rebuild the active/inactive visual state for one side. */
function _updateClickerSideUI(side) {
    const bot = activeBotId !== null ? bots[activeBotId] : null;
    const c   = bot?.clicking;
    const isRunning = c && typeof c === 'object' && !c.button && !!c[side];

    const panel    = document.getElementById(`clickPanel_${side}`);
    const tickInp  = document.getElementById(`clickTicks_${side}`);
    const holdBtn  = document.getElementById(`clickHold_${side}`);
    const startBtn = document.getElementById(`clickStart_${side}`);
    const stopBtn  = document.getElementById(`clickStop_${side}`);

    if (!panel) return;

    const accentL = 'var(--terra)';
    const accentD = 'rgba(193,68,14,0.18)';

    panel.style.borderColor = isRunning ? accentL : 'rgba(255,255,255,0.07)';
    panel.style.background  = isRunning ? accentD  : 'rgba(0,0,0,0.25)';

    if (tickInp) tickInp.value = _clicker[side].ticks;

    if (holdBtn) {
        holdBtn.style.borderColor = _clicker[side].hold ? 'var(--terra)' : 'var(--border)';
        holdBtn.style.background  = _clicker[side].hold ? 'rgba(193,68,14,0.18)' : 'rgba(0,0,0,0.3)';
        holdBtn.style.color       = _clicker[side].hold ? 'var(--sand)'  : 'var(--smoke)';
    }

    if (startBtn) {
        startBtn.textContent = isRunning ? '↺ Restart' : '▶ Start';
    }
    if (stopBtn) stopBtn.disabled = !isRunning;
}

function setClickerTicks(side, value) {
    _clicker[side].ticks = Math.max(1, parseInt(value) || 1);
    _updateClickerSideUI(side);
}

function syncClickerTickInput(side) {
    const inp = document.getElementById(`clickTicks_${side}`);
    _clicker[side].ticks = Math.max(1, parseInt(inp?.value) || 1);
    _updateClickerSideUI(side);
}

function toggleClickerHold(side) {
    _clicker[side].hold = !_clicker[side].hold;
    _updateClickerSideUI(side);
}

async function startClickerSide(side) {
    if (activeBotId === null) return;
    const { ticks, hold } = _clicker[side];
    const holdArg = hold ? ' hold' : '';
    await window.api.executeCommand(activeBotId, `click ${side} ${ticks}${holdArg}`);
    _updateClickerSideUI(side);
}

async function stopClickerSide(side) {
    if (activeBotId === null) return;
    await window.api.executeCommand(activeBotId, `click stop ${side}`);
    // Clear local cache immediately so UI reflects the change without waiting for bot-update
    const bot = bots[activeBotId];
    if (bot?.clicking && typeof bot.clicking === 'object') {
        bot.clicking[side] = null;
        if (!bot.clicking.left && !bot.clicking.right) bot.clicking = null;
    }
    _updateClickerSideUI(side);
}

async function stopAllClickers() {
    if (activeBotId === null) return;
    await window.api.executeCommand(activeBotId, 'click stop');
    // Clear local cache immediately
    if (bots[activeBotId]) bots[activeBotId].clicking = null;
    _updateClickerSideUI('left');
    _updateClickerSideUI('right');
    closeClickerMenu();
}

// Legacy shims so any old call sites don't break
function setClickerButton(btn) { /* no-op — buttons are now per-panel */ }
function setClickerTicks_legacy(t) { setClickerTicks('left', t); }
async function startAutoClicker() { await startClickerSide('left'); }
async function stopAutoClicker()  { await stopAllClickers(); }

init();
// ── Sneak toggle ──────────────────────────────────────────────────────────────
async function toggleSneak() {
    if (activeBotId === null) return;
    const bot = bots[activeBotId];
    if (!bot || bot.status !== 'online') { addLog('error', 'Bot is not connected'); return; }
    await window.api.setControlState(activeBotId, 'sneak', !bot.sneaking);
}

// ── Follow popup ──────────────────────────────────────────────────────────────
function toggleFollowMenu() {
    const m = document.getElementById('followPopup');
    if (!m) return;
    if (m.style.display === 'flex') { closeFollowMenu(); return; }
    const bot   = activeBotId !== null ? bots[activeBotId] : null;
    const input = document.getElementById('followUsernameInput');
    if (input) input.value = bot?.following || '';
    m.style.display = 'flex';
    setTimeout(() => input?.focus(), 50);
}

function closeFollowMenu() {
    const m = document.getElementById('followPopup');
    if (m) m.style.display = 'none';
}

async function startFollow() {
    if (activeBotId === null) return;
    const input    = document.getElementById('followUsernameInput');
    const username = input?.value.trim();
    if (!username) { input?.focus(); return; }

    // Build the full set of bots to command: active bot + any shift-selected bots
    const targets = new Set([activeBotId, ...selectedBots]);

    let sent = 0;
    for (const id of targets) {
        const bot = bots[id];
        if (!bot || bot.status !== 'online') continue;
        await window.api.executeCommand(id, `follow ${username}`);
        sent++;
    }

    if (sent === 0) { addLog('error', 'No connected bots to follow'); return; }
    if (sent > 1) addLog('info', `${sent} bots now following ${username}`);
    closeFollowMenu();
}

async function stopFollow() {
    if (activeBotId === null) return;

    // Stop follow on all selected bots too
    const targets = new Set([activeBotId, ...selectedBots]);
    for (const id of targets) {
        const bot = bots[id];
        if (!bot || bot.status !== 'online') continue;
        await window.api.executeCommand(id, 'follow toggle');
    }
    closeFollowMenu();
}

// ── Direction Control UI ──────────────────────────────────────────────────────
let _lookYaw   = 0;          // radians, south=0
let _lookPitch = 0;          // radians, -π/2=up, π/2=down
let _lookHoldInterval = null;
const LOOK_STEP = Math.PI / 24;   // 7.5° per tick
const HOLD_INTERVAL_MS = 100;

function toggleDirectionMenu() {
    const m = document.getElementById('directionModal');
    if (!m) return;
    if (m.style.display === 'flex') {
        closeDirectionMenu();
    } else {
        // Seed yaw from current bot if known
        const bot = activeBotId !== null ? bots[activeBotId] : null;
        if (bot?.yaw !== undefined) _lookYaw = bot.yaw;
        _lookPitch = 0;
        m.style.display = 'flex';
        updateDirectionUI();
    }
}

function closeDirectionMenu() {
    stopLookHold();
    const m = document.getElementById('directionModal');
    if (m) m.style.display = 'none';
}

function updateDirectionUI() {
    // Pitch bar: -π/2 (up) → left side, π/2 (down) → right side
    const pitchNorm = (_lookPitch + Math.PI / 2) / Math.PI;  // 0..1
    const pitchPct  = Math.round(pitchNorm * 100);
    const pitchBar  = document.getElementById('pitchBar');
    const pitchFill = document.getElementById('pitchBarFill');
    const pitchLbl  = document.getElementById('pitchLabel');
    if (pitchBar) pitchBar.style.left = `${pitchPct}%`;
    if (pitchFill) {
        const center = 50;
        if (pitchPct >= center) {
            pitchFill.style.left  = `${center}%`;
            pitchFill.style.width = `${pitchPct - center}%`;
        } else {
            pitchFill.style.left  = `${pitchPct}%`;
            pitchFill.style.width = `${center - pitchPct}%`;
        }
    }
    if (pitchLbl) {
        const deg = Math.round(_lookPitch * 180 / Math.PI);
        pitchLbl.textContent = `${deg > 0 ? '+' : ''}${deg}°`;
    }

    // Yaw bar: normalize to 0..2π, map to 0..100%
    let yawNorm = ((_lookYaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const yawPct = Math.round((yawNorm / (2 * Math.PI)) * 100);
    const yawBar = document.getElementById('yawBar');
    const yawLbl = document.getElementById('yawLabel');
    if (yawBar) yawBar.style.left = `${yawPct}%`;
    if (yawLbl) {
        // Minecraft yaw: 0=south, π/2=west, π=north, 3π/2=east
        const compassDirs = [
            [0,         'South'], [Math.PI / 4,     'SW'],
            [Math.PI/2, 'West'],  [3*Math.PI/4,     'NW'],
            [Math.PI,   'North'], [5*Math.PI/4,     'NE'],
            [3*Math.PI/2,'East'], [7*Math.PI/4,     'SE'],
        ];
        let closest = compassDirs[0][1];
        let minDiff = Infinity;
        const yn = (((_lookYaw % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI));
        for (const [a, label] of compassDirs) {
            const diff = Math.abs(yn - a);
            if (diff < minDiff) { minDiff = diff; closest = label; }
        }
        yawLbl.textContent = closest;
    }
}

function applyLookStep(direction) {
    switch (direction) {
        case 'up':    _lookPitch = Math.max(-Math.PI / 2, _lookPitch - LOOK_STEP); break;
        case 'down':  _lookPitch = Math.min( Math.PI / 2, _lookPitch + LOOK_STEP); break;
        case 'left':  _lookYaw   = _lookYaw - LOOK_STEP; break;
        case 'right': _lookYaw   = _lookYaw + LOOK_STEP; break;
    }
    updateDirectionUI();
    sendLookCommand();
}

async function sendLookCommand() {
    if (activeBotId === null) return;
    await window.api.executeCommand(activeBotId, `look ${_lookYaw} ${_lookPitch}`);
}

function startLookHold(direction) {
    stopLookHold();
    applyLookStep(direction);   // immediate first step
    _lookHoldInterval = setInterval(() => applyLookStep(direction), HOLD_INTERVAL_MS);

    // Visual active state
    const btnMap = { up:'dpad-up', down:'dpad-down', left:'dpad-left', right:'dpad-right' };
    const btn = document.getElementById(btnMap[direction]);
    if (btn) {
        btn.style.background = 'rgba(193,68,14,0.25)';
        btn.style.borderColor = 'var(--terra)';
        btn.style.color = 'var(--peach)';
    }
}

function stopLookHold() {
    if (_lookHoldInterval) { clearInterval(_lookHoldInterval); _lookHoldInterval = null; }
    // Reset all dpad visuals
    ['dpad-up','dpad-down','dpad-left','dpad-right'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.style.background = 'rgba(0,0,0,0.4)';
            btn.style.borderColor = 'rgba(193,68,14,0.45)';
            btn.style.color = 'var(--peach)';
        }
    });
}

function resetLookCenter() {
    _lookPitch = 0;
    _lookYaw   = 0;
    updateDirectionUI();
    sendLookCommand();
}

// ── Movement Control UI ───────────────────────────────────────────────────────
const _moveHeld    = new Set();   // currently held movement keys
let _sprintToggled = false;

function toggleMovementMenu() {
    const m = document.getElementById('movementModal');
    if (!m) return;
    if (m.style.display === 'flex') {
        closeMovementMenu();
    } else {
        m.style.display = 'flex';
        _updateSprintKeyUI();
    }
}

function closeMovementMenu() {
    // Release all held keys when closing
    _moveHeld.forEach(k => _sendMoveControl(k, false));
    _moveHeld.clear();
    if (_sprintToggled) { _sendMoveControl('sprint', false); _sprintToggled = false; }
    _updateAllMoveKeyUI();
    const m = document.getElementById('movementModal');
    if (m) m.style.display = 'none';
}

async function startMoveKey(ctrl) {
    if (_moveHeld.has(ctrl)) return;
    _moveHeld.add(ctrl);
    _setMoveKeyHeld(ctrl, true);
    await _sendMoveControl(ctrl, true);
}

async function stopMoveKey(ctrl) {
    if (!_moveHeld.has(ctrl)) return;
    _moveHeld.delete(ctrl);
    _setMoveKeyHeld(ctrl, false);
    await _sendMoveControl(ctrl, false);
}

async function toggleMoveSprint() {
    _sprintToggled = !_sprintToggled;
    await _sendMoveControl('sprint', _sprintToggled);
    _updateSprintKeyUI();
}

async function _sendMoveControl(ctrl, state) {
    if (activeBotId === null) return;
    await window.api.setControlState(activeBotId, ctrl, state);
}

function _setMoveKeyHeld(ctrl, held) {
    const idMap = { forward:'mkey-forward', back:'mkey-back', left:'mkey-left', right:'mkey-right', jump:'mkey-jump', sneak:'mkey-sneak' };
    const btn = document.getElementById(idMap[ctrl]);
    if (!btn) return;
    if (held) {
        btn.classList.add('held');
    } else {
        btn.classList.remove('held');
    }
}

function _updateSprintKeyUI() {
    const btn = document.getElementById('mkey-sprint');
    if (!btn) return;
    if (_sprintToggled) {
        btn.classList.add('held');
        btn.textContent = '🏃 Sprint (ON)';
    } else {
        btn.classList.remove('held');
        btn.textContent = '🏃 Sprint (toggle)';
    }
}

function _updateAllMoveKeyUI() {
    ['forward','back','left','right','jump','sneak'].forEach(k => _setMoveKeyHeld(k, false));
    _updateSprintKeyUI();
}
