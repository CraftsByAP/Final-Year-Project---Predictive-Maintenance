import { hasPermission } from "./permissions";
import { Database } from "bun:sqlite";
import { getSessionUser, hasValidCsrf } from "./sessions";

export function initializeMaintenance(database: Database) {
    // Additive tables: existing accounts and sensor history are preserved.
    database.exec(`
        CREATE TABLE IF NOT EXISTS maintenanceTasks (
            taskId INTEGER PRIMARY KEY AUTOINCREMENT,
            bridgeId TEXT NOT NULL CHECK(bridgeId IN ('bridge1','bridge2','bridge3')),
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            priority TEXT NOT NULL CHECK(priority IN ('Low','Medium','High','Critical')),
            status TEXT NOT NULL CHECK(status IN ('Open','In progress','Completed')),
            assignedTo INTEGER NOT NULL REFERENCES users(userId),
            createdBy INTEGER NOT NULL REFERENCES users(userId),
            dueDate TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS maintenanceAssignedIndex ON maintenanceTasks(assignedTo, status);
        CREATE TABLE IF NOT EXISTS maintenanceEvents (
            eventId INTEGER PRIMARY KEY AUTOINCREMENT,
            taskId INTEGER NOT NULL REFERENCES maintenanceTasks(taskId),
            actorId INTEGER NOT NULL REFERENCES users(userId),
            action TEXT NOT NULL,
            oldStatus TEXT,
            newStatus TEXT NOT NULL,
            recordedAt TEXT NOT NULL
        );
    `);
}

function errorResponse(message: string, status = 400) {
    return Response.json({ error: message }, { status: status });
}

function validateTask(body: any, editing: boolean): string | null {
    if (body === null || typeof body !== "object" || Array.isArray(body)) return "Send a task object.";
    if (typeof body.title !== "string" || body.title.trim().length < 5 || body.title.trim().length > 120) return "Title must contain 5 to 120 characters.";
    if (typeof body.description !== "string" || body.description.trim().length > 2000) return "Description must contain at most 2000 characters.";
    if (!["bridge1", "bridge2", "bridge3"].includes(body.bridgeId)) return "Choose a valid bridge.";
    if (!["Low", "Medium", "High", "Critical"].includes(body.priority)) return "Choose a valid priority.";
    if (!Number.isSafeInteger(body.assignedTo) || body.assignedTo < 1) return "Choose an employee.";
    if (body.dueDate !== null) {
        if (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) return "Due date must be YYYY-MM-DD or empty.";
        const date = new Date(body.dueDate + "T00:00:00Z");
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.dueDate) return "Choose a real calendar date.";
    }
    if (editing) {
        if (!["Open", "In progress", "Completed"].includes(body.status)) return "Choose a valid task status.";
        if (!Number.isSafeInteger(body.version) || body.version < 1) return "Task version is required. Refresh and try again.";
    }
    return null;
}

type ExistingTask = { taskId: number; status: string; version: number };

