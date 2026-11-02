import type { Reading } from "./types";

export function getSensorSamples(readings: Reading[], sensorName: string, bridgeId: string) {
    let runId = "";
    for (const reading of readings) {
        if (reading.bridgeId === bridgeId) runId = reading.runId;
    }
    const samples = [];
    for (const reading of readings) {
        if (reading.bridgeId === bridgeId && reading.runId === runId && reading.sensorName === sensorName) {
            samples.push(reading);
        }
    }
    return samples.slice(-60);
}
