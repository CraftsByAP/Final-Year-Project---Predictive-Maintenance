import { input, password as askPassword } from "@inquirer/prompts";

async function main() {
    const enteredUrl = await input({
        message: "API address:",
        default: "http://127.0.0.1:3000"
    });
    const apiUrl = enteredUrl.trim().replace(/\/$/, "");
    const username = await input({ message: "Username:" });
    const password = await askPassword({ message: "Password:", mask: true });

    const loginResponse = await fetch(apiUrl + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password: password })
    });
    const login = await loginResponse.json();
    if (!loginResponse.ok) {
        throw new Error(login.error || "Login request failed");
    }
    console.log("Check your registered email for the code.");

    const code = await input({ message: "Six-digit code:" });
    const verifyResponse = await fetch(apiUrl + "/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codeId: login.codeId, code: code.trim() })
    });
    const verification = await verifyResponse.json();
    if (!verifyResponse.ok) {
        throw new Error(verification.error || "Verification failed");
    }

    const setCookie = verifyResponse.headers.get("Set-Cookie");
    if (setCookie === null) {
        throw new Error("The API did not issue a session cookie");
    }
    // A terminal client carries the cookie manually. Browsers do this for us.
    const cookie = setCookie.split(";")[0];
    console.log("Logged in as:", verification.user.username);
    console.log("Role:", verification.user.role);

    const meResponse = await fetch(apiUrl + "/api/auth/me", {
        headers: { Cookie: cookie }
    });
    if (!meResponse.ok) {
        throw new Error("Session check failed");
    }
    console.log("Session check passed.");

    const readingsResponse = await fetch(apiUrl + "/api/readings?limit=3", {
        headers: { Cookie: cookie }
    });
    const readings = await readingsResponse.json();
    if (!readingsResponse.ok) {
        throw new Error(readings.error || "Readings request failed");
    }
    console.log("Stored readings retrieved:", readings.readingCount);

    const adminResponse = await fetch(apiUrl + "/api/admin/users", {
        headers: { Cookie: cookie }
    });
    console.log("Super-admin users endpoint status:", adminResponse.status);

    const logoutResponse = await fetch(apiUrl + "/api/auth/logout", {
        method: "POST",
        headers: {
            Cookie: cookie,
            "X-CSRF-Token": verification.csrfToken
        }
    });
    if (!logoutResponse.ok) {
        throw new Error("Logout failed");
    }

    const afterLogout = await fetch(apiUrl + "/api/auth/me", {
        headers: { Cookie: cookie }
    });
    if (afterLogout.status !== 401) {
        throw new Error("Old session still works after logout");
    }
    console.log("Logout passed. Old session is rejected.");
}

try {
    await main();
} catch (error) {
    if (error instanceof Error) {
        console.error(error.message);
    } else {
        console.error("API authentication test failed");
    }
    process.exitCode = 1;
}