export async function handleMaintenanceRequest(database: Database, request: Request) {
    const path = new URL(request.url).pathname;
    if (path !== "/api/maintenance" && !path.startsWith("/api/maintenance/")) return null;
    const user = getSessionUser(database, request);
    if (user === null) return errorResponse("Please log in", 401);
    const isAdmin = hasPermission(user, "maintenance.manage");
    if (!isAdmin && !hasPermission(user, "maintenance.own")) return errorResponse("Maintenance permission required", 403);

    if (path === "/api/maintenance/employees" && request.method === "GET") {
        if (!isAdmin) return errorResponse("Admin access required", 403);
        const employees = database.query("SELECT userId, username FROM users WHERE role IN (SELECT roleName FROM rolePermissions WHERE permission = 'maintenance.assign') AND isActive = 1 AND emailVerifiedAt IS NOT NULL ORDER BY username").all();
        return Response.json({ employees: employees });
    }

    if (path === "/api/maintenance" && request.method === "GET") {
        // Employees cannot select another user ID to bypass this restriction.
        const tasks = database.query(`
            SELECT maintenanceTasks.*, assignee.username AS assignedUsername,
                creator.username AS createdUsername
            FROM maintenanceTasks
            JOIN users AS assignee ON assignee.userId = maintenanceTasks.assignedTo
            JOIN users AS creator ON creator.userId = maintenanceTasks.createdBy
            WHERE (? = 1 OR maintenanceTasks.assignedTo = ?)
            ORDER BY CASE status WHEN 'Completed' THEN 1 ELSE 0 END,
                CASE priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
                maintenanceTasks.taskId DESC
        `).all(isAdmin ? 1 : 0, user.userId);
        return Response.json({ tasks: tasks });
    }

    if (!isAdmin)
        return errorResponse("Employees have read-only access", 403);
    if (request.method !== "POST" && request.method !== "PATCH")
        return errorResponse("Action not available", 405);
    if (!hasValidCsrf(request, user))
        return errorResponse("Invalid request token", 403);

    const creating = path === "/api/maintenance" && request.method === "POST";
    const match = /^\/api\/maintenance\/([1-9]\d*)$/.exec(path);
    const editing = match !== null && request.method === "PATCH";
    if (!creating && !editing)
        return errorResponse("Task endpoint not found", 404);
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
        return errorResponse("Send application/json", 415);
    let body;
    try { body = await request.json(); }
    catch {
        return errorResponse("Invalid JSON");
    }
    const validationError = validateTask(body, editing);
    if (validationError !== null)
        return errorResponse(validationError);

    const employee = database.query("SELECT userId FROM users WHERE userId = ? AND role IN (SELECT roleName FROM rolePermissions WHERE permission = 'maintenance.assign') AND isActive = 1 AND emailVerifiedAt IS NOT NULL").get(body.assignedTo);
    if (employee === null)
        return errorResponse("Assign the task to an active employee.");
    const now = new Date().toISOString();

    if (creating) {
        const createTask = database.transaction(function () {
            const result = database.query(`
                INSERT INTO maintenanceTasks(bridgeId,title,description,priority,status,assignedTo,createdBy,dueDate,createdAt,updatedAt)
                VALUES(?,?,?,?,'Open',?,?,?,?,?)
            `).run(body.bridgeId, body.title.trim(), body.description.trim(), body.priority, body.assignedTo, user.userId, body.dueDate, now, now);
            const taskId = Number(result.lastInsertRowid);
            database.query("INSERT INTO maintenanceEvents(taskId,actorId,action,oldStatus,newStatus,recordedAt) VALUES(?,?,'Created',NULL,'Open',?)").run(taskId, user.userId, now);
            return taskId;
        });
        return Response.json({ taskId: createTask(), saved: true }, { status: 201 });
    }

    const taskId = Number(match![1]);
    const updateTask = database.transaction(function () {
        const previous = database.query("SELECT taskId,status,version FROM maintenanceTasks WHERE taskId = ?").get(taskId) as ExistingTask | null;
        if (previous === null)
            return errorResponse("Task not found", 404);
        if (previous.version !== body.version)
            return errorResponse("Another admin changed this task. Refresh before editing again.", 409);
        // Follow the workflow; completed work is kept as a record.
        if (body.status !== previous.status) {
            const advancing = previous.status === "Open" && body.status === "In progress";
            const completing = previous.status === "In progress" && body.status === "Completed";
            if (!advancing && !completing)
                return errorResponse("Move from Open to In progress, then Completed.");
        }
        database.query(`UPDATE maintenanceTasks SET bridgeId=?,title=?,description=?,priority=?,status=?,assignedTo=?,dueDate=?,version=version+1,updatedAt=? WHERE taskId=?`).run(body.bridgeId, body.title.trim(), body.description.trim(), body.priority, body.status, body.assignedTo, body.dueDate, now, taskId);
        database.query("INSERT INTO maintenanceEvents(taskId,actorId,action,oldStatus,newStatus,recordedAt) VALUES(?,?,'Updated',?,?,?)").run(taskId, user.userId, previous.status, body.status, now);
        return Response.json({ saved: true, taskId: taskId });
    });
    return updateTask();
}
