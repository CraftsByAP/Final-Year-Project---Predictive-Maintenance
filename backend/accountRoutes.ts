import { Database } from "bun:sqlite";
import { resolveMx, resolve4, resolve6 } from "node:dns/promises";
import { getSessionUser, hasValidCsrf } from "./sessions";
import { getPermissions, hasPermission, permissionNames } from "./permissions";

type UserRow = { userId: number; username: string; email: string; role: string; isActive: number; version: number };
type RoleRow = { roleName: string; version: number };

function problem(message: string, status = 400) {
    return Response.json({ error: message }, { status: status });
}

export function validEmail(email: unknown): email is string {
    if (typeof email !== "string" || email.length > 254) return false;
    const pieces = email.split("@");
    if (pieces.length !== 2 || pieces[0].length > 64) return false;
    if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(pieces[0])) return false;
    const labels = pieces[1].split(".");
    if (labels.length < 2 || !/^[a-z]{2,63}$/i.test(labels[labels.length - 1])) return false;
    for (const label of labels) {
        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) return false;
    }
    return true;
}

// DNS checks routing only. A successful email OTP proves access to the mailbox.
export async function checkEmailDomain(email: string) {
    const domain = email.split("@")[1];
    try {
        const records = await resolveMx(domain);
        if (records.length > 0) {
            for (const record of records) {
                if (record.exchange && record.exchange !== ".") return true;
            }
            return false; // Explicit null MX means the domain does not accept mail.
        }
    } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "ENODATA" && code !== "ENOTFOUND") return false;
    }
    // SMTP permits implicit MX when no MX record exists.
    try { if ((await resolve4(domain)).length > 0) return true; } catch {}
    try { if ((await resolve6(domain)).length > 0) return true; } catch {}
    return false;
}

function revokeAccess(database: Database, userId: number) {
    database.query("DELETE FROM sessions WHERE userId = ?").run(userId);
    database.query("UPDATE emailCodes SET usedAt = ? WHERE userId = ? AND usedAt IS NULL").run(Date.now(), userId);
}

function recordEvent(database: Database, actorId: number, action: string, target: string) {
    database.query("INSERT INTO accountEvents(actorId,action,target,recordedAt) VALUES(?,?,?,?)")
        .run(actorId, action, target, new Date().toISOString());
}

function managersRemain(database: Database) {
    const managers = database.query(`
        SELECT userId FROM users WHERE isActive = 1 AND emailVerifiedAt IS NOT NULL
        AND role IN (SELECT roleName FROM rolePermissions WHERE permission = 'accounts.manage')
        AND role IN (SELECT roleName FROM rolePermissions WHERE permission = 'roles.manage')
    `).all();
    return managers.length > 0;
}

function validatePermissions(value: unknown): value is string[] {
    if (!Array.isArray(value) || value.length > permissionNames.length) return false;
    const seen: string[] = [];
    for (const permission of value) {
        if (typeof permission !== "string" || !permissionNames.includes(permission) || seen.includes(permission)) return false;
        seen.push(permission);
    }
    return true;
}

