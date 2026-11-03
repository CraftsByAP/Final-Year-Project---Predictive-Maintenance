import { hasPermission } from "./permissions";
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { getSessionUser, hasValidCsrf } from "./sessions";

const backupPattern = /^pmsb-\d{13}-[a-f0-9-]{36}\.db$/;
const tables = ["users", "frames", "readings", "predictions", "forecasts", "maintenanceTasks", "maintenanceEvents"];

function checkDatabase(path: string) {
    const restored = new Database(path, { readonly: true, create: false });
    try {
        const integrity = restored.query("PRAGMA integrity_check").values();
        if (integrity.length !== 1 || integrity[0][0] !== "ok")
            throw new Error("Backup integrity check failed");
        if (restored.query("PRAGMA foreign_key_check").all().length > 0)
            throw new Error("Backup has broken database relationships");
        const counts: Record<string, number> = {};
        const requiredTables = [...tables];
        const columns = restored.query("PRAGMA table_info(users)").all() as { name: string }[];
        for (const column of columns) {
            if (column.name === "emailVerifiedAt") {
                requiredTables.push("roles", "permissions", "rolePermissions", "accountEvents");
            }
        }
        for (const table of requiredTables) {
            const result = restored.query('SELECT COUNT(*) AS count FROM "' + table + '"').get() as { count: number };
            counts[table] = result.count;
        }
        return counts;
    } finally { restored.close(); }
}

export async function handleBackupRequest(database: Database, request: Request, dataFolder: string) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/backups" && !url.pathname.startsWith("/api/backups/"))

        return null;
    const user = getSessionUser(database, request);
    if (user === null)
        return Response.json({ error: "Please log in" }, { status: 401 });

    if (!hasPermission(user, "backups.manage"))
        return Response.json({ error: "Super admin access required" }, { status: 403 });
    const backupFolder = resolve(dataFolder, "backups");
    mkdirSync(backupFolder, { recursive: true, mode: 0o700 });
    if (url.pathname === "/api/backups" && request.method === "GET") {
        const backups = [];
        for (const name of readdirSync(backupFolder)) {
            if (backupPattern.test(name)) {
                const stat = statSync(resolve(backupFolder, name));
                if (stat.isFile()) backups.push({ name: name, bytes: stat.size, createdAt: stat.mtime.toISOString() });
            }
        }
        backups.sort(function (a, b) {
            return b.name.localeCompare(a.name);
        }
        );
        return Response.json({ backups: backups });
    }
    if (request.method !== "GET" && !hasValidCsrf(request, user)) return Response.json({
        error: "Invalid request token" }, {
        status: 403
    });
    if (url.pathname === "/api/backups" && request.method === "POST") {
        const name = "pmsb-" + Date.now() + "-" + randomUUID() + ".db";
        const target = resolve(backupFolder, name);
        try {
            // SQLite createing  snapshot, including committed WAL data.
            database.query("VACUUM INTO ?").run(target);
            const counts = checkDatabase(target);
            return Response.json({ saved: true, name: name, counts: counts }, {

                status: 201
            });
        } catch (error) {
            try { unlinkSync(target); } catch { /* No incomplete file to remove. */ }
            throw error;
        }
    }
    const match = /^\/api\/backups\/([^/]+)(\/check)?$/.exec(url.pathname);
    if (match === null || !backupPattern.test(match[1])) return Response.json({ error: "Unknown backup" }, { status: 404 });
    const name = match[1];
    const source = resolve(backupFolder, name);
    if (!Bun.file(source).size) return Response.json({ error: "Backup not found" }, { status: 404 });
    if (request.method === "GET" && !match[2]) return new Response(Bun.file(source), { headers: {
        "Content-Type": "application/vnd.sqlite3", "Content-Disposition": 'attachment; filename="' + name + '"', "Cache-Control": "no-store"
    } });
    if (request.method === "POST" && match[2]) {
        const recoveryFolder = resolve(dataFolder, "recovery-checks");
        mkdirSync(recoveryFolder, { recursive: true, mode: 0o700 });
        const restoredName = "checked-" + randomUUID() + ".db";
        const target = resolve(recoveryFolder, restoredName);
        try {
            copyFileSync(source, target);
            const counts = checkDatabase(target);
            const originalHash = createHash("sha256").update(new Uint8Array(await Bun.file(source).arrayBuffer())).digest("hex");
            const restoredHash = createHash("sha256").update(new Uint8Array(await Bun.file(target).arrayBuffer())).digest("hex");
            if (originalHash !== restoredHash)
                throw new Error("Recovery copy does not match backup");
            return Response.json({ verified: true, restoredName: restoredName, sha256: restoredHash, counts: counts, notice: "Checked a separate copy. The live database was not replaced." });
        } catch (error) {
            try { unlinkSync(target); } catch { /* No incomplete copy to remove. */ }
            throw error;
        }
    }
    return Response.json({ error: "Backup action not available" }, {
        status: 405
    });
}
