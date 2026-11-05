import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

// Keep the in-memory ZIP small on the presentation laptop.
export const maxBackupBytes = 32 * 1024 * 1024;
const maxJsonBytes = 256 * 1024;
export const packagePattern = /^infrasight-\d{13}-[a-f0-9-]{36}\.zip$/;
const contentNames = ["data/PMSB.db", "models/anomaly.joblib", "models/metadata.json", "models/evaluation.json"];
const archiveNames = ["manifest.json", ...contentNames];
type BackupFiles = Record<string, Uint8Array>;
type FileRecord = { name: string; bytes: number; sha256: string };

export class BackupError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

function hashBytes(bytes: Uint8Array) {
    return createHash("sha256").update(bytes).digest("hex");
}

function readJson(bytes: Uint8Array, name: string) {
    if (bytes.length > maxJsonBytes) throw new BackupError(name + " is too large");
    try {
        const value = JSON.parse(strFromU8(bytes));
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
        return value;
    } catch { throw new BackupError(name + " must contain a JSON object"); }
}

export function checkBackupDatabase(path: string) {
    const restored = new Database(path, { readonly: true, create: false });
    try {
        restored.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;");
        const integrity = restored.query("PRAGMA integrity_check").values();
        if (integrity.length !== 1 || integrity[0][0] !== "ok") throw new BackupError("Database integrity check failed");
        if (restored.query("PRAGMA foreign_key_check").all().length > 0) throw new BackupError("Database has broken relationships");
        const tables = ["users", "frames", "readings", "predictions", "forecasts", "maintenanceTasks", "maintenanceEvents"];
        const columns = restored.query("PRAGMA table_info(users)").all() as { name: string }[];
        for (const column of columns) {
            if (column.name === "emailVerifiedAt") tables.push("roles", "permissions", "rolePermissions", "accountEvents");
        }
        const counts: Record<string, number> = {};
        for (const table of tables) {
            const row = restored.query('SELECT count(*) AS count FROM "' + table + '"').get() as { count: number };
            counts[table] = row.count;
        }
        return counts;
    } finally { restored.close(); }
}

function checkModelFiles(files: BackupFiles) {
    const metadata = readJson(files["models/metadata.json"], "metadata.json");
    const evaluation = readJson(files["models/evaluation.json"], "evaluation.json");
    if (typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new BackupError("Model metadata needs its SHA-256 checksum");
    if (hashBytes(files["models/anomaly.joblib"]) !== metadata.sha256) throw new BackupError("Trained model does not match metadata.json. Keep files from the same training run together");
    if (typeof metadata.version !== "string" || metadata.version === "" || evaluation.modelVersion !== metadata.version) throw new BackupError("Model metadata and evaluation must have the same model version");
    return metadata.version as string;
}

// Validates the archive without trusting its paths or extracting arbitrary files.
export function inspectPackage(bytes: Uint8Array) {
    if (bytes.length > maxBackupBytes) throw new BackupError("Backup ZIP exceeds 32 MiB", 413);
    const seen: string[] = [];
    let expandedBytes = 0;
    try {
        // First pass checks every entry before allowing any decompression.
        unzipSync(bytes, { filter: function (file) {
            if (!archiveNames.includes(file.name) || seen.includes(file.name)) throw new BackupError("ZIP contains unexpected or duplicate files");
            seen.push(file.name);
            expandedBytes += file.originalSize;
            if (expandedBytes > maxBackupBytes) throw new BackupError("Expanded backup exceeds 32 MiB", 413);
            if (file.name.endsWith(".json") && file.originalSize > maxJsonBytes) throw new BackupError("Backup JSON exceeds the allowed size");
            return false;
        } });
        if (seen.length !== archiveNames.length) throw new BackupError("ZIP must contain the database, all three model files and manifest.json");
        const files = unzipSync(bytes);
        let actualBytes = 0;
        for (const name of archiveNames) actualBytes += files[name].length;
        if (actualBytes > maxBackupBytes) throw new BackupError("Expanded backup exceeds 32 MiB", 413);
        const manifest = readJson(files["manifest.json"], "manifest.json");
        if (manifest.format !== "infrasight-backup-v1" || !Array.isArray(manifest.files) || manifest.files.length !== contentNames.length) throw new BackupError("Unknown backup manifest format");
        const checked: string[] = [];
        for (const record of manifest.files) {
            if (record === null || typeof record !== "object" || !contentNames.includes(record.name) || checked.includes(record.name)) throw new BackupError("Invalid file list in backup manifest");
            checked.push(record.name);
            if (record.bytes !== files[record.name].length || record.sha256 !== hashBytes(files[record.name])) throw new BackupError("Backup checksum mismatch: " + record.name);
        }
        const modelVersion = checkModelFiles(files);
        if (manifest.modelVersion !== modelVersion) throw new BackupError("Manifest model version does not match its files");
        return { files: files, manifest: manifest, modelVersion: modelVersion };
    } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError("Could not read this backup ZIP. Choose an InfraSight backup package");
    }
}

