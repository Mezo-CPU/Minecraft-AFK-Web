// config.js - Deployment-specific settings for the web console.
// Edit this after you know your backend's public address (see README.md).
'use strict';

window.CONSOLE_CONFIG = {
    // Where the backend (backend/ws-bridge.js on Bot-Hosting.net, tunneled
    // through Cloudflare) is reachable. Must be "wss://" once this frontend
    // is served over https by Cloudflare Pages, or browsers will block it
    // as mixed content.
    backendUrl: 'wss://diagnosis-vacations-stat-compound.trycloudflare.com',

    // Must exactly match ACCESS_TOKEN set in the backend's environment
    // variables. Anyone with both this URL and this token can control your
    // Minecraft accounts, so treat it like a password.
    accessToken: '81df538b3beb648720bb106df84110ad4358a8698a47e93afe0328030ce7433b',
};