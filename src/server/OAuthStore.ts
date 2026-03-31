import crypto from 'crypto';

interface OAuthSession {
    username: string;
    expires: number;
}

// In-memory store for short-lived OAuth session tokens.
// These are generated after validating a Logto access_token and consumed
// during the RS2 binary login (where the token is sent as the "password").
const sessions = new Map<string, OAuthSession>();

/**
 * Generate and store a session token for a validated OAuth user.
 * @returns A 16-char alphanumeric token valid for `ttlMs` milliseconds.
 */
export function createSessionToken(username: string, ttlMs: number = 60_000): string {
    const token = crypto.randomBytes(12).toString('base64url').slice(0, 16);
    sessions.set(token, { username, expires: Date.now() + ttlMs });
    return token;
}

/**
 * Validate and consume a session token. Single-use: the token is deleted on success.
 * @returns `true` if the token is valid for the given username.
 */
export function validateSessionToken(token: string, username: string): boolean {
    const session = sessions.get(token);
    if (!session) return false;

    if (Date.now() > session.expires) {
        sessions.delete(token);
        return false;
    }

    if (session.username !== username) return false;

    sessions.delete(token); // single-use
    return true;
}

// Periodically clean up expired tokens
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (now > session.expires) {
            sessions.delete(key);
        }
    }
}, 30_000);
