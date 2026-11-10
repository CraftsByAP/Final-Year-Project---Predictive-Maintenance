import { expect, test } from "bun:test";
import { validName, validEmail, validNewPassword, loginError, validOtp, validDate, dateRangeError, dueDateError, taskError, positiveId, isJsonRequest } from "../shared/validation";

test("accepts leap day and rejects rollover, impossible dates and partial input", () => {
    expect(validDate("2028-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-01", "0000-01-01", "2026-1-01", "2026-01-01T00:00:00Z"]) {
        expect(validDate(date)).toBe(false);
    }
});

test("allows blank and same-day filters, rejects reversed report dates", () => {
    expect(dateRangeError("", "")).toBeNull();
    expect(dateRangeError("2026-11-08", "2026-11-08")).toBeNull();
    expect(dateRangeError("2026-11-09", "2026-11-08")).toContain("on or before");
});

test("checks usernames, email format, password policy and OTP strings", () => {
    expect(validName("bob-Admin_2")).toBe(true);
    for (const name of ["1Bob", "Bo", "Bob Admin", "Bob!", "A".repeat(41)]) expect(validName(name)).toBe(false);
    expect(validEmail("bob+demo@example.org")).toBe(true);
    for (const email of ["00", "a@b", "a..b@example.org", "a@-example.org"]) expect(validEmail(email)).toBe(false);
    expect(validNewPassword("DemoOnly-2026!")).toBe(true);
    for (const password of ["too short", " ".repeat(12), "demo\u0000password!", "A".repeat(129)]) expect(validNewPassword(password)).toBe(false);
    expect(loginError("legacy.account", "old-pass")).toBeNull();
    expect(loginError(" ", "old-pass")).not.toBeNull();
    expect(validOtp("012345")).toBe(true);
    expect(validOtp(123456)).toBe(false);
    expect(validOtp("12345x")).toBe(false);
});

test("checks task values and retains existing overdue dates", () => {
    const task = { title: "Inspect bridge", description: "", bridgeId: "bridge1", priority: "High", assignedTo: 2, dueDate: "2024-02-29", status: "Open", version: 1 };
    expect(taskError(task, true)).toBeNull();
    for (const invalid of [{title:"     "},{dueDate:"2026-02-29"},{bridgeId:"bridge4"},{priority:"urgent"},{assignedTo:"2"},{version:0},{status:"Done"}]) {
        expect(taskError({...task,...invalid},true)).not.toBeNull();
    }
    expect(positiveId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
});

test("accepts JSON with a charset but rejects lookalike media types", () => {
    expect(isJsonRequest(new Request("http://local", {headers:{"Content-Type":"application/json; charset=utf-8"}}))).toBe(true);
    expect(isJsonRequest(new Request("http://local", {headers:{"Content-Type":"application/jsonp"}}))).toBe(false);
});

test("rejects malformed or implausibly early dates for tasks and reports", () => {
    for (const value of ["00/00/0001", "0001-01-01", "2026-00-00", "2026-11-", " ", "2026-11-13 "]) {
        expect(dueDateError(value)).not.toBeNull();
        expect(dateRangeError(value, "")).not.toBeNull();
        expect(dateRangeError("", value)).not.toBeNull();
    }
    expect(dueDateError(null)).toBeNull();
    expect(dueDateError("2028-02-29")).toBeNull();
});
