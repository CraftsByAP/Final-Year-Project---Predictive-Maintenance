import { isJsonRequest, loginError, validOtp } from "../shared/validation";
import { Database } from "bun:sqlite";
import { checkCredentials } from "./authentication";
import { createEmailCodeTable, sendLoginCode, verifyLoginCode } from "./emailCodes";
import {createSession, endSession, getSessionUser, hasAllowedOrigin, hasValidCsrf} from "./sessions";

type RateLimit = {
    attempts: number;
    startedAt: number;
};

export function initializeAuth(database: Database) {
    createEmailCodeTable(database);
    database.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            tokenHash TEXT PRIMARY KEY,
            userId INTEGER NOT NULL,
            csrfToken TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            expiresAt TEXT NOT NULL,
            FOREIGN KEY(userId) REFERENCES users(userId) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS authRateLimits (
            limitKey TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL,
            startedAt INTEGER NOT NULL
        );
    `);
}

// Keeps request counts in SQLite and stops Bun from resetting limits
function takeAttempt(database: Database, limitKey: string, maximum: number) {
    const now = Date.now();
    const windowLength = 15 * 60 * 1000;

    const checkLimit = database.transaction(function () {
        const previous = database.query(`
            SELECT attempts, startedAt FROM authRateLimits WHERE limitKey = ?
        `).get(limitKey) as RateLimit | null;

        if (previous === null || now - previous.startedAt >= windowLength) {
            database.query(`
                INSERT OR REPLACE INTO authRateLimits (limitKey, attempts, startedAt)
                VALUES (?, ?, ?)
            `).run(limitKey, 1, now);
            return true;
        }

        if (previous.attempts >= maximum) {
            return false;
        }

        database.query(`
            UPDATE authRateLimits SET attempts = attempts + 1 WHERE limitKey = ?
        `).run(limitKey);
        return true;
    });

    return checkLimit();
}

async function readJson(request: Request) {
    if (!isJsonRequest(request)) {
        return null;
    }
    try {
        const body = await request.json();
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
            return null;
        }
        return body;
    } catch {
        return null;
    }
}

export async function handleAuthRequest(
    database: Database,
    request: Request,
    clientIp: string
) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/auth/")) {
        return null;
    }

    if (request.method !== "GET" && !hasAllowedOrigin(request)) {
        return Response.json({ error: "Origin not allowed" }, { status: 403 });
    }

    if (path === "/api/auth/login" && request.method === "POST") {
        if (!takeAttempt(database, "login-ip:" + clientIp, 30)) {
            return Response.json({ error: "Too many login requests. Try again after 15 minutes" }, { status: 429 });
        }

        const body = await readJson(request);
        const validationError = loginError(body?.username, body?.password);
        if (validationError !== null) return Response.json({ error: validationError }, { status: 400 });

        const username = body.username.trim();
        if (!takeAttempt(database, "login-user:" + username.toLowerCase(), 10)) {
            return Response.json({ error: "Too many login requests. Try again after 15 minutes" }, { status: 429 });
        }

        let account;
        try {
            account = await checkCredentials(database, username, body.password);
        } catch {
            return Response.json({ error: "Login unavailable. Check your credentials or contact Administrator" }, { status: 401 });
        }

        try {
            const codeId = await sendLoginCode(database, account.userId);
            return Response.json({
                requiresOtp: true,
                codeId: codeId,
                message: "Enter the code sent to your Email"
            });
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.startsWith("Wait 60 seconds") || error.message.startsWith("Hourly code limit")) {
                    return Response.json({ error: error.message }, { status: 429 });
                }
            }
            console.error("Login Code could not be sent...");
            return Response.json({ error: "Could not send the login code. Try again later" }, { status: 502 });
        }
    }

    if (path === "/api/auth/verify" && request.method === "POST") {
        if (!takeAttempt(database, "verify-ip:" + clientIp, 30)) {
            return Response.json({ error: "Too many verification requests. Try again after 15 minutes" }, { status: 429 });
        }

        const body = await readJson(request);
        if (
            body === null ||
            typeof body.codeId !== "string" ||
            !/^[a-f0-9]{64}$/.test(body.codeId) ||
            !validOtp(body.code)
        ) {
            return Response.json({ error: "Provide the login challenge and six-digit code" }, { status: 400 });
        }

        let account;
        try {
            account = verifyLoginCode(database, body.codeId, body.code);
        } catch (error) {
            let message = "Verification failed";
            if (error instanceof Error) {
                message = error.message;
            }
            return Response.json({ error: message }, { status: 401 });
        }

        if (account === null) {
            return Response.json({ error: "Verification failed" }, { status: 401 });
        }

        const session = createSession(database, account.userId, request);
        return Response.json({
            user: account,
            csrfToken: session.csrfToken
        }, {
            headers: { "Set-Cookie": session.cookie }
        });
    }

    if (path === "/api/auth/me" && request.method === "GET") {
        const user = getSessionUser(database, request);
        if (user === null) {
            return Response.json({ error: "Please log in" }, { status: 401 });
        }
        return Response.json({ user: user });
    }

    if (path === "/api/auth/logout" && request.method === "POST") {
        const user = getSessionUser(database, request);
        if (user !== null && !hasValidCsrf(request, user)) {
            return Response.json({ error: "Invalid request token" }, { status: 403 });
        }
        const cookie = endSession(database, request);
        return Response.json({ loggedOut: true }, {
            headers: { "Set-Cookie": cookie }
        });
    }

    return Response.json({ error: "Authentication endpoint not found" }, { status: 404 });
}
