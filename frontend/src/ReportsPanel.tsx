import { dateHint, dateRangeError } from "../../shared/validation";
import { useState, type FormEvent } from "react";
import { requestApi, errorMessage } from "./apiClient";
import { downloadFile } from "./fileDownload";
import "./exports.css";

type Report = { columns: string[]; totalRows: number; rows: Record<string, string | number | null>[]; dateBasis: string };
export function ReportsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
    const [kind, setKind] = useState("readings");
    const [bridgeId, setBridgeId] = useState("all");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [report, setReport] = useState<Report | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    function reportUrl(format: string) {
        const query = new URLSearchParams({ type: kind, bridgeId: bridgeId, from: from, to: to, format: format });
        return "/api/reports?" + query.toString();
    }

    async function preview(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(""); setReport(null);
        if (busy) return;
        const validationError = dateRangeError(from, to);
        if (validationError !== null) { setError(validationError); return; }
        setBusy(true);
        try {
            const result = await requestApi(reportUrl("json"));
            if (result.status === 401) { onSessionExpired(); return; }
            if (!result.ok) throw new Error(result.data.error || "Report could not be generated.");
            setReport(result.data);
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }

    const headings = [];
    const rows = [];
    if (report !== null) {
        for (const column of report.columns) headings.push(<th key={column}>{column}</th>);
        for (let index = 0; index < report.rows.length; index++) {
            const cells = [];
            for (const column of report.columns) cells.push(<td key={column}>{report.rows[index][column] === null ? "—" : String(report.rows[index][column])}</td>);
            rows.push(<tr key={index}>{cells}</tr>);
        }
    }

    return <section className="exportPanel" aria-label="Report exports">
        <h2>Reports</h2><p>Four reports from saved data. Dates are optional and use UTC. Choose a From date on or before the To date.</p>
        <p id="reportDateHint">{dateHint}</p>
        <form noValidate onSubmit={preview} onChange={function () { setReport(null); setError(""); }}>
            <fieldset disabled={busy}><div className="exportFilters">
                <div><label htmlFor="reportKind">Report type</label><select id="reportKind" value={kind} onChange={function (event) { setKind(event.target.value); }}><option value="readings">Sensor readings</option><option value="anomalies">Anomaly detections</option><option value="forecasts">Threshold forecasts</option><option value="maintenance">Maintenance tasks</option></select></div>
                <div><label htmlFor="reportBridge">Bridge</label><select id="reportBridge" value={bridgeId} onChange={function (event) { setBridgeId(event.target.value); }}><option value="all">All bridges</option><option value="bridge1">Bridge 1</option><option value="bridge2">Bridge 2</option><option value="bridge3">Bridge 3</option></select></div>
                <div><label htmlFor="reportFrom">From (UTC)</label><input id="reportFrom" aria-describedby="reportDateHint" type="text" placeholder="YYYY-MM-DD" value={from} onChange={function (event) { setFrom(event.target.value); }} /></div>
                <div><label htmlFor="reportTo">To (UTC)</label><input id="reportTo" aria-describedby="reportDateHint" type="text" placeholder="YYYY-MM-DD" value={to} onChange={function (event) { setTo(event.target.value); }} /></div>
            </div><button className="primaryButton" type="submit">{busy ? "Working…" : "Generate preview"}</button></fieldset>
        </form>
        {error && <div className="errorBanner" role="alert">{error}</div>}
        <p className="exportNote">Forecasts include unavailable reasons. Anomaly reports include only flagged frames. Maintenance dates refer to task creation. All sensor data is synthetic; forecasts are not real failure-time guarantees.</p>
        {report !== null && <div className="dataPanel"><div className="panelHeading"><div><h3>{report.totalRows} report rows</h3><p>{report.dateBasis} · Preview shows up to 200 rows. CSV includes all matching rows, up to 10,000.</p></div><button className="secondaryButton" disabled={busy} onClick={async function () { setBusy(true); setError(""); try { await downloadFile(reportUrl("csv"), "infrasight-" + kind + ".csv"); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>Download CSV</button></div>
            {rows.length === 0 ? <p className="emptyState">No records match these filters. An empty anomaly report can mean no saved frames were flagged.</p> : <div className="tableScroll"><table><thead><tr>{headings}</tr></thead><tbody>{rows}</tbody></table></div>}
        </div>}
    </section>;
}
