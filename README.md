# Minecraft Console — Web Edition

Your Electron AFK console, split into two pieces so it can run as a normal
web app:

```
backend/    → always-on Node.js server (mineflayer, Microsoft auth, bot state)
              deploy to Bot-Hosting.net
frontend/   → the dashboard UI (same HTML/CSS/JS as before)
              deploy to Cloudflare Pages via GitHub
```

They talk to each other over WebSocket instead of Electron IPC. Nothing
about how the console *looks* or *behaves* changed — `renderer.js`,
`tabs.js`, `settings.js`, and `macroBlocks.js` are byte-for-byte the same
files you had, and every bot/auth/excavation/command handler in `backend/`
runs the exact same logic it did in Electron.

---

## 1. Deploy the backend to Bot-Hosting.net

1. Create a new Node.js deployment on Bot-Hosting.net (either upload the
   `backend/` folder directly, or point it at a GitHub repo with `backend/`
   as the root — it supports both).
2. Set the **startup file** to `main.js`.
3. In the panel's environment variables, set:
   - `ACCESS_TOKEN` — a long random string, e.g. generate one with
     `openssl rand -hex 32`. This is the password the web dashboard needs to
     control your bots. **Don't skip this** — see the security note below.
   - `PORT` — see step 4.
4. Bot-Hosting.net exposes a custom port with its own static IP (no NAT, no
   proxy in front). Note the port it assigns you in the "Network" tab of
   your panel, or pick one yourself if it lets you — you'll need this exact
   port again in step 3 of the Cloudflare section below, so it's simplest to
   pick one from that list now: `8443`, `2096`, `2087`, `2083`, or `2053`.
   Set `PORT` to that value.
5. Deploy. It runs `npm install` automatically from `backend/package.json`,
   then `node main.js`. Check the logs for:
   ```
   [ws-bridge] Listening on port <your port> (ws path: /ws)
   ```
6. **Data persistence**: `backend/data/` holds your encrypted Microsoft
   tokens (`tokens.enc`), account list, and bot list — created automatically
   on first run. Confirm in Bot-Hosting.net's docs/panel whether your plan's
   filesystem survives redeploys/restarts. If you're not sure, back up
   `backend/data/` after your first successful Microsoft login so you don't
   have to re-authenticate every account from scratch.

## 2. Deploy the frontend to Cloudflare Pages

1. Push this whole project to a GitHub repo.
2. In Cloudflare Pages: **Connect to Git**, pick the repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `frontend`
4. Deploy. Cloudflare gives you a `*.pages.dev` URL immediately.
5. Edit `frontend/config.js` with your real backend address and token (see
   next section for the exact URL format), commit, push — Pages redeploys
   automatically.

## 3. Bridging Bot-Hosting.net → Cloudflare Pages with `wss://`

This is the one non-obvious step. Cloudflare Pages always serves your
frontend over `https://`, and browsers block a plain `ws://` connection from
an `https://` page (mixed content). Bot-Hosting.net's exposed port is a raw
static IP with **no TLS in front of it** — so you need Cloudflare itself to
terminate TLS on the way to your backend:

1. Add a domain to your Cloudflare account (Pages doesn't require this, but
   this bridging step does — you need Cloudflare to be your DNS provider for
   *some* domain, even a cheap/free one).
2. In that domain's DNS tab, add an **A record**:
   - Name: something like `bot` (→ `bot.yourdomain.com`)
   - Content: the static IP Bot-Hosting.net assigned your deployment
   - Proxy status: **Proxied** (orange cloud) — this is what gives you TLS
3. Cloudflare only proxies specific ports for HTTPS traffic: `443`, `2053`,
   `2083`, `2087`, `2096`, `8443`. Your backend's `PORT` (step 4 above) must
   be one of these — that's why we picked one from that exact list earlier.
4. Set `frontend/config.js`:
   ```js
   backendUrl: 'wss://bot.yourdomain.com:8443',   // match your chosen port
   accessToken: 'the same ACCESS_TOKEN you set on the backend',
   ```
5. Commit and push — Pages redeploys, and the dashboard connects over a
   properly encrypted `wss://` link.

No domain available? You can still test everything locally: run the backend
with `ACCESS_TOKEN=... PORT=25580 node main.js`, serve `frontend/` with any
static file server (e.g. `npx serve frontend`) over plain `http://`, and
point `config.js` at `ws://localhost:25580`. Mixed-content blocking only
applies once the frontend itself is on `https://`.

---

## Security note

The Electron app never needed a login — it only ran on your own machine.
This backend is now reachable from the internet and holds your Microsoft
account tokens plus full control of your bots, so `ACCESS_TOKEN` is not
optional in practice. Treat it like a password: don't commit it, don't share
the WebSocket URL publicly.

## What actually changed vs. the Electron version

- `botConnection.js`, `commands.js`, `excavate.js`, `ipcHandlers.js`,
  `ipcHandlersPatch.js` — **unchanged** except swapping
  `require('electron')` for `require('./electron-shim')`, a small local
  module that reimplements just the `ipcMain.handle/on/emit` calls those
  files already used.
- `main.js` — Electron's `BrowserWindow`/app lifecycle replaced with an
  HTTP+WebSocket server (`ws-bridge.js`). All the encryption, token storage,
  and bot-state logic in this file is untouched.
- `preload.js` → `frontend/api.js` — same `window.api` method names and
  signatures, now backed by WebSocket RPC with auto-reconnect instead of
  Electron IPC.
- `renderer.js`, `tabs.js`, `settings.js`, `macroBlocks.js` — **byte-for-byte
  unchanged**; they only ever called `window.api.*`.
- Fixed a real bug: `TOKENS_DIR` was hardcoded to `D:\dingdongsuperduper`
  (Windows-only) in `botConnection.js` and `ipcHandlers.js` — now a portable
  path under `backend/data/auth-cache`.
- Removed `discord.js` and `prismarine-block` from `package.json` — neither
  is actually referenced anywhere in the codebase (the bot-creation form has
  Discord token/channel fields, but nothing consumes them yet).
- `index.html` already referenced a `craftingTab.js` that doesn't exist
  anywhere in your original source archive — left as-is (it 404s the same
  way it did in Electron); the "crafting" IPC channels in `preload.js` also
  had no backend handlers, so those were already stubs.

## Local development

```bash
# backend
cd backend
npm install
ACCESS_TOKEN=dev-token PORT=25580 node main.js

# frontend — any static server works
cd frontend
npx serve .
# then edit config.js: backendUrl: 'ws://localhost:25580', accessToken: 'dev-token'
```
