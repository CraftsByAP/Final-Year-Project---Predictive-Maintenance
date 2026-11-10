import { useEffect, useState } from "react";
import { requestApi, errorMessage } from "./apiClient";
import { downloadFile } from "./fileDownload";
import "./exports.css";

type Backup = { name: string; bytes: number; createdAt: string };
type Recovery = { restoredName: string; sha256: string; counts: Record<string, number>; modelVersion?: string; filesChecked?: number };
const maxUploadBytes = 32 * 1024 * 1024;

export function BackupsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
    const [packages, setPackages] = useState<Backup[]>([]);
    const [backups, setBackups] = useState<Backup[]>([]);
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [recovery, setRecovery] = useState<Recovery | null>(null);
    const [chosenFile, setChosenFile] = useState<File | null>(null);

    async function loadBackups() {
        const result = await requestApi("/api/backups");
        if (result.status === 401) { onSessionExpired(); return; }
        if (!result.ok) throw new Error(result.data.error || "Database backups could not be loaded.");
        setBackups(result.data.backups);
        const packageResult = await requestApi("/api/backups/packages");
        if (packageResult.status === 401) { onSessionExpired(); return; }
        if (!packageResult.ok) throw new Error(packageResult.data.error || "Backup packages could not be loaded.");
        setPackages(packageResult.data.packages);
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

    function begin() { setBusy(true); setError(""); setMessage(""); setRecovery(null); }

    async function createBackup(packageBackup: boolean) {
        begin();
        try {
            let path = "/api/backups";
            if (packageBackup) path += "/packages";
            const result = await requestApi(path, "POST", {}, token);
            if (result.status === 401) { onSessionExpired(); return; }
            if (!result.ok) throw new Error(result.data.error || "Backup could not be created.");
            setMessage(packageBackup ? "Package created. Download it, then copy it to your USB drive or private cloud storage." : "Database-only snapshot created and checked.");
            try { await loadBackups(); } catch { setError("Backup created, but the list could not refresh. Use Refresh list."); }
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }

    async function checkRecovery(name: string, packageBackup: boolean) {
        begin();
        try {
            let path = "/api/backups/";
            if (packageBackup) path += "packages/";
            const result = await requestApi(path + encodeURIComponent(name) + "/check", "POST", {}, token);
            if (result.status === 401) { onSessionExpired(); return; }
            if (!result.ok) throw new Error(result.data.error || "Recovery check failed.");
            setRecovery(result.data);
            setMessage(packageBackup ? "Database and model files recovered to a separate folder and checked. Live files were not replaced." : "Database recovery copy passed its checks. Live data was not replaced.");
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }

    async function uploadCheck(event: React.FormEvent) {
        event.preventDefault(); if (busy) return; begin();
        try {
            if (chosenFile === null) throw new Error("Choose your downloaded InfraSight ZIP package.");
            if (!chosenFile.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a ZIP package, not a database-only file.");
            if (chosenFile.size === 0) throw new Error("That ZIP file is empty. Choose a complete backup package.");
            if (chosenFile.size > maxUploadBytes) throw new Error("Choose a package no larger than 32 MiB.");
            const response = await fetch("/api/backups/packages/check-upload", {
                method: "POST", credentials: "same-origin", cache: "no-store",
                headers: { "Content-Type": "application/zip", "X-CSRF-Token": token }, body: chosenFile
            });
            if (response.status === 401) { onSessionExpired(); return; }
            let result;
            try { result = await response.json(); } catch { throw new Error("The server could not check this upload. Check its size and that the updated API is running."); }
            if (!response.ok) throw new Error(result.error || "Uploaded package could not be checked.");
            setRecovery(result);
            setMessage("Your selected file passed recovery checks. Live files were not replaced.");
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }

    async function downloadBackup(path: string, name: string) {
        setBusy(true); setError("");
        try { await downloadFile(path, name); setMessage("Download requested. Check your browser's Downloads, then copy the file to independent storage."); }
        catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }

    const packageCards = [];
    for (const backup of packages) packageCards.push(<article className="backupCard" key={backup.name}>
        <h3>{backup.name}</h3><p>Database + trained model + metadata + evaluation</p>
        <p>{new Date(backup.createdAt).toLocaleString("en-ZA")} · {(backup.bytes / 1024).toFixed(1)} KiB · Stored on this server</p>
        <div className="exportActions">
            <button className="secondaryButton" disabled={busy} onClick={function () { downloadBackup("/api/backups/packages/" + backup.name, backup.name); }}>Download package</button>
            <button className="secondaryButton" disabled={busy || !token} onClick={function () { checkRecovery(backup.name, true); }}>Check package recovery</button>
        </div>
    </article>);
    const databaseCards = [];
    for (const backup of backups) databaseCards.push(<article className="backupCard" key={backup.name}>
        <h3>{backup.name}</h3><p>Database only · {new Date(backup.createdAt).toLocaleString("en-ZA")} · {(backup.bytes / 1024).toFixed(1)} KiB</p>
        <div className="exportActions">
            <button className="secondaryButton" disabled={busy} onClick={function () { downloadBackup("/api/backups/" + backup.name, backup.name); }}>Download database</button>
            <button className="secondaryButton" disabled={busy || !token} onClick={function () { checkRecovery(backup.name, false); }}>Test database recovery copy</button>
        </div>
    </article>);
    const counts = [];
    if (recovery !== null) for (const table of Object.keys(recovery.counts)) counts.push(<li key={table}>{table}: {recovery.counts[table]}</li>);

    return <section className="exportPanel" aria-label="Application backups">
        <h2>Application data backups</h2>
        <p>Create a package, download it, copy it to independent storage, then select that copy below to test recovery.</p>
        <div className="simulationNotice"><p>Packages contain account records and password hashes. Keep them private. Source code is kept in Git; .env and secret configuration must be secured separately. A download on this laptop is still a local copy.</p></div>
        <div className="exportActions">
            <button className="primaryButton" disabled={busy || !token} onClick={function () { createBackup(true); }}>{busy ? "Working…" : "Create backup package"}</button>
            <button className="secondaryButton" disabled={busy} onClick={async function () { setBusy(true); setError(""); try { await loadBackups(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>Refresh list</button>
        </div>
        {error && <div className="errorBanner" role="alert">{error}</div>}
        {message && <p role="status" className="backupSuccess">{message}</p>}
        {recovery !== null && <div className="backupCard"><h3>Verified recovery copy</h3><p>Folder: {recovery.restoredName}</p><p>ZIP/file SHA-256: {recovery.sha256}</p>
            {recovery.modelVersion && <p>Model: {recovery.modelVersion} · {recovery.filesChecked} files checked</p>}
            <ul>{counts}</ul><p>This checks restored files in data/recovery-checks. It does not switch the running application to them or prove model accuracy.</p></div>}
        <h3>Database and model packages</h3>
        {packageCards.length === 0 ? <p className="emptyState">{busy ? "Loading…" : "No packages created yet."}</p> : packageCards}
        <form onSubmit={uploadCheck}>
            <fieldset disabled={busy || !token}><legend>Check your downloaded or external copy</legend>
                <label htmlFor="backupUpload">InfraSight backup ZIP (maximum 32 MiB)</label>
                <input id="backupUpload" type="file" accept=".zip,application/zip" onChange={function (event) { setChosenFile(event.target.files?.[0] || null); }} />
                <p className="exportNote">Select a package you created. Recovery checks read the database and verify model file checksums; they never execute the saved ML model.</p>
                <button className="secondaryButton" disabled={chosenFile === null} type="submit">Upload and check recovery</button>
            </fieldset>
        </form>
        <details><summary>Database-only backups</summary>
            <p className="exportNote">Existing snapshots stay available. These do not include the model files.</p>
            <button className="secondaryButton" disabled={busy || !token} onClick={function () { createBackup(false); }}>Create database-only backup</button>
            {databaseCards}
        </details>
    </section>;
}
