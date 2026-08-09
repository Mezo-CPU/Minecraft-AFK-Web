// config.js - Deployment-specific settings for the web console.
// backendUrl now points at a permanent ngrok domain, which does NOT change
// between backend restarts — unlike the old Cloudflare quick tunnel, this
// should only ever need to be set once.
'use strict';

window.CONSOLE_CONFIG = {
    backendUrl: 'wss://uncheck-upload-balmy.ngrok-free.dev',

    // Filled in from sessionStorage after a successful login. If it's
    // missing (nobody's logged in this tab yet), send them to login.html
    // instead of loading the dashboard.
    accessToken: sessionStorage.getItem('mc_console_token') || '',
};

if (!window.CONSOLE_CONFIG.accessToken && !window.IS_LOGIN_PAGE) {
    window.location.href = 'login.html';
}
