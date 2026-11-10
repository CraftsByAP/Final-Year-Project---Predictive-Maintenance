import { dateHint, taskError } from "../../shared/validation";
import { can } from "./types";
import { useEffect, useState, type FormEvent } from "react";
import type { Account } from "./types";
import { requestApi, errorMessage } from "./apiClient";
import "./maintenance.css";

type Task = {
    taskId: number; bridgeId: string; title: string; description: string;
    priority: string; status: string; assignedTo: number; assignedUsername: string;
    createdUsername: string; dueDate: string | null; version: number; updatedAt: string;
};
type Employee = { userId: number; username: string };
type Props = { user: Account; onSessionExpired: () => void };

export function MaintenancePanel({ user, onSessionExpired }: Props) {
    const isAdmin = can(user, "maintenance.manage");
    const [tasks, setTasks] = useState<Task[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [csrfToken, setCsrfToken] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [bridgeId, setBridgeId] = useState("bridge1");
    const [priority, setPriority] = useState("Medium");
    const [status, setStatus] = useState("Open");
    const [assignedTo, setAssignedTo] = useState("");
    const [dueDate, setDueDate] = useState("");

    async function loadTasks() {
        const result = await requestApi("/api/maintenance");
        if (result.status === 401) { onSessionExpired(); return; }
        if (!result.ok) throw new Error(result.data.error || "Tasks could not be loaded.");
        setTasks(result.data.tasks);
    }

    useEffect(function () {
        async function start() {
            try {
                await loadTasks();
                if (isAdmin) {
                    const session = await requestApi("/api/auth/me");
                    if (session.status === 401) { onSessionExpired(); return; }
                    if (!session.ok) throw new Error("Your session could not be checked.");
                    setCsrfToken(session.data.user.csrfToken);
                    const result = await requestApi("/api/maintenance/employees");
                    if (result.status === 401) { onSessionExpired(); return; }
                    if (!result.ok) throw new Error(result.data.error || "Employees could not be loaded.");
                    setEmployees(result.data.employees);
                }
            } catch (error) { setError(errorMessage(error)); }
            finally { setLoading(false); }
        }
        start();
    }, [user.userId]);

    function resetForm() {
        setEditingTask(null); setTitle(""); setDescription(""); setBridgeId("bridge1");
        setPriority("Medium"); setStatus("Open"); setAssignedTo(""); setDueDate("");
    }

    function editTask(task: Task) {
        setMessage(""); setError(""); setEditingTask(task); setTitle(task.title);
        setDescription(task.description); setBridgeId(task.bridgeId); setPriority(task.priority);
        setStatus(task.status); setAssignedTo(String(task.assignedTo)); setDueDate(task.dueDate || "");
        document.getElementById("taskTitle")?.focus();
    }

    async function submitTask(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(""); setMessage("");
        if (saving) return;
        const body = { title: title, description: description, bridgeId: bridgeId,
            priority: priority, assignedTo: Number(assignedTo), dueDate: dueDate === "" ? null : dueDate,
            status: status, version: editingTask?.version };
        const validationError = taskError(body, editingTask !== null);
        if (validationError !== null) { setError(validationError); return; }
        if (!employees.some(function (employee) { return employee.userId === body.assignedTo; })) {
            setError("Choose an active employee from the list."); return;
        }
        let path = "/api/maintenance";
        let method = "POST";
        if (editingTask !== null) { path += "/" + editingTask.taskId; method = "PATCH"; }
        setSaving(true);
        try {
            const result = await requestApi(path, method, body, csrfToken);
            if (result.status === 401) { onSessionExpired(); return; }
            if (!result.ok) throw new Error(result.data.error || "Task could not be saved.");
            setMessage("Task saved."); resetForm();
            try { await loadTasks(); } catch { setError("Task was saved, but the list could not refresh. Use Refresh tasks."); }
        } catch (error) { setError(errorMessage(error)); }
        finally { setSaving(false); }
    }

    const employeeOptions = [];
    for (const employee of employees) employeeOptions.push(<option key={employee.userId} value={employee.userId}>{employee.username}</option>);
    const taskCards = [];
    for (const task of tasks) {
        taskCards.push(<article className="maintenanceTask" key={task.taskId}>
            <div className="taskHeading"><span>#{task.taskId} · {task.bridgeId}</span><span className={"taskPriority priority" + task.priority}>{task.priority}</span></div>
            <h3>{task.title}</h3><p className="taskDescription">{task.description || "No additional notes."}</p>
            <dl><div><dt>Status</dt><dd>{task.status}</dd></div><div><dt>Assigned to</dt><dd>{task.assignedUsername}</dd></div><div><dt>Due date</dt><dd>{task.dueDate || "Not set"}</dd></div><div><dt>Created by</dt><dd>{task.createdUsername}</dd></div></dl>
            {isAdmin && <button className="secondaryButton" disabled={saving} onClick={function () { editTask(task); }}>Edit task #{task.taskId}</button>}
        </article>);
    }

    return <section className="maintenanceModule" aria-label="Maintenance work">
        <div className="panelHeading"><div><h2>{isAdmin ? "Maintenance work queue" : "Your assigned maintenance tasks"}</h2><p>{isAdmin ? "All three bridges · urgent unfinished tasks first" : "Read-only access · contact an admin for status updates"}</p></div><button className="secondaryButton" disabled={loading || saving} onClick={async function () { setLoading(true); setError(""); try { await loadTasks(); } catch (error) { setError(errorMessage(error)); } finally { setLoading(false); } }}>Refresh tasks</button></div>
        {error && <div className="errorBanner" role="alert">{error}</div>}
        {message && <p className="taskSuccess" role="status">{message}</p>}
        {isAdmin && <form className="taskForm" noValidate onSubmit={submitTask}>
            <h3>{editingTask === null ? "Create a maintenance task" : "Edit task #" + editingTask.taskId}</h3>
            <fieldset disabled={saving || loading || csrfToken === ""}>
                <label htmlFor="taskTitle">Task title</label><input id="taskTitle" required minLength={5} maxLength={120} value={title} onChange={function (event) { setTitle(event.target.value); }} placeholder="Inspect the bridge deck" />
                <label htmlFor="taskDescription">Description</label><textarea id="taskDescription" maxLength={2000} rows={3} value={description} onChange={function (event) { setDescription(event.target.value); }} />
                <div className="taskFormGrid">
                    <div><label htmlFor="taskBridge">Bridge</label><select id="taskBridge" value={bridgeId} onChange={function (event) { setBridgeId(event.target.value); }}><option value="bridge1">Bridge 1</option><option value="bridge2">Bridge 2</option><option value="bridge3">Bridge 3</option></select></div>
                    <div><label htmlFor="taskPriority">Priority</label><select id="taskPriority" value={priority} onChange={function (event) { setPriority(event.target.value); }}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></div>
                    <div><label htmlFor="taskEmployee">Assigned employee</label><select id="taskEmployee" value={assignedTo} required onChange={function (event) { setAssignedTo(event.target.value); }}><option value="">Choose an employee</option>{employeeOptions}</select></div>
                    <div><label htmlFor="taskDueDate">Due date (optional)</label><input id="taskDueDate" aria-describedby="taskDueDateHint" type="text" placeholder="YYYY-MM-DD" value={dueDate} onChange={function (event) { setDueDate(event.target.value); }} /><small id="taskDueDateHint">{dateHint}</small></div>
                    {editingTask !== null && <div><label htmlFor="taskStatus">Status</label><select id="taskStatus" value={status} onChange={function (event) { setStatus(event.target.value); }}><option>{editingTask.status}</option>{editingTask.status === "Open" && <option>In progress</option>}{editingTask.status === "In progress" && <option>Completed</option>}</select></div>}
                </div>
                <p className="analysisSmall">Status workflow: Open → In progress → Completed. Tasks are manually reviewed by admins; creating one does not certify bridge safety.</p>
                {employees.length === 0 && <p>No active employees available. Configure an employee account before creating a task.</p>}
                <div className="taskActions"><button className="primaryButton" disabled={employees.length === 0} type="submit">{saving ? "Saving…" : editingTask === null ? "Create task" : "Save changes"}</button>{editingTask !== null && <button className="secondaryButton" type="button" onClick={resetForm}>Cancel editing</button>}</div>
            </fieldset>
        </form>}
        {loading ? <p role="status">Loading tasks…</p> : taskCards.length === 0 ? <p className="emptyState">No maintenance tasks to display.</p> : <div className="maintenanceGrid">{taskCards}</div>}
    </section>;
}
