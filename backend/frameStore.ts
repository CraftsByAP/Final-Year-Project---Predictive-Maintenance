import { bridgeIds } from "../shared/validation";
import { Database } from "bun:sqlite";

export function validateFrame(frame: any): string | null {
    if (
        frame === null ||
        typeof frame !== "object" ||
        Array.isArray(frame)
    ) {
        return "Frame must be a JSON object";
    }

    if (
        typeof frame.runId !== "string" ||
        frame.runId.trim() === "" ||
        frame.runId.length > 100
    ) {
        return "runId must have 1 - 100 Characters";
    }

    if (!bridgeIds.includes(frame.bridgeId)) {
        return "Choose bridge1, bridge2 or bridge3";
    }

    if (
        !Number.isInteger(frame.step) ||
        frame.step < 1 ||
        frame.step > 1000000000
    ) {
        return "Step must be a Positive Whole number ";
    }

    const scenarios = [
        "normal",
        "deflection",
        "crackWidth",
        "strainSpike",
        "thermal",
        "combined",
        "recovery"
    ];

    if (!scenarios.includes(frame.scenario)) {
        return "Unknown simulation scenario";
    }

    if (
        !Array.isArray(frame.readings) ||
        frame.readings.length !== 4
    ) {
        return "A frame needs exactly four sensor readings";
    }

    for (const reading of frame.readings) {
        if (
            typeof reading !== "number" ||
            !Number.isFinite(reading) ||
            Math.abs(reading) > 1000000
        ) {
            return "Readings must be finite numbers within the demo range";
        }
    }

    if (frame.readings[1] < 0) {
        return "Crack width cannot be negative";
    }

    if (
        typeof frame.modelVersion !== "string" ||
        frame.modelVersion.trim() === "" ||
        frame.modelVersion.length > 200
    ) {
        return "A model version is required";
    }

    if (frame.modelScore === null) {
        if (frame.isAnomaly !== null) {
            return "Warm-up frames must have a null anomaly result";
        }
    } else {
        if (
            typeof frame.modelScore !== "number" ||
            !Number.isFinite(frame.modelScore)
        ) {
            return "modelScore must be a finite number or null";
        }

        if (typeof frame.isAnomaly !== "boolean") {
            return "Analysed frames need a Boolean anomaly result";
        }
    }

    if (
        !Array.isArray(frame.forecasts) ||
        frame.forecasts.length !== 4
    ) {
        return "A frame needs exactly four forecast results";
    }

    for (const forecast of frame.forecasts) {
        if (
            forecast === null ||
            typeof forecast !== "object" ||
            Array.isArray(forecast)
        ) {
            return "Each forecast must be an object";
        }

        if (forecast.Availability === "Available") {
            const hours = forecast["Hours To Threshold"];

            if (
                typeof hours !== "number" ||
                !Number.isFinite(hours) ||
                hours < 0 ||
                hours > 720
            ) {
                return "Forecast hours must be between 0 and 720";
            }

            const fit = forecast.fitScore;

            if (
                typeof fit !== "number" ||
                !Number.isFinite(fit) ||
                fit < 0 ||
                fit > 1
            ) {
                return "Forecast fitScore must be between 0 and 1";
            }
        } else if (forecast.Availability === "Unavailable") {
            if (
                typeof forecast.Reason !== "string" ||
                forecast.Reason.trim() === "" ||
                forecast.Reason.length > 500
            ) {
                return "Unavailable forecasts need a reason of 1 to 500 characters";
            }
        } else {
            return "Forecast Availability must be Available or Unavailable";
        }
    }

    return null;
}


export function saveFrame(database: Database, frame: any): number {
    const sensorNames = [
        "deflection",
        "crackWidth",
        "strain",
        "thermal"
    ];

    const sensorUnits = [
        "mm",
        "mm",
        "microstrain",
        "degrees Celsius"
    ];

    // Save everything together, or undo everything if an insert fails.
    const saveTransaction = database.transaction(function () {
        const result = database.query(`
            INSERT INTO frames (
                runId, bridgeId, step, scenario,
                recordedAt, simulatedHour
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            frame.runId,
            frame.bridgeId,
            frame.step,
            frame.scenario,
            new Date().toISOString(),
            frame.step
        );

        const frameId = Number(result.lastInsertRowid);

        let availability = "warmingUp";
        let anomalyValue: number | null = null;

        if (frame.modelScore !== null) {
            availability = "available";

            if (frame.isAnomaly) {
                anomalyValue = 1;
            } else {
                anomalyValue = 0;
            }
        }

        database.query(`
            INSERT INTO predictions (
                frameId, modelVersion, modelScore,
                isAnomaly, availability
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            frameId,
            frame.modelVersion,
            frame.modelScore,
            anomalyValue,
            availability
        );

        for (let sensorIndex = 0; sensorIndex < 4; sensorIndex++) {
            const readingResult = database.query(`
                INSERT INTO readings (
                    frameId, sensorName, value, unit
                )
                VALUES (?, ?, ?, ?)
            `).run(
                frameId,
                sensorNames[sensorIndex],
                frame.readings[sensorIndex],
                sensorUnits[sensorIndex]
            );

            const readingId = Number(readingResult.lastInsertRowid);
            const forecast = frame.forecasts[sensorIndex];

            let hoursToThreshold: number | null = null;
            let fitScore: number | null = null;
            let reason: string | null = null;

            if (forecast.Availability === "Available") {
                hoursToThreshold = forecast["Hours To Threshold"];
                fitScore = forecast.fitScore;
            } else {
                reason = forecast.Reason;
            }

            database.query(`
                INSERT INTO forecasts (
                    readingId, availability,
                    hoursToThreshold, fitScore, reason
                )
                VALUES (?, ?, ?, ?, ?)
            `).run(
                readingId,
                forecast.Availability,
                hoursToThreshold,
                fitScore,
                reason
            );
        }

        return frameId;
    });

    return saveTransaction();
}