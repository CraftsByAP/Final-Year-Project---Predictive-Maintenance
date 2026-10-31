import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { validateFrame, saveFrame } from "./frameStore";

//Locate Database
const databasePath = resolve(
    import.meta.dir,
    "..",
    "data",
    "PMSB.db"
);
// Open the database
const database = new Database(databasePath, {
    readwrite: true,
    create: false
});

database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");

const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 3000,
    maxRequestBodySize: 65536,

    async fetch(request) {
        const requestUrl = new URL(request.url);
        const path = requestUrl.pathname;
        if (path === "/") {
    return Response.redirect(
        new URL("/api/readings?limit=3", request.url),
        302
    );
}

        try {
            if (
    path === "/api/frames" &&
    request.method === "POST"
) {
    const workerSecret = process.env.WORKER_SECRET;

    if (!workerSecret || workerSecret.length < 32) {
        return Response.json(
            { error: "Worker access has not been configured" },
            { status: 503 }
        );
    }

    const expectedAuthorization = "Bearer " + workerSecret;
    const authorization = request.headers.get("Authorization");

    if (authorization !== expectedAuthorization) {
        return Response.json(
            { error: "Worker access denied" },
            { status: 401 }
        );
    }

    const contentType = request.headers.get("Content-Type");

    if (
        contentType === null ||
        !contentType.startsWith("application/json")
    ) {
        return Response.json(
            { error: "Send the frame as application/json" },
            { status: 415 }
        );
    }

    let frame;

    try {
        frame = await request.json();
    } catch {
        return Response.json(
            { error: "The request contains invalid JSON" },
            { status: 400 }
        );
    }

    const validationError = validateFrame(frame);

    if (validationError !== null) {
        return Response.json(
            { error: validationError },
            { status: 400 }
        );
    }

    const existingFrame = database.query(`
        SELECT frameId
        FROM frames
        WHERE runId = ? AND bridgeId = ? AND step = ?
    `).get(frame.runId, frame.bridgeId, frame.step);

    if (existingFrame !== null) {
        return Response.json(
            { error: "This frame has already been saved" },
            { status: 409 }
        );
    }

    const frameId = saveFrame(database, frame);

    return Response.json(
        {
            saved: true,
            frameId: frameId
        },
        { status: 201 }
    );
}

            if (request.method !== "GET") {
                return Response.json(
                    { error: "Only GET requests are supported" },
                    {
                        status: 405,
                        headers: { Allow: "GET" }
                    }
                );
            }

            if (path === "/api/health") {
                database.query("SELECT 1").get();

                return Response.json({
                    status: "ok",
                    application: "PMBS",
                    backend: "Bun",
                    database: "connected"
                });
            }

            if (path === "/api/readings") {
                let bridgeId = requestUrl.searchParams.get("bridgeId");

                if (bridgeId === null) {
                    bridgeId = "bridge1";
                }

                if (bridgeId.trim() === "") {
                    return Response.json(
                        { error: "bridgeId must not be empty" },
                        { status: 400 }
                    );
                }

                let limitText = requestUrl.searchParams.get("limit");

                if (limitText === null) {
                    limitText = "60";
                }

                const limit = Number(limitText);

                if (
                    !Number.isInteger(limit) ||
                    limit < 1 ||
                    limit > 1000
                ) {
                    return Response.json(
                        { error: "limit must be a whole number from 1 to 1000" },
                        { status: 400 }
                    );
                }

                const query = database.query(`
                    SELECT
                        frames.frameId,
                        frames.runId,
                        frames.bridgeId,
                        frames.step,
                        frames.scenario,
                        frames.recordedAt,
                        frames.simulatedHour,
                        readings.sensorName,
                        readings.value,
                        readings.unit
                    FROM frames
                    JOIN readings
                        ON readings.frameId = frames.frameId
                    WHERE frames.frameId IN (
                        SELECT frameId
                        FROM frames
                        WHERE bridgeId = ?
                        ORDER BY frameId DESC
                        LIMIT ?
                    )
                    ORDER BY
                        frames.frameId ASC,
                        readings.readingId ASC
                `);

                const readings = query.all(bridgeId, limit);

                return Response.json({
                    bridgeId: bridgeId,
                    frameLimit: limit,
                    readingCount: readings.length,
                    readings: readings
                });
            }

            return Response.json(
                { error: "Endpoint not found" },
                { status: 404 }
            );

        } catch (error) {
            console.error("API request failed:", error);

            return Response.json(
                { error: "The server could not complete the request" },
                { status: 500 }
            );
        }
    }
});

console.log("PMSB API running at:", server.url.href);