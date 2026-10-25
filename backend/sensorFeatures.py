from collections import deque
from sensorSIm import SCALES

WINDOW = 30
FEATURES = ['deflectionRatio ', 'crackRatio' , 'strainRatio' , 'tempRatio'
            'meanDeflection','meanCrack','meanStrain','meanTemp']

class featureWindow:
    def __init__(self):
        self.rows = deque(maxlen=WINDOW)

    def add(self, values):
        ratios = [abs(v)/s for v, s in zip(values, SCALES)]
        self.rows.append(ratios)
        if len(self.rows) < WINDOW:
            return None
        means = [sum(row[i] for row in self.rows) / WINDOW for i in range(4)]
        return ratios + means

def thresholdForecast(samples, current, critical):
    if len(samples) < WINDOW:
        return {'Availability': 'Unavailable', 'Reason': 'Need 30 valid frames'}
    # Keep only the most recent WINDOW samples.
    rows = list(samples)[-WINDOW:]
    # Separate each sample into time and reading magnitude.
    xs = []
    ys = []
    for sample in rows:
        time = float(sample[0])
        reading = abs(float(sample[1]))
        xs.append(time)
        ys.append(reading)

    # Calculate the average time and average reading.
    aveTime = sum(xs) / len(xs)
    aveReading = sum(ys) / len(ys)
    # Measure how much the times vary around their average.
    timeVar = 0.0

    for time in xs:
        difference = time - aveTime
        timeVar += difference ** 2

    if timeVar == 0:
        return {'Availability': 'Unavailable','Reason': 'No simulated time span'}

    # Calculate the slope: change in reading per simulated hour.
    slope = 0.0

    for index in range(len(xs)):
        timeDiff = xs[index] - aveTime
        reading_difference = ys[index] - aveReading

        slope += timeDiff * reading_difference

    slope = slope / timeVar

    # Measure the variation in the actual readings.
    totalVar = 0.0

    for reading in ys:
        difference = reading - aveReading
        totalVar += difference ** 2

    # Compare actual readings with the fitted straight line.
    residualError = 0.0

    for index in range(len(xs)):
        timeDiff = xs[index] - aveTime

        predReading = (
            aveReading + slope * timeDiff
        )

        error = ys[index] - predReading
        residualError += error ** 2

    # R^2, keeping the result between 0 and 1.
    if totalVar == 0:
        fit = 0.0
    else:
        fit = 1 - (residualError / totalVar)

        if fit < 0:
            fit = 0.0
        elif fit > 1:
            fit = 1.0

    if slope <= 0.00000001:
        return {'Availability': 'Unavailable','Reason': 'No increasing trend'}

    if fit < 0.7:
        return {'Availability': 'Unavailable','Reason': 'Trend fit below R-squared 0.7'}

    # Estimate time remaining before reaching the critical threshold.
    hours = (critical - abs(current)) / slope
    if hours < 0:
        hours = 0.0
    if hours > 720:
        return {'Availability': 'Unavailable','Reason': 'Beyond 720 simulated hour horizon'}

    return {
        'Availability': 'Available',
        'Hours To Threshold': round(hours, 4),
        'fitScore': round(fit, 5)
    }