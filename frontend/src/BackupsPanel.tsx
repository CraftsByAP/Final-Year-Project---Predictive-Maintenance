import { useEffect, useState } from "react";
import { requestApi, errorMessage } from "./apiClient";
import { downloadFile } from "./fileDownload";
import "./exports.css";

type Backup = { name: string; bytes: number; createdAt: string };
type Recovery = { restoredName: string; sha256: string; counts: Record<string, number> };
export function BackupsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
    const [backups, setBackups] = useState<Backup[]>([]);
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [recovery, setRecovery] = useState<Recovery | null>(null);

    async function loadBackups() {
        const result = await requestApi("/api/backups");
        if (result.status === 401) { onSessionExpired(); return; }
        if (!result.ok) throw new Error(result.data.error || "Backups could not be loaded.");
        setBackups(result.data.backups);
    }
    useEffect(function () {
        async function start() {
            try {
                const session = await requestApi("/api/auth/me");
                if (session.status === 401) { onSessionExpired(); return; }
                if (!session.ok) throw new Error("Could not check your session.");
                setToken(session.data.user.csrfToken);
                await loadBackups();
            } catch (error) { setError(errorMessage(error)); }
            finally { setBusy(false); }
        }
        start();
    }, []);

    async function createBackup() {
        setBusy(true); setError(""); setMessage(""); setRecovery(null);
        try {
            const result = await requestApi("/api/backups", "POST", {}, token);
            if (result.status === 401) { onSessionExpired(); return; }
            if (!result.ok) throw new Error(result.data.error || "Backup could not be created.");
            setMessage("Database snapshot created and integrity checked.");
            try { await loadBackups(); } catch { setError("Backup was created, but the list could not refresh. Use Refresh list."); }
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }
    async function checkRecovery(name: string) {
        setBusy(true); setError(""); setMessage(""); setRecovery(null);
        try {
            const result = await requestApi("/api/backups/" + name + "/check", "POST", {}, token);
            if (result.status === 401) { onSessionExpired(); return; }
            if (!result.ok) throw new Error(result.data.error || "Recovery check failed.");
            setRecovery(result.data); setMessage("Recovery copy passed integrity, relationship and file-match checks. Live data was not replaced.");
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }
    const cards = [];
    for (const backup of backups) cards.push(<article className="backupCard" key={backup.name}>
        <h3>{backup.name}</h3><p>{new Date(backup.createdAt).toLocaleString("en-ZA")} · {(backup.bytes / 1024).toFixed(1)} KiB</p>
        <div className="exportActions"><button className="secondaryButton" disabled={busy} onClick={async function () { setBusy(true); setError(""); try { await downloadFile("/api/backups/" + backup.name, backup.name); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>Download database</button><button className="secondaryButton" disabled={busy || token === ""} onClick={function () { checkRecovery(backup.name); }}>Test recovery copy</button></div>
    </article>);
    const counts = [];
    if (recovery !== null) for (const table of Object.keys(recovery.counts)) counts.push(<li key={table}>{table}: {recovery.counts[table]}</li>);
    return <section className="exportPanel" aria-label="Database backups">
        <h2>Database backups</h2><p>Super admin only. Create a consistent database snapshot, download it and verify a separate recovery copy.</p>
        <div className="simulationNotice"><p>Database copies contain account information and password hashes. Keep them private and out of Git. Source code, trained model files and .env are not included.</p></div>
        <div className="exportActions"><button className="primaryButton" disabled={busy || token === ""} onClick={createBackup}>{busy ? "Working…" : "Create database backup"}</button><button className="secondaryButton" disabled={busy} onClick={async function () { setBusy(true); setError(""); try { await loadBackups(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>Refresh list</button></div>
        {error && <div className="errorBanner" role="alert">{error}</div>}{message && <p role="status" className="backupSuccess">{message}</p>}
        {recovery !== null && <div className="backupCard"><h3>Verified recovery copy</h3><p>{recovery.restoredName}</p><p>SHA-256: {recovery.sha256}</p><ul>{counts}</ul><p>This checks a separate database copy. It does not switch the running application to it.</p></div>}
        {cards.length === 0 ? <p className="emptyState">{busy ? "Loading…" : "No backups created yet."}</p> : cards}
    </section>;
}
