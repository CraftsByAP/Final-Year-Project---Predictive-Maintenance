import time
from collections import deque
from pathlib import Path
import joblib
from sensorSIm import SensorSimulation, SCENARIOS
from sensorFeatures import featureWindow, thresholdForecast
import json
import uuid
from db import createDatabase, saveFrame


def main():
    # Find the model saved by trainModel.py.
    projectFolder = Path(__file__).resolve().parent.parent
    modelPath = projectFolder / 'models' / 'anomaly.joblib'

    if not modelPath.exists():
        print('The trained model file was not found.')
        print('Expected location:', modelPath)
        print('Run trainModel.py successfully first.')
        return

    # Load the saved model and detection cutoff
    savedData = joblib.load(modelPath)
    model = savedData['model']
    cutoff = savedData['cutoff']

    print('Trained model loaded.')
    print('Detection cutoff:', cutoff)

    createDatabase()

    # Give this execution its own ID.
    runId = str(uuid.uuid4())

    metadataPath = projectFolder / 'models' / 'metadata.json'

    with open(metadataPath, 'r', encoding='utf-8') as metadataFile:
        metadata = json.load(metadataFile)

    modelVersion = metadata['version']

    # Let the user choose the simulation scenario.
    print('\nAvailable scenarios:')

    for scenarioName in SCENARIOS:
        print('-', scenarioName)

    scenario = input('\nEnter a scenario: ').strip()

    if scenario not in SCENARIOS:
        print('Unknown scenario. Use a name from the list above.')
        return
    simulation = SensorSimulation(seed=300, span=20.0)
    window = featureWindow()

    sensorNames = [
        'Deflection',
        'Crack width',
        'Strain',
        'Thermal difference'
    ]

    sensorUnits = [
        'mm',
        'mm',
        'microstrain',
        'degrees Celsius'
    ]

    # Demonstration limits, in the same order as the readings.
    warningLimits = [8.0, 0.2, 600.0, 10.0]
    criticalLimits = [10.0, 0.3, 800.0, 15.0]

    # Each sensor has its own rolling reading history.
    sampleHistory = []

    for sensorIndex in range(4):
        sensorHistory = deque(maxlen=30)
        sampleHistory.append(sensorHistory)

    intervalSeconds = 2
    totalSteps = 90

    print('\nStarting monitoring.')
    print('One step represents one simulated hour.')

    for step in range(1, totalSteps + 1):
        readings = simulation.values(step, scenario)
        features = window.add(readings)

        modelScore = None
        isAnomaly = None
        frameForecasts = []

        print('\n----------------------------------------')
        print('Step:', step)
        print('Scenario:', scenario)
        print('Simulated hour:', step)

        # Analyse the complete frame after the window fills.
        if features is None:
            print('Model warming up:', step, '/ 30')
        else:
            scores = model.decision_function([features])
            modelScore = float(scores[0])

            if modelScore < cutoff:
                isAnomaly = True
                print('Model result: Anomaly detected')
            else:
                isAnomaly = False
                print('Model result: Within trained pattern')

            print('Model score:', round(modelScore, 5))

        # Process all four sensors.
        for sensorIndex in range(4):
            sensorName = sensorNames[sensorIndex]
            sensorUnit = sensorUnits[sensorIndex]
            reading = readings[sensorIndex]

            warning = warningLimits[sensorIndex]
            critical = criticalLimits[sensorIndex]

            sample = (step, reading)
            sampleHistory[sensorIndex].append(sample)

            magnitude = abs(reading)

            if magnitude >= critical:
                status = 'Critical'
            elif magnitude >= warning:
                status = 'Warning'
            else:
                status = 'Within Range'

            print(
                sensorName,
                ':',
                round(reading, 3),
                sensorUnit,
                '|',
                status
            )

            forecast = thresholdForecast(
                sampleHistory[sensorIndex],
                reading,
                critical
            )

            # Add the forecast AFTER calculating it.
            frameForecasts.append(forecast)

            if forecast['Availability'] == 'Available':
                hours = forecast['Hours To Threshold']

                print(
                    '  Forecast:',
                    hours,
                    'simulated hours to critical threshold'
                )
            else:
                print(
                    '  Forecast unavailable:',
                    forecast['Reason']
                )

        # All four sensors are processed. Save the complete frame.
        frameId = saveFrame(
            runId=runId,
            step=step,
            scenario=scenario,
            readings=readings,
            modelVersion=modelVersion,
            modelScore=modelScore,
            isAnomaly=isAnomaly,
            forecasts=frameForecasts
        )

        print('Saved frame:', frameId)

        if step < totalSteps:
            time.sleep(intervalSeconds)

    print('\nMonitoring complete.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nMonitoring stopped...')