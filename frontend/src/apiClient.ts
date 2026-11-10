export async function requestApi(
    path: string,
    method = "GET",
    body?: object,
    csrfToken = ""
) {
    const headers: Record<string, string> = {};

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    if (method !== "GET" && csrfToken !== "") {
        headers["X-CSRF-Token"] = csrfToken;
    }

    const options: RequestInit = {
        method: method,
        headers: headers,
        credentials: "same-origin",
        cache: "no-store"
    };

    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(path, options);
    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("The server did not return JSON. Check that the updated Bun API is running.");
    }

    return {
        ok: response.ok,
        status: response.status,
        data: data
    };
}

export function errorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return "The request could not be completed. Please try again.";
}
