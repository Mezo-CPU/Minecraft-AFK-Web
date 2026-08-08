// config.js - Deployment-specific settings for the web console.
// The access token is NO LONGER hardcoded here — it's fetched from the
// backend's /login endpoint (see login.html) and kept only in this
// browser's sessionStorage, so it's never shipped in plain JavaScript to
// anyone who just visits the site.
'use strict';

window.CONSOLE_CONFIG = {
    // Where the backend (backend/ws-bridge.js on Bot-Hosting.net, tunneled
    // through Cloudflare) is reachable.
    backendUrl: 'wss://struct-type-skirts-gif.trycloudflare.com',

    // Filled in from sessionStorage after a successful login. If it's
    // missing (nobody's logged in this tab yet), send them to login.html
    // instead of loading the dashboard.
    accessToken: sessionStorage.getItem('mc_console_token') || '',
};

if (!window.CONSOLE_CONFIG.accessToken && !window.IS_LOGIN_PAGE) {
    window.location.href = 'login.html';
}
