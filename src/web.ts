import fs from 'fs';
import fsp from 'fs/promises';
import http from 'http';
import { extname } from 'path';

import ejs from 'ejs';
import { register } from 'prom-client';

import { CrcBuffer } from '#/cache/CrcTable.js';
import Environment from '#/util/Environment.js';
import { tryParseInt } from '#/util/TryParse.js';

import { getPublicPerDeploymentToken } from './io/PemUtil.js';
import { createSessionToken } from '#/server/OAuthStore.js';
import { toBase37, fromBase37 } from '#/util/JString.js';

const MIME_TYPES = new Map<string, string>();
MIME_TYPES.set('.js', 'application/javascript');
MIME_TYPES.set('.mjs', 'application/javascript');
MIME_TYPES.set('.css', 'text/css');
MIME_TYPES.set('.html', 'text/html');
MIME_TYPES.set('.wasm', 'application/wasm');
MIME_TYPES.set('.sf2', 'application/octet-stream');

/**
 * Sanitize a Logto username into a valid RS2 name (a-z, 0-9, _, max 12 chars).
 */
function toRsName(name: string): string {
    // Strip invalid chars, collapse whitespace to underscore, truncate to 12
    let sanitized = name.toLowerCase().replace(/[^a-z0-9_ ]/g, '').replace(/\s+/g, '_').substring(0, 12).trim();
    if (sanitized.length === 0) sanitized = 'player';
    // Roundtrip through base37 to ensure it's fully valid
    const b37 = toBase37(sanitized);
    if (b37 === 0n) return 'player';
    return fromBase37(b37);
}

/**
 * Read the full request body as a string.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1024 * 64) { reject(new Error('Body too large')); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

// we don't need/want a full blown website or API on the game server
export const web = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url ?? '', `http://${req.headers.host}`);

        // CORS: allow cross-origin requests from the client domain
        if (Environment.CLIENT_ORIGIN) {
            res.setHeader('Access-Control-Allow-Origin', Environment.CLIENT_ORIGIN);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        }

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // OAuth routes accept POST
        if (req.method === 'POST' && url.pathname === '/auth/exchange' && Environment.OAUTH_ENABLED) {
            try {
                const body = JSON.parse(await readBody(req));
                const { access_token } = body;
                if (!access_token) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing access_token' }));
                    return;
                }

                // Validate access_token against Logto userinfo endpoint
                const userInfoRes = await fetch(Environment.OAUTH_LOGTO_ENDPOINT + '/oidc/me', {
                    headers: { 'Authorization': 'Bearer ' + access_token }
                });

                if (!userInfoRes.ok) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid access token' }));
                    return;
                }

                const userInfo = await userInfoRes.json() as Record<string, unknown>;

                // Extract username: prefer username, then name, then sub
                let rawName = (userInfo.username || userInfo.name || userInfo.sub || 'player') as string;
                const username = toRsName(rawName);

                // Generate a short-lived session token for the binary login
                const sessionToken = createSessionToken(username);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ username, sessionToken }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error' }));
            }
            return;
        }

        if (req.method !== 'GET') {
            res.writeHead(405);
            res.end();
            return;
        }

        if (url.pathname === '/auth/callback' && Environment.OAUTH_ENABLED) {
            res.setHeader('Content-Type', 'text/html');
            res.writeHead(200);
            res.end(await ejs.renderFile('view/auth-callback.ejs', {
                logtoEndpoint: Environment.OAUTH_LOGTO_ENDPOINT,
                appId: Environment.OAUTH_LOGTO_APP_ID,
                callbackUrl: Environment.OAUTH_CALLBACK_URL
            }));
        } else if (url.pathname.endsWith('.mid')) {
            // todo: packing process should spit out files with crc included in the name
            //   but the server needs to be aware of the crc so it can send the proper length
            //   so that's been pushed off til later...

            // strip _crc from filename, but keep extension
            const filename = url.pathname.substring(1, url.pathname.lastIndexOf('_')) + '.mid';
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/songs/' + filename));
        } else if (url.pathname.startsWith('/crc')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(CrcBuffer.data);
        } else if (url.pathname.startsWith('/title')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/title'));
        } else if (url.pathname.startsWith('/config')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/config'));
        } else if (url.pathname.startsWith('/interface')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/interface'));
        } else if (url.pathname.startsWith('/media')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/media'));
        } else if (url.pathname.startsWith('/models')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/models'));
        } else if (url.pathname.startsWith('/textures')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/textures'));
        } else if (url.pathname.startsWith('/wordenc')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/wordenc'));
        } else if (url.pathname.startsWith('/sounds')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.writeHead(200);
            res.end(await fsp.readFile('data/pack/client/sounds'));
        } else if (url.pathname === '/') {
            if (Environment.WEBSITE_REGISTRATION) {
                res.writeHead(404);
                res.end();
            } else {
                res.writeHead(302, { Location: '/rs2.cgi?world=0&lowmem=0&plugin=0' });
                res.end();
            }
        } else if (url.pathname === '/rs2.cgi') {
            // embedded from website.com/client.cgi
            const plugin = tryParseInt(url.searchParams.get('plugin'), 0);
            const lowmem = tryParseInt(url.searchParams.get('lowmem'), 0);

            res.setHeader('Content-Type', 'text/html');
            res.writeHead(200);

            const context = {
                plugin,
                nodeid: Environment.NODE_ID,
                lowmem,
                members: Environment.NODE_MEMBERS,
                portoff: Environment.WEB_PORT - 43595,
                per_deployment_token: '',
                oauth_enabled: Environment.OAUTH_ENABLED,
                oauth_logto_endpoint: Environment.OAUTH_LOGTO_ENDPOINT,
                oauth_app_id: Environment.OAUTH_LOGTO_APP_ID,
                oauth_callback_url: Environment.OAUTH_CALLBACK_URL
            };
            if (Environment.WEB_SOCKET_TOKEN_PROTECTION) {
                context.per_deployment_token = getPublicPerDeploymentToken();
            }

            if (Environment.NODE_DEBUG && plugin == 1) {
                res.end(await ejs.renderFile('view/java.ejs', context));
            } else {
                res.end(await ejs.renderFile('view/client.ejs', context));
            }
        } else if (url.pathname === '/dev.cgi') {
            const lowmem = tryParseInt(url.searchParams.get('lowmem'), 0);

            res.setHeader('Content-Type', 'text/html');
            res.writeHead(200);

            const context = {
                plugin: 0,
                nodeid: 10,
                lowmem,
                members: Environment.NODE_MEMBERS
            };

            res.end(await ejs.renderFile('view/dev.ejs', context));
        } else if (fs.existsSync('public' + url.pathname)) {
            res.setHeader('Content-Type', MIME_TYPES.get(extname(url.pathname ?? '')) ?? 'text/plain');
            res.writeHead(200);
            res.end(await fsp.readFile('public' + url.pathname));
        } else {
            res.writeHead(404);
            res.end();
        }
    } catch (_) {
        res.end();
    }
});

const managementWeb = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    if (url.pathname === '/prometheus') {
        res.setHeader('Content-Type', register.contentType);
        res.writeHead(200);
        res.end(await register.metrics());
    } else {
        res.writeHead(404);
        res.end();
    }
});

export function startWeb() {
    web.listen(Environment.WEB_PORT, '0.0.0.0');
}

export function startManagementWeb() {
    managementWeb.listen(Environment.WEB_MANAGEMENT_PORT, '0.0.0.0');
}
