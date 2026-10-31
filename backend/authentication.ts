import { Database } from "bun:sqlite";

// Describes Account Info from SQLite.
type UserAccount = {
    userId: number;
    username: string;
    email: string | null;
    passwordHash: string;
    role: string;
    isActive: number;
};


export async function checkCredentials(
    database: Database,
    username: string,
    password: string
) {
    if (typeof username !== "string" || username.trim() === "") {
        throw new Error("Enter your username");
    }

    if (typeof password !== "string" || password === "") {
        throw new Error("Enter your password");
    }

    if (username.length > 100 || password.length > 128) {
        throw new Error("Username or password is too long");
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
        WHERE username = ?
    `).get(username.trim()) as UserAccount | null;

    if (account === null || account.isActive !== 1) {
        throw new Error("Invalid username or password");
    }

    const passwordCorrect = await Bun.password.verify(
        password,
        account.passwordHash
    );

    if (!passwordCorrect) {
        throw new Error("Invalid Username or Password");
    }

    if (account.email === null || account.email.trim() === "") {
        throw new Error(
            "This account needs a registered email. Contact Administration."
        );
    }

    if (
        account.role !== "superAdmin" &&
        account.role !== "admin" &&
        account.role !== "employee"
    ) {
        throw new Error("This account has an unsupported role");
    }

    // Return only the information needed for the next login step.
    // Did not return password hash.
    return {
        userId: account.userId,
        username: account.username,
        email: account.email,
        role: account.role
    };
}