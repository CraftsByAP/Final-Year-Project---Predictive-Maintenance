import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";

export type SessionUser = {
    userId: number;
    username: string;
    email: string | null;
    role: string;
    csrfToken: string;
    expiresAt: string;
};

const cookieName = "pmsbSession";
const sessionSeconds = 4 * 60 * 60;
//Makes SHA-256 for long random session tokens
function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}
//Loops through cookie header to find aps cookie
function readToken(request: Request) {
    const cookieHeader = request.headers.get("Cookie");
    if (cookieHeader === null) {
        return null;
    }

    const cookies = cookieHeader.split(";");
    for (const cookie of cookies) {
        const part = cookie.trim();
        if (part.startsWith(cookieName + "=")) {
            const token = part.slice(cookieName.length + 1);
            if (/^[a-f0-9]{64}$/.test(token)) {
                return token;
            }
            return null;
        }
    }
    return null;
}

function makeCookie(request: Request, token: string, maxAge: number) {
    let cookie = cookieName + "=" + token;
    cookie += "; HttpOnly; SameSite=Strict; Path=/";
    cookie += "; Max-Age=" + maxAge;

    const url = new URL(request.url);
    if (url.protocol === "https:" || process.env.COOKIE_SECURE === "true") {
        cookie += "; Secure";
    }
    return cookie;
}

// Call only after password AND OTP verification succeed. Generates random token and saves only hash
export function createSession(database: Database, userId: number, request: Request) {
    const account = database.query(`
        SELECT userId FROM users WHERE userId = ? AND isActive = 1
    `).get(userId);

    if (account === null) {
        throw new Error("Account unavailable");
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const csrfToken = randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = new Date(now + sessionSeconds * 1000).toISOString();

    database.query(`
        INSERT INTO sessions (
            tokenHash, userId, csrfToken, createdAt, expiresAt
        ) VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, userId, csrfToken, new Date(now).toISOString(), expiresAt);

    return {
        cookie: makeCookie(request, token, sessionSeconds),
        csrfToken: csrfToken
    };
}

export function getSessionUser(database: Database, request: Request) {
    const token = readToken(request);
    if (token === null) {
        return null;
    }

    const user = database.query(`
        SELECT
            users.userId, users.username, users.email, users.role,
            sessions.csrfToken, sessions.expiresAt
        FROM sessions
        JOIN users ON users.userId = sessions.userId
        WHERE sessions.tokenHash = ? AND users.isActive = 1
    `).get(hashToken(token)) as SessionUser | null;

    if (user === null) {
        return null;
    }

    const expiry = Date.parse(user.expiresAt);
    if (!Number.isFinite(expiry) || Date.now() >= expiry) {
        database.query("DELETE FROM sessions WHERE tokenHash = ?").run(hashToken(token));
        return null;
    }

    if (user.role !== "superAdmin" && user.role !== "admin" && user.role !== "employee") {
        return null;
    }
    return user;
}

//Only allowed browser can change anything.
export function hasAllowedOrigin(request: Request) {
    const origin = request.headers.get("Origin");
    if (origin === null) {
        return true;
    }
    return origin === new URL(request.url).origin;
}

export function hasValidCsrf(request: Request, user: SessionUser) {
    if (!hasAllowedOrigin(request)) {
        return false;
    }
    return request.headers.get("X-CSRF-Token") === user.csrfToken;
}

export function endSession(database: Database, request: Request) {
    const token = readToken(request);
    if (token !== null) {
        database.query("DELETE FROM sessions WHERE tokenHash = ?").run(hashToken(token));
    }
    return makeCookie(request, "", 0);
}
