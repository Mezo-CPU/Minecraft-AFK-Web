// config.js - Deployment-specific settings for the web console.
// Edit this after you know your backend's public address (see README.md).
'use strict';

window.CONSOLE_CONFIG = {
    // Where the backend (backend/ws-bridge.js on Bot-Hosting.net) is
    // reachable. Must be "wss://" (not "ws://") once this frontend is served
    // over https by Cloudflare Pages, or browsers will block it as mixed
    // content. See README.md for how to get a wss:// address out of
    // Bot-Hosting.net via a Cloudflare-proxied DNS record.
    backendUrl: 'wss://CHANGE-ME.example.com:8443',

    // Must exactly match ACCESS_TOKEN set in the backend's environment
    // variables. Anyone with both this URL and this token can control your
    // Minecraft accounts, so treat it like a password.
    accessToken: '81df538b3beb648720bb106df84110ad4358a8698a47e93afe0328030ce7433b',
};
