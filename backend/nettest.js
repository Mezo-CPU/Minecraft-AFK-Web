// nettest.js - Raw TCP connectivity test, no mineflayer/minecraft-protocol
// involved at all. Run this directly on your Bot-Hosting.net container:
//
//   node nettest.js                              (tests the default list below)
//   node nettest.js simplevanilla.eu 25565        (tests just one host:port)
//
// This tells us whether the host itself can even open a socket to the
// server, before mineflayer or Microsoft auth ever get involved.
'use strict';

const net = require('net');
const dns = require('dns');

// Used when no host/port args are given — add more { host, port } entries
// here any time you want to test another server in the same run.
const DEFAULT_TARGETS = [
    { host: 'speedvanilla.net',   port: 25565 },
    { host: 'simplevanilla.eu',   port: 25565 },
	{ host: 'europemc.eu',   port: 25565 },
];

const targets = process.argv[2]
    ? [{ host: process.argv[2], port: parseInt(process.argv[3]) || 25565 }]
    : DEFAULT_TARGETS;

function testOne(host, port) {
    return new Promise((resolve) => {
        console.log(`\n[nettest] === ${host}:${port} ===`);
        console.log(`[nettest] Resolving ${host}...`);

        dns.lookup(host, (dnsErr, address) => {
            if (dnsErr) {
                console.log(`[nettest] DNS FAILED: ${dnsErr.message}`);
                console.log('[nettest] → The hostname itself could not be resolved. Check the server address for typos.');
                resolve();
                return;
            }
            console.log(`[nettest] Resolved to ${address}. Attempting TCP connect to ${address}:${port}...`);

            const start  = Date.now();
            const socket = net.createConnection({ host: address, port, timeout: 10000 });

            socket.on('connect', () => {
                const ms = Date.now() - start;
                console.log(`[nettest] ✅ TCP CONNECTED in ${ms}ms.`);
                console.log('[nettest] → The network path is open. If mineflayer still hangs, the issue is');
                console.log('[nettest]   further up the stack (protocol/version mismatch, auth, etc.), not a network block.');
                socket.end();
                resolve();
            });

            socket.on('timeout', () => {
                const ms = Date.now() - start;
                console.log(`[nettest] ❌ TIMED OUT after ${ms}ms with no response at all.`);
                console.log('[nettest] → This is a silent drop: the SYN packet went out and nothing came back —');
                console.log('[nettest]   no refusal, no reset. Almost always an outbound firewall on the host');
                console.log('[nettest]   blocking this port. Contact Bot-Hosting.net support and ask whether');
                console.log(`[nettest]   outbound TCP on port ${port} is allowed from your container.`);
                socket.destroy();
                resolve();
            });

            socket.on('error', (err) => {
                const ms = Date.now() - start;
                console.log(`[nettest] ❌ ERROR after ${ms}ms: ${err.code || err.message}`);
                if (err.code === 'ECONNREFUSED') {
                    console.log('[nettest] → The host actively refused the connection — either the server is down,');
                    console.log('[nettest]   or nothing is listening on that port. Double-check the port number.');
                } else if (err.code === 'ENETUNREACH' || err.code === 'EHOSTUNREACH') {
                    console.log('[nettest] → Network unreachable — likely a routing/firewall block on the host itself.');
                } else {
                    console.log('[nettest] → Unexpected error — paste this output back for a closer look.');
                }
                resolve();
            });
        });
    });
}

(async () => {
    for (const { host, port } of targets) {
        await testOne(host, port);
    }
    console.log('\n[nettest] Done.');
})();
