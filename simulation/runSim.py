import argparse
import csv
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from collections import deque
from networkModel import SensorNetwork
from trafficModel import TrafficSimulation


'''THis code is an attempt at getting the Sim to connect...I honestly just want it to work'''

def setPoses(world, poses):
    parts = []
    for name, x, y, z in poses:
        parts.append('pose { name: "' + name + '" position { x: ' + str(x) + ' y: ' + str(y) + ' z: ' + str(z) + ' } orientation { w: 1 } }')
    result = subprocess.run(['gz', 'service', '-s', '/world/' + world + '/set_pose_vector', '--reqtype', 'gz.msgs.Pose_V', '--reptype', 'gz.msgs.Boolean', '--timeout', '5000', '--req', ' '.join(parts)], capture_output=True, text=True, timeout=7)
    if result.returncode != 0 or 'true' not in result.stdout:
        raise RuntimeError('Gazebo Failed...' + result.stderr.strip())


def main():
    parser = argparse.ArgumentParser(description='2 InfraSight Simulations- sensor connection and traffic movement')
    parser.add_argument('--sim', choices=['network', 'traffic'], required=True)
    parser.add_argument('--bridge', choices=['bridge1', 'bridge2', 'bridge3'], default='bridge1')
    parser.add_argument('--topology', choices=['direct', 'relay'], default='relay')
    parser.add_argument('--range', type=float, default=14.0, dest='radioRange')
    parser.add_argument('--loss', type=float, default=0.0)
    parser.add_argument('--delay-ms', type=float, default=100.0)
    parser.add_argument('--deadline-ms', type=float, default=500.0)
    parser.add_argument('--disable-node', type=int, choices=[0, 1, 2, 3], default=0)
    parser.add_argument('--failure-start', type=int, default=35)
    parser.add_argument('--failure-end', type=int, default=50)
    parser.add_argument('--scenario', choices=['normal', 'overload'], default='normal')
    parser.add_argument('--samples', type=int, default=90)
    parser.add_argument('--send', action='store_true', help='Sending frames to existing API')
    parser.add_argument('--no-gazebo', action='store_true', help='Run model/log checks only')
    args = parser.parse_args()
    if not all(math.isfinite(value)
               for value in [args.radioRange, args.loss, args.delay_ms, args.deadline_ms]):
        parser.error('Numeric settings must be finite.')
    if args.radioRange <= 0 or not 0 <= args.loss <= 1 or args.delay_ms < 0 or args.deadline_ms < 0 or not 1 <= args.samples <= 10000 or args.failure_start < 1 or args.failure_end < args.failure_start:
        parser.error('Check range, probability, timing and sample limits.')
    if args.send and args.no_gazebo:
        parser.error('Model-only checks.')

    span = {'bridge1': 20.0, 'bridge2': 34.0, 'bridge3': 48.0}[args.bridge]
    network = SensorNetwork(span, args.radioRange, args.topology, loss=args.loss, delayMs=args.delay_ms, deadlineMs=args.deadline_ms)
    traffic = TrafficSimulation(span)
    runId = str(uuid.uuid4())
    model = None
    if args.send:
        projectFolder = Path(__file__).resolve().parent.parent
        sys.path.insert(0, str(projectFolder / 'backend'))
        import joblib
        from dotenv import load_dotenv
        from sensorFeatures import featureWindow, thresholdForecast
        from worker import sendFrame
        load_dotenv(projectFolder / 'backend' / '.env')
        secret = os.environ.get('WORKER_SECRET', '')

        if len(secret) < 32:
            raise RuntimeError('Configure WORKER_SECRET first.')
        saved = joblib.load(projectFolder / 'models' / 'anomaly.joblib')
        model = saved['model']
        cutoff = saved['cutoff']
        version = json.loads((projectFolder / 'models' / 'metadata.json').read_text())['version']
        window = featureWindow()
        histories = [deque(maxlen=30), deque(maxlen=30), deque(maxlen=30), deque(maxlen=30)]

    logFolder = Path(__file__).resolve().parent / 'logs'
    logFolder.mkdir(exist_ok=True)
    logPath = logFolder / (args.sim + '-' + runId + '.csv')
    print('World:', 'infrasight_' + args.bridge, '| Sim:', args.sim, '| span:', span)
    print('Logs:', logPath)
    print('One sample every 2 wall-clock seconds; API step = one illustrative simulated hour.')
    print('No physical radio, damage, or bridge failure validation is claimed.')
    deliveredCount = 0
    attemptedCount = 0
    start = time.monotonic()
    with logPath.open('w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['sample', 'station', 'path', 'delivered', 'delayMs', 'reason', 'totalMassKg', 'deflectionMm', 'crackMm', 'microstrain', 'thermalC'])
        for step in range(1, args.samples + 1):
            seconds = (step - 1) * 2.0
            overloaded = args.sim == 'traffic' and args.scenario == 'overload' and step > 30
            disabled = 0
            if args.sim == 'network' and args.failure_start <= step <= args.failure_end:
                disabled = args.disable_node
            reports = []
            results = []
            for station in range(1, 4):
                values, mass = traffic.stationReadings(seconds, station, overloaded)
                if args.sim == 'network':
                    result = network.transmit(station, disabled)
                else:
                    result = {'delivered': True, 'path': [station, 0], 'delayMs': 0, 'reason': 'Ideal direct transport in traffic sim'}
                attemptedCount += 1
                if result['delivered']:
                    deliveredCount += 1
                    reports.append(values)
                results.append(result)
                writer.writerow([step, station, '>'.join(str(node) for node in result['path']), result['delivered'], result['delayMs'], result['reason'], mass] + values)
                print('Sample', step, '| S' + str(station), result['path'], result['reason'], '| delay ms:', result['delayMs'])
            file.flush()
            # Animate route segments at two updates per second, in one Gazebo request.
            for tick in range(4):
                poses = []
                positions = traffic.positions(seconds + tick * 0.5)
                for index, x in enumerate(positions):
                    poses.append(('car' + str(index + 1), x, -1 if index == 0 else 1, 2.65))
                for station in range(1, 4):
                    path = results[station - 1]['path']
                    x = span * station / 4
                    z = -3.0
                    if args.sim == 'network' and len(path) > 1:
                        progress = (tick / 3) * (len(path) - 1)
                        hop = min(int(progress), len(path) - 2)
                        fraction = progress - hop
                        x = network.positions[path[hop]] * (1 - fraction) + network.positions[path[hop + 1]] * fraction
                        z = 3.0
                    poses.append(('packet' + str(station), x, 3.1, z))
                if not args.no_gazebo:
                    setPoses('infrasight_' + args.bridge, poses)
                due = start + (step - 1) * 2 + (tick + 1) * 0.5
                if not args.no_gazebo:
                    time.sleep(max(0, due - time.monotonic()))
            if args.send:
                if len(reports) != 3:
                    print('Incomplete station set: no API frame; clearing analysis history.')
                    window = featureWindow()
                    for history in histories:
                        history.clear()
                    continue
                readings = []
                forecasts = []
                critical = [10, 0.3, 800, 15]
                for index in range(4):
                    reading = reports[0][index]
                    for report in reports:
                        if report[index] > reading:
                            reading = report[index]
                    readings.append(reading)
                    histories[index].append((step, reading))
                    forecasts.append(thresholdForecast(histories[index], reading, critical[index]))
                features = window.add(readings)
                score = None
                anomaly = None
                if features is not None:
                    score = float(model.decision_function([features])[0])
                    anomaly = bool(score < cutoff)
                # Existing schema has a fixed scenario whitelist. Keep a truthful basic
                # label and distinguish this source via the run ID and separate logs.
                scenario = 'combined' if overloaded else 'normal'
                frame = {'runId': 'gazebo-' + args.sim + '-' + runId, 'bridgeId': args.bridge, 'step': step, 'scenario': scenario, 'readings': readings, 'modelVersion': version, 'modelScore': score, 'isAnomaly': anomaly, 'forecasts': forecasts}
                result = sendFrame(frame, secret)
                print('API saved frame:', result['frameId'])
        print('Delivery:', deliveredCount, '/', attemptedCount, '=', round(100 * deliveredCount / attemptedCount, 2), '%')
        print('Finished. Individual node readings and delivery evidence:', logPath)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nSim stopped. Existing logs and saved frames are retained.')
    except Exception as error:
        print('Sim stopped:', error)
        sys.exit(1)