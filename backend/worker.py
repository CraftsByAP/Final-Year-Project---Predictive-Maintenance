import time
from collections import deque
from pathlib import Path
import joblib
from sensorSIm import SensorSimulation, SCENARIOS
from sensorFeatures import featureWindow, thresholdForecast
import json
import uuid
import os
from urllib.request import Request, urlopen
from dotenv import load_dotenv

def sendFrame(frameData, workerSecret):
    frameJson = json.dumps(
        frameData,
        allow_nan=False
    ).encode('utf-8')

    request = Request(
        'http://127.0.0.1:3000/api/frames',
        data=frameJson,
        headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + workerSecret
        },
        method='POST'
    )

    with urlopen(request, timeout=5) as response:
        responseText = response.read().decode('utf-8')

    return json.loads(responseText)
def main():
    envPath = Path(__file__).resolve().parent / '.env'
    load_dotenv(envPath)

    workerSecret = os.environ.get('WORKER_SECRET')

    if workerSecret is None or len(workerSecret) < 32:
        print('Configure WORKER_SECRET in backend/.env first.')
        return


    projectFolder = Path(__file__).resolve().parent.parent
    modelPath = projectFolder / 'models' / 'anomaly.joblib'

    if not modelPath.exists():
        print('The trained model file was not found.')
        print('Expected location:', modelPath)
        print('Run trainModel.py successfully first.')
        return

    # Loading the saved model and detection cutoff
    savedData = joblib.load(modelPath)
    model = savedData['model']
    cutoff = savedData['cutoff']

    print('Trained model loaded.')
    print('Detection cutoff:', cutoff)


    # Giving execution its own ID.
    runId = str(uuid.uuid4())

    metadataPath = projectFolder / 'models' / 'metadata.json'

    with open(metadataPath, 'r', encoding='utf-8') as metadataFile:
        metadata = json.load(metadataFile)

    modelVersion = metadata['version']

    bridgeProfiles = {
        'bridge1': {'seed': 300, 'span': 20.0},
        'bridge2': {'seed': 301, 'span': 34.0},
        'bridge3': {'seed': 302, 'span': 48.0}
    }

    print('\nAvailable bridges: bridge1, bridge2, bridge3')
    bridgeId = input('Enter a bridge ID: ').strip()
    if bridgeId not in bridgeProfiles:
        print('Unknown bridge. Choose bridge1, bridge2 or bridge3.')
        return
    bridgeProfile = bridgeProfiles[bridgeId]

    # simulation scenario...
    print('\nAvailable scenarios:')

    for scenarioName in SCENARIOS:
        print('-', scenarioName)

    scenario = input('\nEnter a scenario: ').strip()

    if scenario not in SCENARIOS:
        print('Unknown scenario. Use a name from the list above.')
        return
    simulation = SensorSimulation(seed=bridgeProfile['seed'], span=bridgeProfile['span'])
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
    # Fault demonstration: 30 normal frames for a baseline.
    warmupSteps = 0
    if scenario != 'normal':
        warmupSteps = 30
    totalSteps = 90 + warmupSteps

    print('\nStarting monitoring.')
    print('One step represents one simulated hour.')

    for step in range(1, totalSteps + 1):
        activeScenario = scenario
        scenarioStep = step
        if step <= warmupSteps:
            activeScenario = 'normal'
        else:
            scenarioStep = step - warmupSteps
        readings = simulation.values(scenarioStep, activeScenario)
        features = window.add(readings)

        modelScore = None
        isAnomaly = None
        frameForecasts = []

        print('\n------------------------------------------------------------------------------')
        print('Bridge:', bridgeId)
        print('Step:', step)
        print('Scenario:', activeScenario)
        print('Simulated hour:', step)

        # Analysing complete Frame after the window fills.
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

        # Processing 4 sensors
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

            # Adding forecast after calculation
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

        # sensors processed...saving Complete frame.
        frameData = {
            'runId': runId,
            'bridgeId': bridgeId,
            'step': step,
            'scenario': activeScenario,
            'readings': readings,
            'modelVersion': modelVersion,
            'modelScore': modelScore,
            'isAnomaly': isAnomaly,
            'forecasts': frameForecasts
        }

        try:
            result = sendFrame(frameData, workerSecret)
        except Exception as error:
            print('Could not confirm that the frame was saved:', error)
            print('Stopping monitoring. Check the Bun API.')
            break

        frameId = result['frameId']
        print('Saved through Bun API. Frame:', frameId)

        # Pausing after saving
        if step < totalSteps:
            time.sleep(intervalSeconds)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nMonitoring stopped...')