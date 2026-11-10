// Rules shared by browser forms and the API.
export const namePattern = /^[A-Za-z][A-Za-z0-9_-]{2,39}$/;
export const nameHint = "Use 3–40 letters, numbers, underscores or hyphens. Start with a letter.";
export const passwordHint = "Use 12–128 characters, with at least one non-whitespace character.";
export const bridgeIds = ["bridge1", "bridge2", "bridge3"];
export const priorities = ["Low", "Medium", "High", "Critical"];
export const taskStatuses = ["Open", "In progress", "Completed"];
export const reportKinds = ["readings", "anomalies", "forecasts", "maintenance"];

export function validName(value: unknown): value is string {
    return typeof value === "string" && namePattern.test(value);
}

export function validNewPassword(value: unknown): value is string {
    return typeof value === "string" && value.length >= 12 && value.length <= 128
        && value.trim() !== "" && !/[\u0000-\u001f\u007f]/.test(value);
}

export function loginError(username: unknown, password: unknown) {
    // Existing accounts may predate the new username/password rules.
    if (typeof username !== "string" || username.trim() === "" || username.length > 100
        || /[\u0000-\u001f\u007f]/.test(username)) return "Enter your username (1–100 characters).";
    if (typeof password !== "string" || password.length < 1 || password.length > 128)
        return "Enter your password (1–128 characters).";
    return null;
}

export function validOtp(value: unknown): value is string {
    return typeof value === "string" && /^[0-9]{6}$/.test(value);
}

export function validDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
    if (value.startsWith("0000-")) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const dateHint = "Use YYYY-MM-DD (for example, 2026-11-13), or leave blank.";

function validTaskOrReportDate(value: unknown) {
    return validDate(value) && value >= "1900-01-01";
}

export function dateRangeError(from: string, to: string) {
    if (from !== "" && !validTaskOrReportDate(from)) return "From date must be a real date from 1900 onward. " + dateHint;
    if (to !== "" && !validTaskOrReportDate(to)) return "To date must be a real date from 1900 onward. " + dateHint;
    if (from !== "" && to !== "" && from > to) return "From date must be on or before To date.";
    return null;
}

export function dueDateError(dueDate: unknown) {
    if (dueDate !== null && !validTaskOrReportDate(dueDate)) return "Due date must be a real date from 1900 onward. " + dateHint;
    return null;
}

export function positiveId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function taskError(task: Record<string, unknown>, editing: boolean) {
    if (typeof task.title !== "string" || task.title.trim().length < 5 || task.title.length > 120
        || /[\u0000-\u001f\u007f]/.test(task.title)) return "Title must be one line of 5–120 characters.";
    if (typeof task.description !== "string" || task.description.length > 2000
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(task.description)) return "Description must be text, up to 2,000 characters.";
    if (typeof task.bridgeId !== "string" || !bridgeIds.includes(task.bridgeId)) return "Choose a valid bridge.";
    if (typeof task.priority !== "string" || !priorities.includes(task.priority)) return "Choose a valid priority.";
    if (!positiveId(task.assignedTo)) return "Choose an employee.";
    const dateError = dueDateError(task.dueDate);
    if (dateError !== null) return dateError;
    if (editing) {
        if (typeof task.status !== "string" || !taskStatuses.includes(task.status)) return "Choose a valid status.";
        if (!positiveId(task.version)) return "Refresh the task before editing it.";
    }
    return null;
}

export function isJsonRequest(request: Request) {
    const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    return type === "application/json";
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

