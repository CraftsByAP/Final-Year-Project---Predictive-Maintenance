import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { permissionNames } from "./permissions";

export function accountsReady(database: Database) {
    const columns = database.query("PRAGMA table_info(users)").all() as { name: string }[];
    for (const column of columns) {
        if (column.name === "emailVerifiedAt") return true;
    }
    return false;
}

export function migrateAccounts(database: Database, backupPath: string) {
    if (accountsReady(database))
        return false;
    if (database.query("PRAGMA foreign_key_check").all().length !== 0) {
        throw new Error("Existing database has broken relationships. Migration stopped.");
    }
    const duplicates = database.query(`
        SELECT lower(username) FROM users GROUP BY lower(username) HAVING count(*) > 1
        UNION ALL
        SELECT lower(email) FROM users WHERE email IS NOT NULL
        GROUP BY lower(email) HAVING count(*) > 1
    `).all();
    if (duplicates.length > 0)
        throw new Error("Duplicate usernames or emails differ only by case. Resolve them before migrating.");

    mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
    database.query("VACUUM INTO ?").run(backupPath);
    const originalCount = database.query("SELECT count(*) AS total FROM users").get() as { total: number };
    const sequence = database.query("SELECT seq FROM sqlite_sequence WHERE name='users'").get() as { seq: number } | null;
    const extraObjects = database.query(`
        SELECT sql FROM sqlite_schema WHERE tbl_name = 'users'
        AND type IN ('index','trigger') AND sql IS NOT NULL
    `).all() as { sql: string }[];

    database.exec("PRAGMA foreign_keys = OFF");
    try {
        const migrate = database.transaction(function () {
            database.exec(`
                CREATE TABLE roles (
                    roleName TEXT PRIMARY KEY,
                    version INTEGER NOT NULL DEFAULT 1,
                    createdAt TEXT NOT NULL
                );
                CREATE TABLE permissions (permission TEXT PRIMARY KEY);
                CREATE TABLE rolePermissions (
                    roleName TEXT NOT NULL REFERENCES roles(roleName),
                    permission TEXT NOT NULL REFERENCES permissions(permission),
                    PRIMARY KEY(roleName, permission)
                );
            `);
            for (const permission of permissionNames) {
                database.query("INSERT INTO permissions(permission) VALUES(?)").run(permission);
            }
            // These are starting presets, not a restriction on future roles.
            const presets: Record<string, string[]> = {
                superAdmin: permissionNames,
                admin: ["readings.view", "maintenance.own", "maintenance.manage", "reports.view"],
                employee: ["readings.view", "maintenance.own", "maintenance.assign"]
            };
            for (const name of Object.keys(presets)) {
                database.query("INSERT INTO roles(roleName,createdAt) VALUES(?,?)").run(name, new Date().toISOString());
                for (const permission of presets[name]) {
                    database.query("INSERT INTO rolePermissions VALUES(?,?)").run(name, permission);
                }
            }
            database.exec(`
                CREATE TABLE usersNew (
                    userId INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    email TEXT COLLATE NOCASE UNIQUE,
                    passwordHash TEXT NOT NULL,
                    role TEXT NOT NULL REFERENCES roles(roleName),
                    isActive INTEGER NOT NULL DEFAULT 1 CHECK(isActive IN (0,1)),
                    createdAt TEXT NOT NULL,
                    emailVerifiedAt INTEGER,
                    version INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO usersNew(userId,username,email,passwordHash,role,isActive,createdAt)
                SELECT userId,username,lower(email),passwordHash,role,isActive,createdAt FROM users;
                DROP TABLE users;
                ALTER TABLE usersNew RENAME TO users;
            `);
            for (const object of extraObjects) database.exec(object.sql);
            if (sequence !== null) {
                database.query("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name='users'").run(sequence.seq);
            }

            database.exec("DELETE FROM sessions; DELETE FROM emailCodes;");
            database.exec(`
                CREATE TABLE accountEvents (
                    eventId INTEGER PRIMARY KEY AUTOINCREMENT,
                    actorId INTEGER NOT NULL REFERENCES users(userId),
                    action TEXT NOT NULL,
                    target TEXT NOT NULL,
                    recordedAt TEXT NOT NULL
                );
            `);
            const currentCount = database.query("SELECT count(*) AS total FROM users").get() as { total: number };
            if (originalCount.total !== currentCount.total)
                throw new Error("User count changed unexpectedly.");
            if (database.query("PRAGMA foreign_key_check").all().length > 0)
                throw new Error("Migration relationship check failed.");
        });
        migrate();
    } finally {
        database.exec("PRAGMA foreign_keys = ON");
    }
    return true;
}

if (import.meta.main) {
    const databasePath = resolve(import.meta.dir, "..", "data", "PMSB.db");
    const database = new Database(databasePath, { readwrite: true, create: false });
    try {
        const backupPath = resolve(dirname(databasePath), "backups", "before-accounts-" + randomUUID() + ".db");
        const changed = migrateAccounts(database, backupPath);
        console.log(changed ? "Account migration complete. Previous database saved at: " + backupPath : "Account migration already applied.");
    } finally {
        database.close();
    }
}
