// config.js - Deployment-specific settings for the web console.
// backendUrl points at the hostless.net-hosted backend.
'use strict';

window.CONSOLE_CONFIG = {
    backendUrl: 'wss://mezoacc.hostless.app',

    // Filled in from sessionStorage after a successful login. If it's
    // missing (nobody's logged in this tab yet), send them to login.html
    // instead of loading the dashboard.
    accessToken: sessionStorage.getItem('mc_console_token') || '',

    // Base URL (no trailing slash, no port) that the prismarine-viewer world
    // viewer is reachable at. The viewer runs on its own port per bot
    // (VIEWER_BASE_PORT + botId, see backend/viewer.js) — it is a SEPARATE,
    // UNAUTHENTICATED server, not tunneled through backendUrl above.
    //
    // - If the backend runs on the SAME machine you're viewing the dashboard
    //   from, leave this as 'http://localhost' — it just works.
    // - If the backend runs remotely (which it now does, on hostless.net),
    //   you must set up your own tunnel/proxy for the viewer port(s)
    //   (ideally one that adds authentication) and point this at that
    //   instead. See viewer.js's header comment for why this port isn't
    //   just auto-added to the existing backend connection.
    viewerBaseUrl: 'http://localhost',
};

if (!window.CONSOLE_CONFIG.accessToken && !window.IS_LOGIN_PAGE) {
    window.location.href = 'login.html';
}
