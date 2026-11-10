import type { Reading } from "./types";
import "./analysis.css";

type AnalysisReading = Reading & {
    modelVersion?: string | null;
    modelScore?: number | null;
    isAnomaly?: number | null;
    predictionAvailability?: string | null;
    forecastAvailability?: string | null;
    hoursToThreshold?: number | null;
    fitScore?: number | null;
    forecastReason?: string | null;
};

const sensors = [
    { name: "deflection", label: "Deflection", critical: 10 },
    { name: "crackWidth", label: "Crack width", critical: 0.3 },
    { name: "strain", label: "Strain", critical: 800 },
    { name: "thermal", label: "Thermal difference", critical: 15 }
];

export function AnalysisPanel({ readings }: { readings: AnalysisReading[] }) {
    let latest: AnalysisReading | null = null;
    if (readings.length > 0) latest = readings[readings.length - 1];

    let modelLabel = "No saved prediction";
    let modelClass = "neutral";
    if (latest !== null) {
        if (latest.predictionAvailability === "warmingUp") {
            modelLabel = "Model warming up : needs 30 frames in this run";
        } else if (latest.predictionAvailability === "available") {
            if (latest.isAnomaly === 1) {
                modelLabel = "Anomaly detected";
                modelClass = "warning";
            } else if (latest.isAnomaly === 0) {
                modelLabel = "Within trained pattern";
                modelClass = "good";
            }
        }
    }

    const forecastCards = [];
    for (const sensor of sensors) {
        let reading: AnalysisReading | null = null;
        for (const sample of readings) {
            if (latest !== null && sample.frameId === latest.frameId && sample.sensorName === sensor.name) reading = sample;
        }
        let heading = "Unavailable";
        let detail = "No saved forecast for this sensor.";
        let statusClass = "neutral";
        if (reading !== null) {
            if (Math.abs(reading.value) >= sensor.critical) {
                heading = "Threshold already reached";
                detail = "The Latest Reading meets or exceeds the Critical Limit. Investigate";
                statusClass = "critical";
            } else if (reading.forecastAvailability === "Available" && typeof reading.hoursToThreshold === "number") {
                heading = reading.hoursToThreshold.toFixed(2) + " simulated hours";
                detail = "Estimated Time to the Critical Limit if the recent linear trend continues.";
                statusClass = "warning";
            } else if (reading.forecastReason) {
                detail = reading.forecastReason;
            }
        }
        forecastCards.push(<article className="forecastCard" key={sensor.name}>
            <h3>{sensor.label}</h3><p className={"statusPill " + statusClass}>{heading}</p><p>{detail}</p>
            {reading?.forecastAvailability === "Available" && typeof reading.fitScore === "number" && <p className="analysisSmall">Trend fit R²: {reading.fitScore.toFixed(3)}. This is a line-fit measure, not a probability of failure.</p>}
        </article>);
    }

    return <section className="analysisPanel" aria-label="Saved predictions and forecasts">
        <div className="sectionLabel"><h2>Model analysis & Forecasts</h2><span>Latest saved frame :  updates with readings</span></div>
        <div className="modelSummary"><div><h3>IsolationForest result</h3><p className={"statusPill " + modelClass}>{modelLabel}</p></div>
            <div><span>Raw Model Score</span><strong>{typeof latest?.modelScore === "number" ? latest.modelScore.toFixed(5) : "—"}</strong><p className="analysisSmall"></p></div>
            <div><span>Frame</span><strong>{latest === null ? "—" : "#" + latest.frameId}</strong><p className="analysisSmall">{latest === null ? "Start a worker run to receive data." : "Recorded " + new Date(latest.recordedAt).toLocaleString("en-ZA")}</p></div>
        </div>
        <p className="analysisSmall">These are saved results from synthetic readings. Model detection, threshold labels and linear forecasts answer different questions. Stale feed means these results are historical too.</p>
        <div className="forecastGrid">{forecastCards}</div>
        <p className="analysisSmall">Forecasts require 30 samples, an increasing trend, R^2 ≥ 0.7 and a crossing within 720 simulated hours. They estimate a demonstration threshold, not real bridge failure.</p>
    </section>;
}
