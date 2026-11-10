import { Database } from "bun:sqlite";
import { accountDetails } from "./permissions";
import { randomBytes, randomInt } from "node:crypto";
import { sendVerificationEmail } from "./email";


type Account = {
    userId: number;
    username: string;
    email: string | null;
    passwordHash: string;
    role: string;
    isActive: number;
};


type EmailCode = {
    codeId: string;
    userId: number;
    email: string;
    passwordHash: string;
    codeHash: string;
    attempts: number;
    createdAt: number;
    expiresAt: number;
    usedAt: number | null;
};


// Storage for Login Codes.
export function createEmailCodeTable(database: Database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS emailCodes (
            codeId TEXT PRIMARY KEY,
            userId INTEGER NOT NULL,
            email TEXT NOT NULL,
            passwordHash TEXT NOT NULL,
            codeHash TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            createdAt INTEGER NOT NULL,
            expiresAt INTEGER NOT NULL,
            usedAt INTEGER,
            verifiedAt INTEGER,

            FOREIGN KEY(userId)
                REFERENCES users(userId)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS emailCodesByUser
        ON emailCodes(userId, createdAt);
    `);
}


//After checkCredentials accepts the password.
export async function sendLoginCode(
    database: Database,
    userId: number
) {
    if (!Number.isInteger(userId) || userId < 1) {
        throw new Error("Invalid account ID");
    }

    // Generate and hash the six-digit code.
    const code = String(randomInt(100000, 1000000));

    const codeHash = await Bun.password.hash(code, {
        algorithm: "argon2id"
    });

    const codeId = randomBytes(32).toString("hex");
    const now = Date.now();

    const account = database.query(`
        SELECT
            userId,
            username,
            email,
            passwordHash,
            role,
            isActive
        FROM users
        WHERE userId = ?
    `).get(userId) as Account | null;

    if (
        account === null ||
        account.isActive !== 1 ||
        !account.email
    ) {
        throw new Error(
            "The account needs an active status and registered email"
        );
    }

    // Finding requests made during the last hour.
    const recentCodes = database.query(`
        SELECT createdAt
        FROM emailCodes
        WHERE userId = ? AND createdAt > ?
        ORDER BY createdAt DESC
    `).values(userId, now - 3600000);

    if (recentCodes.length > 0) {
        const lastSentAt = Number(recentCodes[0][0]);

        if (now - lastSentAt < 60000) {
            throw new Error(
                "Wait 60 seconds before requesting another code"
            );
        }
    }

    if (recentCodes.length >= 5) {
        throw new Error(
            "Hourly code limit reached. Try again later"
        );
    }

    const saveCode = database.transaction(function () {
        // A new code replaces earlier unused codes.
        database.query(`
            UPDATE emailCodes
            SET usedAt = ?
            WHERE userId = ? AND usedAt IS NULL
        `).run(now, userId);

        database.query(`
            INSERT INTO emailCodes (
                codeId,
                userId,
                email,
                passwordHash,
                codeHash,
                createdAt,
                expiresAt
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            codeId,
            userId,
            account.email,
            account.passwordHash,
            codeHash,
            now,
            now + 600000
        );
    });

    saveCode();

    try {
        await sendVerificationEmail(account.email, code);

    } catch {
        // Disable the challenge if sending fails.
        database.query(`
            UPDATE emailCodes
            SET usedAt = ?
            WHERE codeId = ?
        `).run(Date.now(), codeId);

        throw new Error(
            "Email could not be sent. Check server settings " +
            "and try again after 60 seconds"
        );
    }

    // Return the challenge ID, never the readable code.
    return codeId;
}


// Check the code entered by the user.
export function verifyLoginCode(
    database: Database,
    codeId: string,
    code: string
) {
    if (
        typeof codeId !== "string" ||
        !/^[a-f0-9]{64}$/.test(codeId)
    ) {
        throw new Error("Invalid login challenge");
    }

    if (
        typeof code !== "string" ||
        !/^\d{6}$/.test(code)
    ) {
        throw new Error("Enter the six-digit code");
    }

    const checkCode = database.transaction(function () {
        const savedCode = database.query(`
            SELECT *
            FROM emailCodes
            WHERE codeId = ?
        `).get(codeId) as EmailCode | null;

        if (savedCode === null || savedCode.usedAt !== null) {
            return {
                error: "This code is unavailable. Start login again",
                account: null
            };
        }

        if (Date.now() >= savedCode.expiresAt) {
            return {
                error: "Code expired. Start login again",
                account: null
            };
        }

        if (savedCode.attempts >= 5) {
            return {
                error: "Attempt limit reached. Start login again",
                account: null
            };
        }

        // Count this attempt before checking the code.
        database.query(`
            UPDATE emailCodes
            SET attempts = attempts + 1
            WHERE codeId = ?
        `).run(codeId);

        const correct = Bun.password.verifySync(
            code,
            savedCode.codeHash
        );

        if (!correct) {
            return {
                error: "Incorrect code",
                account: null
            };
        }

        const account = database.query(`
            SELECT
                userId,
                username,
                email,
                passwordHash,
                role,
                isActive
            FROM users
            WHERE userId = ?
        `).get(savedCode.userId) as Account | null;

        if (account === null || account.isActive !== 1) {
            return {
                error: "Account unavailable",
                account: null
            };
        }

        // Reject pending codes after an email or password change.
        if (
            account.email !== savedCode.email ||
            account.passwordHash !== savedCode.passwordHash
        ) {
            return {
                error: "Account details changed. Start login again",
                account: null
            };
        }

        const now = Date.now();

        // Mark the code as verified and prevent reuse.
        database.query(`
            UPDATE emailCodes
            SET usedAt = ?, verifiedAt = ?
            WHERE codeId = ?
        `).run(now, now, codeId);

        database.query("UPDATE users SET emailVerifiedAt = ? WHERE userId = ?").run(now, account.userId);

        return {
            error: null,

            account: accountDetails(database, account)
        };
    });

    const result = checkCode();

    // Throw after committing so failed attempts remain counted.
    if (result.error !== null) {
        throw new Error(result.error);
    }

    if (result.account === null) {
        throw new Error("Account verification failed");
    }

    return result.account;
}