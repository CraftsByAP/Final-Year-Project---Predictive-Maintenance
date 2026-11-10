import { Database } from "bun:sqlite";
import { accountsReady } from "./migrateAccounts";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const databasePath = resolve(
    import.meta.dir,
    "..",
    "data",
    "PMSB.db"
);

const database = new Database(databasePath, {
    readwrite: true,
    create: false
});

if (accountsReady(database)) {
    database.close();
    throw new Error("Use the Accounts screen to manage users after the account migration. This legacy setup script is disabled.");
}

database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");


function prepareAccountTables() {
    // For New Sign up = include all three roles- this only works for super admin...I'll test to check
    database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            userId INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT UNIQUE,
            passwordHash TEXT NOT NULL,

            role TEXT NOT NULL
                CHECK(role IN ('superAdmin', 'admin', 'employee')),

            isActive INTEGER NOT NULL DEFAULT 1
                CHECK(isActive IN (0, 1)),

            createdAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            tokenHash TEXT PRIMARY KEY,
            userId INTEGER NOT NULL,
            csrfToken TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            expiresAt TEXT NOT NULL,

            FOREIGN KEY(userId)
                REFERENCES users(userId)
                ON DELETE CASCADE
        );
    `);

    // Read the current Def of UsersTb.
    const definitions = database.query(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'users'
    `).values();

    const tableSql = String(definitions[0][0]);

    //  if employee is already allowed = no migration needed.
    if (tableSql.includes("'employee'")) {
        return;
    }

    // Saving a recovery copy before changing the existing table.
    const backupPath =
        databasePath + ".before-employees-" + Date.now() + ".db";

    database.query("VACUUM INTO ?").run(backupPath);

    console.log("Before-change backup saved:", backupPath);

    // Temporarily disable link enforcement while rebuilding the table.
    database.exec("PRAGMA foreign_keys = OFF");

    try {
        const migrateUsers = database.transaction(function () {
            database.exec(`
                CREATE TABLE usersUpdated (
                    userId INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    email TEXT UNIQUE,
                    passwordHash TEXT NOT NULL,

                    role TEXT NOT NULL
                        CHECK(role IN ('superAdmin', 'admin', 'employee')),

                    isActive INTEGER NOT NULL DEFAULT 1
                        CHECK(isActive IN (0, 1)),

                    createdAt TEXT NOT NULL
                );

                INSERT INTO usersUpdated (
                    userId,
                    username,
                    email,
                    passwordHash,
                    role,
                    isActive,
                    createdAt
                )
                SELECT
                    userId,
                    username,
                    email,
                    passwordHash,
                    role,
                    isActive,
                    createdAt
                FROM users;

                DROP TABLE users;

                ALTER TABLE usersUpdated RENAME TO users;
            `);

            // Check Existing Relationships work.
            const brokenLinks = database.query(
                "PRAGMA foreign_key_check"
            ).all();

            if (brokenLinks.length > 0) {
                throw new Error(
                    "Migration cancelled: database links failed validation"
                );
            }
        });

        migrateUsers();

    } finally {
        if (accountsReady(database)) {
    database.close();
    throw new Error("Use the Accounts screen to manage users after the account migration. This legacy setup script is disabled.");
}

database.exec("PRAGMA foreign_keys = ON");
    }

    console.log("Employee role added. Existing users preserved.");
}


async function setupAccounts() {
    prepareAccountTables();

    const usernames = [
        "superAdmin",
        "admin1",
        "admin2",
        "admin3",
        "employee1",
        "employee2"
    ];

    for (const username of usernames) {
        const existingUser = database.query(`
            SELECT userId
            FROM users
            WHERE username = ?
        `).get(username);

        if (existingUser !== null) {
            console.log(
                "Already exists:",
                username,
                "— password unchanged"
            );

            continue;
        }

        let role = "admin";

        if (username === "superAdmin") {
            role = "superAdmin";

        } else if (
            username === "employee1" ||
            username === "employee2"
        ) {
            role = "employee";
        }

        const password = randomBytes(24).toString("base64url");

        const passwordHash = await Bun.password.hash(password, {
            algorithm: "argon2id"
        });

        database.query(`
            INSERT INTO users (
                username,
                passwordHash,
                role,
                createdAt
            )
            VALUES (?, ?, ?, ?)
        `).run(
            username,
            passwordHash,
            role,
            new Date().toISOString()
        );

        console.log("\nCreated account:", username);
        console.log("Role:", role);
        console.log("Password:", password);
    }

    console.log("\nAccount setup complete.");
}


try {
    await setupAccounts();
} finally {
    database.close();
}