export async function handleAccountRequest(
    database: Database,
    request: Request,
    domainCheck = checkEmailDomain
) {
    const path = new URL(request.url).pathname;
    if (path !== "/api/admin/users" && !path.startsWith("/api/admin/users/") && path !== "/api/admin/roles" && !path.startsWith("/api/admin/roles/")) return null;
    const user = getSessionUser(database, request);
    if (user === null) return problem("Please log in", 401);
    const roleRequest = path.startsWith("/api/admin/roles");
    const needed = roleRequest ? "roles.manage" : "accounts.manage";
    // Account managers can read the role list to choose a role for a person.
    const roleList = path === "/api/admin/roles" && request.method === "GET";
    if (!hasPermission(user, needed) && !(roleList && hasPermission(user, "accounts.manage"))) return problem("Permission required: " + needed, 403);

    if (request.method === "GET" && path === "/api/admin/users") {
        const users = database.query("SELECT userId,username,email,role,isActive,emailVerifiedAt,version,createdAt FROM users ORDER BY username").all();
        return Response.json({ users: users });
    }
    if (request.method === "GET" && roleList) {
        const roles = database.query("SELECT roleName,version FROM roles ORDER BY roleName").all() as RoleRow[];
        const rows = [];
        for (const role of roles) rows.push({ ...role, permissions: getPermissions(database, role.roleName) });
        return Response.json({ roles: rows, permissions: permissionNames });
    }
    if (request.method !== "POST" && request.method !== "PATCH") return problem("Use GET, POST or PATCH", 405);
    if (!hasValidCsrf(request, user)) return problem("Invalid request token", 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return problem("Send application/json", 415);
    let body;
    try { body = await request.json(); } catch { return problem("Invalid JSON"); }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return problem("Send a form object");

    if (roleRequest) {
        if (!validatePermissions(body.permissions)) return problem("Choose valid permissions without duplicates");
        const creating = path === "/api/admin/roles" && request.method === "POST";
        const match = /^\/api\/admin\/roles\/([A-Za-z][A-Za-z0-9_-]{2,39})$/.exec(path);
        if (!creating && !(match && request.method === "PATCH")) return problem("Role endpoint not found", 404);
        const roleName = creating ? body.roleName : match![1];
        if (typeof roleName !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,39}$/.test(roleName)) return problem("Role name: 3–40 letters, numbers, underscores or hyphens; start with a letter");
        const saveRole = database.transaction(function () {
            const existing = database.query("SELECT roleName,version FROM roles WHERE roleName = ?").get(roleName) as RoleRow | null;
            if (creating && existing !== null) return problem("Role name already exists", 409);
            if (!creating && existing === null) return problem("Role not found", 404);
            if (!creating && body.version !== existing!.version) return problem("Role changed. Refresh before saving", 409);
            if (creating) database.query("INSERT INTO roles(roleName,createdAt) VALUES(?,?)").run(roleName, new Date().toISOString());
            database.query("DELETE FROM rolePermissions WHERE roleName = ?").run(roleName);
            for (const permission of body.permissions) database.query("INSERT INTO rolePermissions VALUES(?,?)").run(roleName, permission);
            if (!managersRemain(database)) throw new Error("Keep at least one active, verified account with account and role management permissions");
            database.query("UPDATE roles SET version = version + 1 WHERE roleName = ?").run(roleName);
            const affected = database.query("SELECT userId FROM users WHERE role = ?").all(roleName) as { userId: number }[];
            for (const account of affected) revokeAccess(database, account.userId);
            recordEvent(database, user.userId, creating ? "Role created" : "Role permissions changed", roleName);
            return Response.json({ saved: true, signInAgain: user.role === roleName }, { status: creating ? 201 : 200 });
        });
        try { return saveRole(); } catch (error) {
            if (error instanceof Error && error.message.startsWith("Keep at least")) return problem(error.message, 409);
            throw error;
        }
    }

    const creating = path === "/api/admin/users" && request.method === "POST";
    const match = /^\/api\/admin\/users\/([1-9]\d*)$/.exec(path);
    if (!creating && !(match && request.method === "PATCH")) return problem("Account endpoint not found", 404);
    if (typeof body.username !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,39}$/.test(body.username)) return problem("Username: 3–40 letters, numbers, underscores or hyphens; start with a letter");
    if (typeof body.email !== "string") return problem("Enter an email address");
    const email = body.email.trim().toLowerCase();
    if (!validEmail(email)) return problem("Enter a correctly formatted email address");
    if (typeof body.role !== "string" || database.query("SELECT roleName FROM roles WHERE roleName = ?").get(body.role) === null) return problem("Choose an existing role");
    if (typeof body.isActive !== "boolean") return problem("Choose active or disabled");
    const changingPassword = creating || (typeof body.password === "string" && body.password !== "");
    if (changingPassword && (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128)) return problem("Password must contain 12–128 characters");
    if (!creating && body.password !== undefined && typeof body.password !== "string") return problem("Password must be text");
    // Avoid slow DNS for an unchanged address.
    const userId = creating ? 0 : Number(match![1]);
    const oldAddress = database.query("SELECT email FROM users WHERE userId = ?").get(userId) as { email: string } | null;
    if ((creating || oldAddress?.email !== email) && !await domainCheck(email)) return problem("Email domain could not be confirmed as accepting mail. Check spelling and your network");
    let passwordHash: string | null = null;
    if (changingPassword) passwordHash = await Bun.password.hash(body.password, { algorithm: "argon2id" });

    const saveUser = database.transaction(function () {
        // Recheck after asynchronous DNS/password hashing in case a role was revoked.
        const currentActor = getSessionUser(database, request);
        if (currentActor === null || !hasPermission(currentActor, "accounts.manage")) return problem("Please log in again", 401);
        const previous = database.query("SELECT userId,username,email,role,isActive,version FROM users WHERE userId = ?").get(userId) as UserRow | null;
        if (!creating && previous === null) return problem("Account not found", 404);
        if (!creating && body.version !== previous!.version) return problem("Account changed. Refresh before saving", 409);
        if (userId === user.userId) return problem("Use another authorised manager to change your own account", 409);
        const duplicate = database.query("SELECT userId FROM users WHERE (username = ? OR email = ?) AND userId != ?").get(body.username, email, userId);
        if (duplicate !== null) return problem("Username or email already belongs to an account", 409);
        if (database.query("SELECT roleName FROM roles WHERE roleName = ?").get(body.role) === null) return problem("Role no longer exists. Refresh");
        let savedId = userId;
        if (creating) {
            const result = database.query("INSERT INTO users(username,email,passwordHash,role,isActive,createdAt) VALUES(?,?,?,?,?,?)")
                .run(body.username, email, passwordHash!, body.role, body.isActive ? 1 : 0, new Date().toISOString());
            savedId = Number(result.lastInsertRowid);
        } else {
            database.query(`UPDATE users SET username=?,email=?,role=?,isActive=?,version=version+1,
                emailVerifiedAt=CASE WHEN email = ? THEN emailVerifiedAt ELSE NULL END WHERE userId=?`)
                .run(body.username, email, body.role, body.isActive ? 1 : 0, email, userId);
            if (passwordHash !== null) database.query("UPDATE users SET passwordHash=? WHERE userId=?").run(passwordHash, userId);
            revokeAccess(database, userId);
        }
        if (!managersRemain(database)) throw new Error("Keep at least one active, verified account with account and role management permissions");
        recordEvent(database, user.userId, creating ? "Account created; awaiting email verification" : "Account updated; sessions revoked", String(savedId));
        return Response.json({ saved: true, userId: savedId, message: "Saved. New or changed email addresses are verified during the person's next password + email OTP login." }, { status: creating ? 201 : 200 });
    });
    try { return saveUser(); } catch (error) {
        if (error instanceof Error && error.message.startsWith("Keep at least")) return problem(error.message, 409);
        throw error;
    }
}
