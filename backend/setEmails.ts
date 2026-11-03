import { Database } from "bun:sqlite";
import { accountsReady } from "./migrateAccounts";
import { resolve } from "node:path";
import { input } from "@inquirer/prompts";

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


async function setEmails() {
    const usernames = [
        "superAdmin",
        "admin1",
        "admin2",
        "admin3",
        "employee1",
        "employee2"
    ];

    const emailPattern =
        /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;

    for (const username of usernames) {
        const existingUser = database.query(`
            SELECT userId
            FROM users
            WHERE username = ?
        `).get(username);

        if (existingUser === null) {
            console.log("Account not found:", username);
            continue;
        }

        console.log("\nSetting email for:", username);

        while (true) {
            const enteredEmail = await input({
                message: "Email address — press Enter to skip:"
            });

            const email = enteredEmail.trim().toLowerCase();
            if (email === "") {
                console.log("Skipped:", username);
                break;
            }

            if (
                !emailPattern.test(email) ||
                email.length > 254
            ) {
                console.log("Enter one correctly formatted email address.");
                continue;
            }

            const emailOwner = database.query(`
                SELECT userId
                FROM users
                WHERE email = ? AND username != ?
            `).get(email, username);

            if (emailOwner !== null) {
                console.log("Account already uses Address.");
                continue;
            }

            const updateEmail = database.transaction(function () {
                database.query(`
                    UPDATE users
                    SET email = ?
                    WHERE username = ?
                `).run(email, username);

                // Require a fresh login after changing the address.
                database.query(`
                    DELETE FROM sessions
                    WHERE userId = (
                        SELECT userId
                        FROM users
                        WHERE username = ?
                    )
                `).run(username);
            });

            updateEmail();

            console.log("Email saved for:", username);
            break;
        }
    }
}


try {
    await setEmails();
} finally {
    database.close();
}