import { maxBackupBytes } from "./backupPackage";

export const maxServerBodyBytes = maxBackupBytes;

export async function limitRequestBody(request: Request) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/api/backups/packages/check-upload") return request;
    if (request.body === null) return request;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.length;
        if (total > 65536) {
            await reader.cancel();
            return Response.json({ error: "Request exceeds 64 KiB" }, { status: 413 });
        }
        chunks.push(chunk.value);
    }
    return new Request(request, { body: Buffer.concat(chunks) });
}
