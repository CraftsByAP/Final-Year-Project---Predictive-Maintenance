export async function downloadFile(path: string, filename: string) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
        let message = "Download failed. Please sign in again or try narrower filters.";
        try { const data = await response.json(); message = data.error || message; } catch { /* Keep readable fallback. */ }
        throw new Error(message);
    }
    const blob = await response.blob();
    const address = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = address; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(address); }, 1000);
}
