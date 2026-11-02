import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { password as askPassword } from "@inquirer/prompts";

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

database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");


async function setPasswords() {
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

        if (existingUser === null) {
            console.log("Account not found:", username);
            console.log("Run setupAccounts.ts to create it first.");
            continue;
        }

        console.log("\nChoose a password for:", username);

        while (true) {
            const newPassword = await askPassword({
                message: "New password:",
                mask: true
            });

            if (
                newPassword.length < 12 ||
                newPassword.length > 128
            ) {
                console.log("Use between 12 and 128 characters.");
                continue;
            }

            const confirmedPassword = await askPassword({
                message: "Enter it again:",
                mask: true
            });

            if (newPassword !== confirmedPassword) {
                console.log("Passwords do not match. Try again.");
                continue;
            }

            const passwordHash = await Bun.password.hash(
                newPassword,
                { algorithm: "argon2id" }
            );

            const updatePassword = database.transaction(function () {
                database.query(`
                    UPDATE users
                    SET passwordHash = ?
                    WHERE username = ?
                `).run(passwordHash, username);

                // Sign out any existing sessions for this account.
                database.query(`
                    DELETE FROM sessions
                    WHERE userId = (
                        SELECT userId
                        FROM users
                        WHERE username = ?
                    )
                `).run(username);
            });

            updatePassword();

            console.log("Password updated for:", username);
            break;
        }
    }
}


try {
    await setPasswords();
} finally {
    database.close();
}