import { accountsReady } from "./migrateAccounts";
import { handleAccountRequest } from "./accountRoutes";
import { hasPermission } from "./permissions";
import { handleReportRequest } from "./reportRoutes";
import { handleBackupRequest } from "./backupRoutes";
import { initializeMaintenance, handleMaintenanceRequest } from "./maintenanceRoutes";
import dashboard from "../frontend/src/index.html";
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { validateFrame, saveFrame } from "./frameStore";
import { initializeAuth, handleAuthRequest } from "./authRoutes";
import { getSessionUser } from "./sessions";

const databasePath = resolve(import.meta.dir, "..", "data", "PMSB.db");
const database = new Database(databasePath, {
    readwrite: true,
    create: false
});

database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");
if (!accountsReady(database)) {
    database.close();
    throw new Error("Stop the API and worker, then run: bun run migrateAccounts.ts");
}
initializeAuth(database);
initializeMaintenance(database);

async function routeRequest(request: Request, clientIp: string) {
    const requestUrl = new URL(request.url);
    const path = requestUrl.pathname;

    const authResponse = await handleAuthRequest(database, request, clientIp);
    if (authResponse !== null) {
        return authResponse;
    }

    if (path === "/api/health" && request.method === "GET") {
        database.query("SELECT 1").get();
        return Response.json({
            status: "ok",
            application: "PMSB",
            backend: "Bun",
            database: "connected"
        });
    }

    // Machine access uses WORKER_SECRET
    if (path === "/api/frames" && request.method === "POST") {
        const workerSecret = process.env.WORKER_SECRET;
        if (!workerSecret || workerSecret.length < 32) {
            return Response.json({ error: "Worker access has not been configured" }, { status: 503 });
        }
        if (request.headers.get("Authorization") !== "Bearer " + workerSecret) {
            return Response.json({ error: "Worker access denied" }, { status: 401 });
        }

        const contentType = request.headers.get("Content-Type");
        if (contentType === null || !contentType.startsWith("application/json")) {
            return Response.json({ error: "Send the frame as application/json" }, { status: 415 });
        }

        let frame;
        try {
            frame = await request.json();
        } catch {
            return Response.json({ error: "The request contains invalid JSON" }, { status: 400 });
        }

        const validationError = validateFrame(frame);
        if (validationError !== null) {
            return Response.json({ error: validationError }, { status: 400 });
        }

        const existingFrame = database.query(`
            SELECT frameId FROM frames
            WHERE runId = ? AND bridgeId = ? AND step = ?
        `).get(frame.runId, frame.bridgeId, frame.step);

        if (existingFrame !== null) {
            return Response.json({ error: "This frame has already been saved" }, { status: 409 });
        }

        const frameId = saveFrame(database, frame);
        return Response.json({ saved: true, frameId: frameId }, { status: 201 });
    }

    // Every remaining API route needs a human session.
    if (!path.startsWith("/api/")) {
        return Response.json({ error: "Endpoint not found" }, { status: 404 });
    }

    const user = getSessionUser(database, request);
    if (user === null) {
        return Response.json({ error: "Please log in" }, { status: 401 });
    }

    const accountResponse = await handleAccountRequest(database, request);
    if (accountResponse !== null) return accountResponse;

    const maintenanceResponse = await handleMaintenanceRequest(database, request);
    if (maintenanceResponse !== null) return maintenanceResponse;

    const reportResponse = await handleReportRequest(database, request);
    if (reportResponse !== null) return reportResponse;
    const backupResponse = await handleBackupRequest(database, request, resolve(import.meta.dir, "..", "data"));
    if (backupResponse !== null) return backupResponse;

    if (path === "/api/readings" && request.method === "GET") {
        if (!hasPermission(user, "readings.view")) {
            return Response.json({ error: "Readings permission required" }, { status: 403 });
        }
        let bridgeId = requestUrl.searchParams.get("bridgeId");
        if (bridgeId === null) {
            bridgeId = "bridge1";
        }
        if (bridgeId.trim() === "" || bridgeId.length > 100) {
            return Response.json({ error: "bridgeId must contain 1 to 100 characters" }, { status: 400 });
        }

        let limitText = requestUrl.searchParams.get("limit");
        if (limitText === null) {
            limitText = "60";
        }
        const limit = Number(limitText);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
            return Response.json({ error: "limit must be a whole number from 1 to 1000" }, { status: 400 });
        }

        const readings = database.query(`
            SELECT
                frames.frameId, frames.runId, frames.bridgeId,
                frames.step, frames.scenario, frames.recordedAt,
                frames.simulatedHour, readings.sensorName,
                readings.value, readings.unit,
                predictions.modelVersion, predictions.modelScore,
                predictions.isAnomaly,
                predictions.availability AS predictionAvailability,
                forecasts.availability AS forecastAvailability,
                forecasts.hoursToThreshold, forecasts.fitScore,
                forecasts.reason AS forecastReason
            FROM frames
            JOIN readings ON readings.frameId = frames.frameId
            LEFT JOIN predictions ON predictions.frameId = frames.frameId
            LEFT JOIN forecasts ON forecasts.readingId = readings.readingId
            WHERE frames.frameId IN (
                SELECT frameId FROM frames
                WHERE bridgeId = ? ORDER BY frameId DESC LIMIT ?
            )
            ORDER BY frames.frameId ASC, readings.readingId ASC
        `).all(bridgeId, limit);

        return Response.json({
            bridgeId: bridgeId,
            frameLimit: limit,
            readingCount: readings.length,
            readings: readings
        });
    }

    return Response.json({ error: "Endpoint not found" }, { status: 404 });
}

const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(process.env.PORT || 3000),
    maxRequestBodySize: 65536,
    idleTimeout: 60,

    // Bun bundles the existing React frontend and serves it with the API.
    routes: {
        "/": dashboard
    },

    development: process.env.NODE_ENV !== "production" && {
        hmr: true,
        console: false
    },

    async fetch(request, server) {
        const address = server.requestIP(request);
        let clientIp = "local";
        if (address !== null) {
            clientIp = address.address;
        }

        let response;
        try {
            response = await routeRequest(request, clientIp);
        } catch (error) {
            console.error("API request failed:", error);
            response = Response.json({ error: "The server could not complete the request" }, { status: 500 });
        }

        response.headers.set("Cache-Control", "no-store");
        response.headers.set("X-Content-Type-Options", "nosniff");
        return response;
    }
});

console.log("PMSB API running at:", server.url.href);

function stopServer() {
    server.stop(true);
    database.close();
    process.exit(0);
}

process.on("SIGINT", stopServer);
process.on("SIGTERM", stopServer);