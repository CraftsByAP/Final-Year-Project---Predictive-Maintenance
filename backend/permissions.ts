import { Database } from "bun:sqlite";

// The Actions exist in code
export const permissionNames = [
    "readings.view", "maintenance.own", "maintenance.manage",
    "maintenance.assign", "reports.view", "backups.manage",
    "accounts.manage", "roles.manage"
];

export function getPermissions(database: Database, role: string) {
    const rows = database.query(
        "SELECT permission FROM rolePermissions WHERE roleName = ? ORDER BY permission"
    ).all(role) as { permission: string }[];
    const permissions: string[] = [];
    for (const row of rows) {
        permissions.push(row.permission);
    }
    return permissions;
}

export function hasPermission(user: { permissions: string[] }, permission: string) {
    return user.permissions.includes(permission);
}

export function accountDetails(database: Database, account: {
    userId: number; username: string; email: string | null; role: string
}) {
    return {
        userId: account.userId,
        username: account.username,
        email: account.email,
        role: account.role,
        permissions: getPermissions(database, account.role)
    };
}
