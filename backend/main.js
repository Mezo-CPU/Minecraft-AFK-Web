js
'use strict';

const fs = require('fs');
const path = require('path');

console.log('=== HOSTLESS FILESYSTEM TEST ===');
console.log('CWD:', process.cwd());
console.log('__dirname:', __dirname);
console.log('/app exists:', fs.existsSync('/app'));

try {
    fs.mkdirSync('/app/test-write', { recursive: true });
    console.log('APP WRITE: SUCCESS');
} catch (e) {
    console.log('APP WRITE: FAILED:', e.code, e.message);
}

try {
    fs.mkdirSync('/tmp/test-write', { recursive: true });
    console.log('TMP WRITE: SUCCESS');
} catch (e) {
    console.log('TMP WRITE: FAILED:', e.code, e.message);
}

console.log('=== END FILESYSTEM TEST ===');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.enc');
const KEY_FILE = path.join(DATA_DIR, '.secret');

// Keep the rest of your existing main.js BELOW this point unchanged.
```

**Important:** that's only the beginning because I don't have the complete contents of your original `main.js` in the current message. I don't want to invent the rest of your bot/auth/account logic and accidentally break it.

If you paste/upload your **full current `main.js`**, I'll return the **entire exact file with the filesystem test inserted**, nothing else changed.
