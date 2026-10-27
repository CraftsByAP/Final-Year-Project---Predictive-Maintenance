import sqlite3
from datetime import datetime, timezone
from pathlib import Path


# Storing the DB folder separately
projectFolder = Path(__file__).resolve().parent.parent
dataFolder = projectFolder / 'data'
databasePath = dataFolder / 'PMSB.db'

def openDatabase():
    dataFolder.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(databasePath)
# To be abel to query by column..
    connection.row_factory = sqlite3.Row
#Enforcing links between tables
    connection.execute('PRAGMA foreign_keys = ON')
    return connection

def createDatabase():
    connection = openDatabase()
    try:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS frames (
                frameId INTEGER PRIMARY KEY AUTOINCREMENT,
                runId TEXT NOT NULL,
                bridgeId TEXT NOT NULL,
                step INTEGER NOT NULL,
                scenario TEXT NOT NULL,
                recordedAt TEXT NOT NULL,
                simulatedHour REAL NOT NULL,

                UNIQUE(runId, bridgeId, step)
            );

            CREATE TABLE IF NOT EXISTS readings (
                readingId INTEGER PRIMARY KEY AUTOINCREMENT,
                frameId INTEGER NOT NULL,
                sensorName TEXT NOT NULL,
                value REAL NOT NULL,
                unit TEXT NOT NULL,

                FOREIGN KEY(frameId)
                    REFERENCES frames(frameId),

                UNIQUE(frameId, sensorName)
            );

            CREATE TABLE IF NOT EXISTS predictions (
                predictionId INTEGER PRIMARY KEY AUTOINCREMENT,
                frameId INTEGER NOT NULL UNIQUE,
                modelVersion TEXT,
                modelScore REAL,
                isAnomaly INTEGER,
                availability TEXT NOT NULL,

                FOREIGN KEY(frameId)
                    REFERENCES frames(frameId)
            );

            CREATE TABLE IF NOT EXISTS forecasts (
                forecastId INTEGER PRIMARY KEY AUTOINCREMENT,
                readingId INTEGER NOT NULL UNIQUE,
                availability TEXT NOT NULL,
                hoursToThreshold REAL,
                fitScore REAL,
                reason TEXT,

                FOREIGN KEY(readingId)
                    REFERENCES readings(readingId)
            );
        """)

        connection.commit()

    finally:
        connection.close()


def saveFrame(
    runId,
    step,
    scenario,
    readings,
    modelVersion=None,
    modelScore=None,
    isAnomaly=None,
    forecasts=None,
    bridgeId='bridge1'
):
    sensorNames = [
        'deflection',
        'crackWidth',
        'strain',
        'thermal'
    ]
    sensorUnits = [
        'mm',
        'mm',
        'microstrain',
        'degrees Celsius'
    ]

    if len(readings) != 4:
        raise ValueError('Error: Frame must have 4 Sensor readings')

    if forecasts is not None:
        if len(forecasts) != 4:
            raise ValueError('Error: Expected one forecast per sensor')

    if modelScore is None and isAnomaly is not None:
        raise ValueError('Error: An anomaly result needs a model score')

    if modelScore is not None and isAnomaly is None:
        raise ValueError('A model score needs an anomaly result')

    recordedAt = datetime.now(timezone.utc).isoformat()
    simulatedHour = float(step)
    connection = openDatabase()

    try:
        cursor = connection.cursor()

        # Save Frame with 4 readings
        cursor.execute("""
            INSERT INTO frames (
                runId,
                bridgeId,
                step,
                scenario,
                recordedAt,
                simulatedHour
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            runId,
            bridgeId,
            step,
            scenario,
            recordedAt,
            simulatedHour
        ))
        frameId = cursor.lastrowid

# SQLite stores Boolean results as 1 or 0.
        if modelScore is None:
            availability = 'warmingUp'
            anomalyValue = None
        else:
            availability = 'available'

            if isAnomaly:
                anomalyValue = 1
            else:
                anomalyValue = 0

        cursor.execute("""
            INSERT INTO predictions (
                frameId,
                modelVersion,
                modelScore,
                isAnomaly,
                availability
            )
            VALUES (?, ?, ?, ?, ?)
        """, (
            frameId,
            modelVersion,
            modelScore,
            anomalyValue,
            availability
        ))
# Save each sensor reading
        for sensorIndex in range(4):
            cursor.execute("""
                INSERT INTO readings (
                    frameId,
                    sensorName,
                    value,
                    unit
                )
                VALUES (?, ?, ?, ?)
            """, (
                frameId,
                sensorNames[sensorIndex],
                float(readings[sensorIndex]),
                sensorUnits[sensorIndex]
            ))

            readingId = cursor.lastrowid

            forecastAvailability = 'Unavailable'
            hoursToThreshold = None
            fitScore = None
            reason = 'No forecast supplied'

            if forecasts is not None:
                forecast = forecasts[sensorIndex]

                # Match your thresholdForecast dictionary keys.
                forecastAvailability = forecast['Availability']

                if forecastAvailability == 'Available':
                    hoursToThreshold = forecast['Hours To Threshold']
                    fitScore = forecast['fitScore']
                    reason = None
                else:
                    reason = forecast['Reason']

            cursor.execute("""
                INSERT INTO forecasts (
                    readingId,
                    availability,
                    hoursToThreshold,
                    fitScore,
                    reason
                )
                VALUES (?, ?, ?, ?, ?)
            """, (
                readingId,
                forecastAvailability,
                hoursToThreshold,
                fitScore,
                reason
            ))

        connection.commit()
        return frameId

    except Exception:
#If any failure occurs , do not save frame
        connection.rollback()
        raise

    finally:
        connection.close()


def getRecentReadings(bridgeId='bridge1', limit=60):
    if limit < 1 or limit > 1000:
        raise ValueError('Error: Limit must be between 1 and 1000')

    connection = openDatabase()

    try:
        # Select recent frames, then fetch their four readings.
        cursor = connection.execute("""
            SELECT
                frames.frameId,
                frames.runId,
                frames.bridgeId,
                frames.step,
                frames.scenario,
                frames.recordedAt,
                frames.simulatedHour,
                readings.sensorName,
                readings.value,
                readings.unit
            FROM frames
            JOIN readings
                ON readings.frameId = frames.frameId
            WHERE frames.frameId IN (
                SELECT frameId
                FROM frames
                WHERE bridgeId = ?
                ORDER BY frameId DESC
                LIMIT ?
            )
            ORDER BY frames.frameId ASC, readings.readingId ASC
        """, (bridgeId, limit))

        results = []

        for row in cursor:
            results.append(dict(row))

        return results

    finally:
        connection.close()


if __name__ == '__main__':
    createDatabase()
    print('Database ready.')
    print('Saved at:', databasePath)