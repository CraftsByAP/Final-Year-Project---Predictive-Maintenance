import { Database } from "bun:sqlite";
import { getSessionUser } from "./sessions";

type Row = Record<string, string | number | null>;

function validDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function csvCell(value: string | number | null) {
    if (value === null) return '""';
    let text = String(value);
    if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
}

export async function handleReportRequest(database: Database, request: Request) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/reports")
        return null;
    const user = getSessionUser(database, request);
    if (user === null)
        return Response.json({ error: "Please log in" }, { status: 401 });
    if (user.role !== "admin" && user.role !== "superAdmin")
        return Response.json({ error: "Admin access required" }, { status: 403 });
    if (request.method !== "GET")
        return Response.json({ error: "Use GET for reports" }, { status: 405 });
    const kind = url.searchParams.get("type") || "readings";
    const bridgeId = url.searchParams.get("bridgeId") || "all";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const format = url.searchParams.get("format") || "json";
    if (!["readings", "anomalies", "forecasts", "maintenance"].includes(kind))
        return Response.json({ error: "Unknown report type" }, { status: 400 });
    if (!["all", "bridge1", "bridge2", "bridge3"].includes(bridgeId))
        return Response.json({ error: "Choose a valid bridge" }, { status: 400 });
    if ((from !== "" && !validDate(from)) || (to !== "" && !validDate(to)) || (from !== "" && to !== "" && from > to)) return Response.json({ error: "Enter valid dates with From on or before To" }, { status: 400 });
    if (format !== "json" && format !== "csv")
        return Response.json({ error: "Choose JSON preview or CSV download" }, { status: 400 });

    let columns: string[] = [];
    let select = "";
    let dateField = "frames.recordedAt";
    let bridgeField = "frames.bridgeId";
    let order = "frames.frameId ASC";
    const conditions = ["1 = 1"];
    if (kind === "readings") {
        columns = [
            "frameId",
            "runId",
            "bridgeId",
            "scenario",
            "recordedAt",
            "simulatedHour",
            "sensorName",
            "value",
            "unit"
        ];
        select = "SELECT frames.frameId,frames.runId,frames.bridgeId,frames.scenario,frames.recordedAt,frames.simulatedHour,readings.sensorName,readings.value,readings.unit FROM frames JOIN readings ON readings.frameId=frames.frameId";
        order += ", readings.readingId ASC";
    } else if (kind === "anomalies") {
        columns = [
            "frameId",
            "runId",
            "bridgeId",
            "scenario",
            "recordedAt",
            "simulatedHour",
            "modelVersion",
            "modelScore",
            "isAnomaly"

        ];


        select = "SELECT frames.frameId,frames.runId,frames.bridgeId,frames.scenario,frames.recordedAt,frames.simulatedHour,predictions.modelVersion,predictions.modelScore,predictions.isAnomaly FROM frames JOIN predictions ON predictions.frameId=frames.frameId";
        conditions.push("predictions.isAnomaly = 1");
    } else if (kind === "forecasts") {
        columns = [
            "frameId",

            "runId",
            "bridgeId",
            "recordedAt",
            "simulatedHour",
            "sensorName",
            "value",
            "unit",
            "availability",
            "hoursToThreshold",
            "fitScore",
            "reason"
        ];
        select = "SELECT frames.frameId,frames.runId,frames.bridgeId,frames.recordedAt,frames.simulatedHour,readings.sensorName,readings.value,readings.unit,forecasts.availability,forecasts.hoursToThreshold,forecasts.fitScore,forecasts.reason FROM frames JOIN readings ON readings.frameId=frames.frameId JOIN forecasts ON forecasts.readingId=readings.readingId";
        order += ", readings.readingId ASC";
    } else {
        columns = [
            "taskId",
            "bridgeId",
            "title",
            "description",
            "priority",
            "status",
            "assignedUsername",
            "createdUsername",
            "dueDate",
            "createdAt",
            "updatedAt"
        ];
        select = "SELECT maintenanceTasks.taskId,maintenanceTasks.bridgeId,maintenanceTasks.title,maintenanceTasks.description,maintenanceTasks.priority,maintenanceTasks.status,assignee.username AS assignedUsername,creator.username AS createdUsername,maintenanceTasks.dueDate,maintenanceTasks.createdAt,maintenanceTasks.updatedAt FROM maintenanceTasks JOIN users AS assignee ON assignee.userId=maintenanceTasks.assignedTo JOIN users AS creator ON creator.userId=maintenanceTasks.createdBy";
        dateField = "maintenanceTasks.createdAt"; bridgeField = "maintenanceTasks.bridgeId"; order = "maintenanceTasks.taskId ASC";
    }
    const parameters: string[] = [];

    if (bridgeId !== "all") {
        conditions.push(bridgeField + " = ?");
        parameters.push(bridgeId);
    }
    if (from !== "") {
        conditions.push("julianday(" + dateField + ") >= julianday(?)");
        parameters.push(from);
    }
    if (to !== "") {
        conditions.push("julianday(" + dateField + ") < julianday(?, '+1 day')");
        parameters.push(to); }

    const rows = database.query(select + " WHERE " + conditions.join(" AND ") + " ORDER BY " + order + " LIMIT 10001").all(...parameters) as Row[];
    if (rows.length > 10000)
        return Response.json({ error: "Report exceeds 10,000 rows. Narrow the bridge/date filters." }, { status: 413 });
    if (format === "json")
        return Response.json({ type: kind, columns: columns, totalRows: rows.length, rows: rows.slice(0, 200), previewLimit: 200, dateBasis: kind === "maintenance" ? "Task creation date (UTC)" : "Frame recorded date (UTC)" });
    const lines = [];
    lines.push(columns.join(","));
    for (const row of rows) {
        const cells = [];
        for (const column of columns) cells.push(csvCell(row[column]));
        lines.push(cells.join(","));
    }
    return new Response("\uFEFF" + lines.join("\r\n") + "\r\n", { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="infrasight-' + kind + '-' + new Date().toISOString().slice(0, 10) + '.csv"',
        "Cache-Control": "no-store"
    } });

}
