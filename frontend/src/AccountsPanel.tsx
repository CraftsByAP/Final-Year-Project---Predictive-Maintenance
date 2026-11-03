import { useEffect, useState } from "react";
import { requestApi, errorMessage } from "./apiClient";
import { type Account, can } from "./types";
import "./accounts.css";

type TeamUser = Account & { isActive: number; emailVerifiedAt: number | null; version: number };
type TeamRole = { roleName: string; permissions: string[]; version: number };
type Props = { user: Account; onSessionExpired: () => void };

const permissionLabels: Record<string, string> = {
    "readings.view": "View bridge readings and graphs",
    "maintenance.own": "Read tasks assigned to this person",
    "maintenance.manage": "Create, edit and view all maintenance tasks",
    "maintenance.assign": "Allow tasks to be assigned to people in this role",
    "reports.view": "View and export reports",
    "backups.manage": "Create, download and check database backups (sensitive data)",
    "accounts.manage": "Create, edit and disable accounts; choose their roles",
    "roles.manage": "Create roles and change their permissions"
};

export function AccountsPanel({ user, onSessionExpired }: Props) {
    const [users, setUsers] = useState<TeamUser[]>([]);
    const [roles, setRoles] = useState<TeamRole[]>([]);
    const [permissionNames, setPermissionNames] = useState<string[]>([]);
    const [csrfToken, setCsrfToken] = useState("");
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("");
    const [isActive, setIsActive] = useState(true);
    const [editingUser, setEditingUser] = useState<TeamUser | null>(null);
    const [roleName, setRoleName] = useState("");
    const [chosenPermissions, setChosenPermissions] = useState<string[]>([]);
    const [editingRole, setEditingRole] = useState<TeamRole | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    async function load() {
        const session = await requestApi("/api/auth/me");
        if (session.status === 401) {
            onSessionExpired();
            return;
        }
        if (!session.ok)
            throw new Error("Session could not be checked");
        setCsrfToken(session.data.user.csrfToken);
        const roleResult = await requestApi("/api/admin/roles");
        if (roleResult.status === 401) {
            onSessionExpired();
            return;
        }
        if (!roleResult.ok) throw new Error(roleResult.data.error);
        setRoles(roleResult.data.roles);
        setPermissionNames(roleResult.data.permissions);
        if (can(user, "accounts.manage")) {
            const result = await requestApi("/api/admin/users");
            if (result.status === 401) {
                onSessionExpired();
                return;
            }
            if (!result.ok)
                throw new Error(result.data.error);
            setUsers(result.data.users);
        }
    }

    useEffect(function () {
        setBusy(true);
        load().catch(function (error) { setError(errorMessage(error)); }).finally(function () { setBusy(false); });
    }, []);

    function clearUser() {
        setEditingUser(null);
        setUsername("");
        setEmail("");
        setPassword("");
        setRole("");
        setIsActive(true);
    }

    async function saveUser(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        try {
            let path = "/api/admin/users";
            let method = "POST";
            if (editingUser !== null) { path += "/" + editingUser.userId; method = "PATCH"; }
            const result = await requestApi(path, method, {
                username: username.trim(), email: email.trim(), password: password,
                role: role, isActive: isActive, version: editingUser?.version
            }, csrfToken);
            if (result.status === 401) {
                onSessionExpired();
                return;
            }
            if (!result.ok)
                throw new Error(result.data.error);
            setMessage(result.data.message);
            clearUser();
            await load();
        } catch (error) {
            setError(errorMessage(error));
        }
        finally { setBusy(false);
        }
    }

    async function saveRole(event: React.FormEvent) {
        event.preventDefault(); setBusy(true); setError(""); setMessage("");
        try {
            let path = "/api/admin/roles";
            let method = "POST";
            if (editingRole !== null) {

                path += "/" + encodeURIComponent(editingRole.roleName); method = "PATCH";
            }
            const result = await requestApi(path, method, {
                roleName: roleName, permissions: chosenPermissions, version: editingRole?.version
            }, csrfToken);
            if (result.status === 401) {
                onSessionExpired();
                return;
            }
            if (!result.ok)
                throw new Error(result.data.error);
            if (result.data.signInAgain) {
                onSessionExpired();
                return;
            }
            setMessage("Role saved. People using a changed role must sign in again.");
            setRoleName(""); setChosenPermissions([]); setEditingRole(null); await load();
        } catch (error) {
            setError(errorMessage(error));
        }
        finally {
            setBusy(false);
        }
    }

    const roleOptions = [];
    const roleRows = [];
    for (const teamRole of roles) {
        roleOptions.push(<option key={teamRole.roleName} value={teamRole.roleName}>{teamRole.roleName}</option>);
        const labels = [];
        for (const permission of teamRole.permissions) labels.push(permissionLabels[permission] || permission);
        roleRows.push(<tr key={teamRole.roleName}><td>{teamRole.roleName}</td><td>{labels.join("; ") || "No actions granted"}</td><td>
            <button className="secondaryButton" disabled={busy} onClick={function () {
                setEditingRole(teamRole); setRoleName(teamRole.roleName); setChosenPermissions([...teamRole.permissions]); setMessage("");
            }}>Edit role</button></td></tr>);
    }
    const userRows = [];
    for (const account of users) {
        let status = "Awaiting email verification";
        if (account.isActive === 0)
            status = "Disabled";
        else if (account.emailVerifiedAt !== null) status = "Active · email verified";
        userRows.push(<tr key={account.userId}><td>{account.username}</td><td>{account.role}</td><td>{account.email}</td><td>{status}</td><td>
            <button className="secondaryButton" disabled={busy || account.userId === user.userId} onClick={function () {
                setEditingUser(account); setUsername(account.username); setEmail(account.email || ""); setRole(account.role);
                setIsActive(account.isActive === 1); setPassword(""); setMessage("");
            }}>Edit account</button></td></tr>);
    }
    const permissionBoxes = [];
    for (const permission of permissionNames) {
        permissionBoxes.push(<label className="permissionChoice" key={permission}>
            <input type="checkbox" checked={chosenPermissions.includes(permission)} onChange={function (event) {
                const next: string[] = [];
                for (const chosen of chosenPermissions) { if (chosen !== permission) next.push(chosen); }
                if (event.target.checked) next.push(permission);
                setChosenPermissions(next);
            }} />{permissionLabels[permission] || permission}</label>);
    }

    return <section className="accountsPanel">
        {error && <div className="errorBanner" role="alert">{error}</div>}
        {message && <p className="taskSuccess" role="status">{message}</p>}
        <p>Accounts are invited by a manager. New email addresses must complete a password and email OTP login before dashboard access. Disable a person who leaves; their task history stays in the system.</p>
        {can(user, "accounts.manage") && <>
            <form className="dataPanel accountForm" onSubmit={saveUser}>
                <h2>{editingUser ? "Edit account" : "Create an account"}</h2>
                <fieldset disabled={busy || !csrfToken}>
                    <label>Username<input required pattern="[A-Za-z][A-Za-z0-9_-]{2,39}" minLength={3} maxLength={40} value={username} onChange={function (event) { setUsername(event.target.value); }} /></label>
                    <label>Email address<input required type="email" maxLength={254} value={email} onChange={function (event) { setEmail(event.target.value); }} /></label>
                    <label>{editingUser ? "New password (leave empty to keep current password)" : "Password (12–128 characters)"}<input required={!editingUser} type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={function (event) { setPassword(event.target.value); }} /></label>
                    <label>Role<select required value={role} onChange={function (event) { setRole(event.target.value); }}><option value="">Choose a role</option>{roleOptions}</select></label>
                    <label className="permissionChoice"><input type="checkbox" checked={isActive} onChange={function (event) { setIsActive(event.target.checked); }} />Enabled (email verification still required)</label>
                    <button className="secondaryButton" type="submit">{busy ? "Saving…" : "Save account"}</button>
                    {editingUser && <button className="secondaryButton" type="button" onClick={clearUser}>Cancel edit</button>}
                </fieldset>
            </form>
            <div className="dataPanel tableScroll"><table><thead><tr><th>Username</th><th>Role</th><th>Email</th><th>Status</th><th>Action</th></tr></thead><tbody>{userRows}</tbody></table></div>
        </>}
        {can(user, "roles.manage") && <>
            <form className="dataPanel accountForm" onSubmit={saveRole}>
                <h2>{editingRole ? "Edit role permissions" : "Create a role"}</h2>
                <p>Management permissions grant broad access. Choose only what this role needs.</p>
                <fieldset disabled={busy || !csrfToken}>
                    <label>Role name<input required disabled={editingRole !== null} pattern="[A-Za-z][A-Za-z0-9_-]{2,39}" minLength={3} maxLength={40} value={roleName} onChange={function (event) { setRoleName(event.target.value); }} /></label>
                    {permissionBoxes}
                    <button className="secondaryButton" type="submit">Save role</button>
                    {editingRole && <button className="secondaryButton" type="button" onClick={function () { setEditingRole(null); setRoleName(""); setChosenPermissions([]); }}>Cancel edit</button>}
                </fieldset>
            </form>
            <div className="dataPanel tableScroll"><table><thead><tr><th>Role</th><th>Permissions</th><th>Action</th></tr></thead><tbody>{roleRows}</tbody></table></div>
        </>}
        <button className="secondaryButton" disabled={busy} onClick={function () {
            setBusy(true); setError(""); load().catch(function (error) { setError(errorMessage(error)); }).finally(function () { setBusy(false); });
        }}>Refresh accounts and roles</button>
    </section>;
}