export function createPackage(database: Database, dataFolder: string) {
    const backupFolder = resolve(dataFolder, "backups");
    mkdirSync(backupFolder, { recursive: true, mode: 0o700 });
    const workFolder = mkdtempSync(resolve(backupFolder, "building-"));
    try {
        const files: BackupFiles = {};
        let totalBytes = 0;
        // Read model files first; a missing file cannot silently create a partial backup.
        for (const name of contentNames) {
            if (name === "data/PMSB.db") continue;
            const path = resolve(dataFolder, "..", name);
            let size = 0;
            try { const stat = statSync(path); if (stat.isFile()) size = stat.size; } catch {}
            if (size === 0) throw new BackupError("Missing model file: " + name + ". Run training successfully before creating a complete package");
            if (size > maxBackupBytes) throw new BackupError("Model file exceeds the backup size limit", 413);
            files[name] = new Uint8Array(readFileSync(path));
            totalBytes += files[name].length;
        }
        const modelVersion = checkModelFiles(files);
        const pageCount = database.query("PRAGMA page_count").values()[0][0] as number;
        const pageSize = database.query("PRAGMA page_size").values()[0][0] as number;
        if (pageCount * pageSize + totalBytes > maxBackupBytes) throw new BackupError("Database and model files exceed the 32 MiB demonstration limit", 413);
        const snapshotPath = resolve(workFolder, "PMSB.db");
        // Includes committed WAL data. Never copy an open database as an ordinary file.
        database.query("VACUUM INTO ?").run(snapshotPath);
        const snapshot = new Database(snapshotPath, { readwrite: true, create: false });
        try {
            // Recovered systems must require a fresh login. Live sessions stay untouched.
            snapshot.exec("DELETE FROM sessions; DELETE FROM emailCodes; DELETE FROM authRateLimits; VACUUM;");
        } finally { snapshot.close(); }
        const counts = checkBackupDatabase(snapshotPath);
        files["data/PMSB.db"] = new Uint8Array(readFileSync(snapshotPath));
        totalBytes += files["data/PMSB.db"].length;
        const records: FileRecord[] = [];
        for (const name of contentNames) records.push({ name: name, bytes: files[name].length, sha256: hashBytes(files[name]) });
        const manifest = {
            format: "infrasight-backup-v1", createdAt: new Date().toISOString(),
            modelVersion: modelVersion, files: records, counts: counts,
            contains: "Database and trained-model files. Source code and secret configuration are kept separately.",
            loginState: "Sessions, pending OTPs and login request counters cleared in the backup copy only"
        };
        files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
        if (totalBytes + files["manifest.json"].length > maxBackupBytes) throw new BackupError("Expanded package exceeds 32 MiB", 413);
        const bytes = zipSync(files, { level: 1 });
        if (bytes.length > maxBackupBytes) throw new BackupError("Backup ZIP exceeds 32 MiB", 413);
        const name = "infrasight-" + Date.now() + "-" + randomUUID() + ".zip";
        const temporaryPath = resolve(workFolder, name);
        writeFileSync(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
        renameSync(temporaryPath, resolve(backupFolder, name));
        return { saved: true, name: name, bytes: bytes.length, counts: counts, modelVersion: modelVersion };
    } finally { rmSync(workFolder, { recursive: true, force: true }); }
}

export function recoverPackage(bytes: Uint8Array, dataFolder: string) {
    const inspected = inspectPackage(bytes);
    const recoveryRoot = resolve(dataFolder, "recovery-checks");
    mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
    const folder = mkdtempSync(resolve(recoveryRoot, "package-"));
    try {
        mkdirSync(resolve(folder, "data"), { mode: 0o700 });
        mkdirSync(resolve(folder, "models"), { mode: 0o700 });
        for (const name of archiveNames) {
            writeFileSync(resolve(folder, name), inspected.files[name], { mode: 0o600, flag: "wx" });
        }
        const counts = checkBackupDatabase(resolve(folder, "data", "PMSB.db"));
        for (const table of Object.keys(counts)) {
            if (inspected.manifest.counts?.[table] !== counts[table]) throw new BackupError("Recovered table count does not match manifest: " + table);
        }
        return {
            verified: true, restoredName: folder.split(/[\\/]/).pop(), sha256: hashBytes(bytes),
            counts: counts, modelVersion: inspected.modelVersion, filesChecked: archiveNames.length,
            notice: "Files recovered to a separate folder. The live database and live model were not replaced."
        };
    } catch (error) {
        rmSync(folder, { recursive: true, force: true });
        if (error instanceof BackupError) throw error;
        throw new BackupError("Recovered database could not be opened or checked");
    }
}

// Called by backupRoutes only after its session, permission and CSRF checks.
export async function handlePackageRequest(database: Database, request: Request, dataFolder: string) {
    const path = new URL(request.url).pathname;
    const backupFolder = resolve(dataFolder, "backups");
    try {
        if (path === "/api/backups/packages" && request.method === "GET") {
            const packages = [];
            for (const name of readdirSync(backupFolder)) {
                if (!packagePattern.test(name)) continue;
                const stat = statSync(resolve(backupFolder, name));
                if (stat.isFile()) packages.push({ name: name, bytes: stat.size, createdAt: stat.mtime.toISOString() });
            }
            packages.sort(function (a, b) { return b.name.localeCompare(a.name); });
            return Response.json({ packages: packages, maxBytes: maxBackupBytes });
        }
        if (path === "/api/backups/packages" && request.method === "POST") return Response.json(createPackage(database, dataFolder), { status: 201 });
        if (path === "/api/backups/packages/check-upload" && request.method === "POST") {
            if (request.headers.get("Content-Type") !== "application/zip") return Response.json({ error: "Choose a ZIP backup package" }, { status: 415 });
            const bytes = new Uint8Array(await request.arrayBuffer());
            return Response.json(recoverPackage(bytes, dataFolder));
        }
        const match = /^\/api\/backups\/packages\/([^/]+)(\/check)?$/.exec(path);
        if (match === null || !packagePattern.test(match[1])) return Response.json({ error: "Backup package not found" }, { status: 404 });
        const source = resolve(backupFolder, match[1]);
        let size = 0;
        try { const stat = statSync(source); if (stat.isFile()) size = stat.size; } catch {}
        if (size === 0) return Response.json({ error: "Backup package not found" }, { status: 404 });
        if (!match[2] && request.method === "GET") return new Response(Bun.file(source), { headers: {
            "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="' + match[1] + '"', "Cache-Control": "no-store"
        } });
        if (match[2] && request.method === "POST") {
            if (size > maxBackupBytes) throw new BackupError("Backup ZIP exceeds 32 MiB", 413);
            return Response.json(recoverPackage(new Uint8Array(readFileSync(source)), dataFolder));
        }
        return Response.json({ error: "Action not available" }, { status: 405 });
    } catch (error) {
        if (error instanceof BackupError) return Response.json({ error: error.message }, { status: error.status });
        console.error("Backup package operation failed");
        return Response.json({ error: "Backup could not be completed. Check free disk space and project file access" }, { status: 500 });
    }
}
