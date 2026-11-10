import math
import random
from datetime import datetime, timezone, timedelta

CRITERIA= ('deflection', 'crack', 'strain', 'temp')
SCALES = (10., .3, 800., 15.)
SCENARIOS = ('normal', 'deflection', 'crackWidth', 'strainSpike', 'thermal', 'combined', 'recovery')


#Global time zone (South Africa = UTC+2)
def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

class SensorSimulation:
    def __init__(self, seed=42, span=20.):
        self.rng = random.Random(seed)
        self.span = span

    def values(self, step, scenario='normal'):
        if scenario not in SCENARIOS:
            raise ValueError('Unknown scenario')
        #Calculations for deflection
        E = 30e9
        I = 150000 * self.span**3 / (48 * E * .0035)
        P = 150000 * (1 + .12 * math.sin(step / 5)) + self.rng.gauss(0, 10000)
        d = P * self.span**3 / (48 * E * I) * 1000 + self.rng.gauss(0, .10)
        c = max(0, .085 + .014 * math.sin(step / 11) + self.rng.gauss(0, .009))
        s = 230 + 30 * math.sin(step / 5) + self.rng.gauss(0, 18)
        t = 4 + 1.3 * math.sin(step / 12) + self.rng.gauss(0, .35)
        if scenario in ('deflection', 'combined'):
            d += max(0, step - 3) * .33
        if scenario in ('crackWidth', 'combined'):
            c += max(0, step - 3) * .009
        if scenario == 'strainSpike':
            s += 620 if step % 18 >= 4 else 0
        if scenario in ('thermal', 'combined'):
            t += max(0, step - 3) * .55
        return [round(x, 5) for x in (d, c, s, t)]

def frame(runId, bridge, sequence, values, scenario, simHours):
    units = {s['kind']: s['unit'] for s in bridge['sensors']}
    sensors = {s['kind']: s['id'] for s in bridge['sensors']}
    simulated = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(hours=simHours)
    return {
        'frameId': f'{runId}:{bridge["id"]}:{sequence}', 'runId': runId,
        'bridgeId': bridge['id'], 'sequence': sequence, 'recordedAt': utcnow(),
        'simulatedAt': simulated.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'scenario': scenario,
        'readings': [{'sensorId': sensors[k], 'unit': units[k], 'value': v} for k, v in zip(CRITERIA, values)],
    }