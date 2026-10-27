import argparse
import hashlib
import json
from pathlib import Path
import joblib
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest
from sensorFeatures import featureWindow, FEATURES
from sensorSIm import SensorSimulation

def dataset(seeds, scenarios, prefix):
    X = []
    y = []
    runIds = []
    scenarioLabels = []

    for seed in seeds:
        for scenario in scenarios:
            runId = f'{prefix}-{seed}-{scenario}'

            sim = SensorSimulation(seed, 20 + seed % 3 * 14)
            window = featureWindow()

            for step in range(90):
                values = sim.values(step, scenario)
                features = window.add(values)

                if features is not None:
                    X.append(features)

                    if scenario in ('normal', 'recovery'):
                        y.append(0)
                    else:
                        y.append(1)

                    runIds.append(runId)
                    scenarioLabels.append(scenario)

    return (
        np.array(X),
        np.array(y, dtype=int),
        runIds,
        scenarioLabels
    )


def metrics(y, pred):
    if len(y) != len(pred):
        raise ValueError(
            'Actual and predicted labels must have equal lengths'
        )

    tp = 0
    fp = 0
    tn = 0
    fn = 0

    for index in range(len(y)):
        actual = y[index]
        predicted = pred[index]

        if actual == 1 and predicted == 1:
            tp += 1
        elif actual == 0 and predicted == 1:
            fp += 1
        elif actual == 0 and predicted == 0:
            tn += 1
        elif actual == 1 and predicted == 0:
            fn += 1

    if tp + fn > 0:
        recall = tp / (tp + fn)
    else:
        recall = None

    if fp + tn > 0:
        falsePositiveRate = fp / (fp + tn)
    else:
        falsePositiveRate = None

    if tp + fp > 0:
        precision = tp / (tp + fp)
    else:
        precision = None

    if 2 * tp + fp + fn > 0:
        f1 = (2 * tp) / (2 * tp + fp + fn)
    else:
        f1 = None

    return {
        'True Positive': tp,
        'False Positive': fp,
        'True Negative': tn,
        'False Negative': fn,
        'Recall': recall,
        'False Positive Rate': falsePositiveRate,
        'Precision': precision,
        'F1 Score': f1,
        'Samples': len(y)
    }


def classifyScores(scores, cutoff):
    # 1 = anomaly, 0 = normal.
    predictions = []

    for score in scores:
        if score < cutoff:
            predictions.append(1)
        else:
            predictions.append(0)

    return np.array(predictions, dtype=int)


def train(out):
    out.mkdir(parents=True, exist_ok=True)
    print('Saving model files to:', out.resolve())

    scenarios = [
        'normal',
        'deflection',
        'crackWidth',
        'strainSpike',
        'thermal',
        'combined'
    ]

    trainSeeds = range(40)
    validationSeeds = range(100, 108)
    testSeeds = range(200, 212)

    trainX, _, trainIds, _ = dataset(
        trainSeeds, ['normal'], 'train'
    )

    validationX, validationY, validationIds, _ = dataset(
        validationSeeds, scenarios, 'validation'
    )

    testX, testY, testIds, testKinds = dataset(
        testSeeds, scenarios, 'test'
    )

    print('Training data shape:', trainX.shape)
    print('Validation data shape:', validationX.shape)
    print('Testing data shape:', testX.shape)

    for data in (trainX, validationX, testX):
        if data.ndim != 2 or data.shape[0] == 0:
            raise ValueError(
                'Expected a non-empty table of sensor features. '
                'Check dataset() and featureWindow.add().'
            )

        if data.shape[1] != len(FEATURES):
            raise ValueError(
                'Feature count does not match the FEATURES list'
            )

    # Check that no seed appears in more than one group.
    if set(trainSeeds).intersection(validationSeeds):
        raise ValueError('Training and validation seeds overlap')

    if set(trainSeeds).intersection(testSeeds):
        raise ValueError('Training and testing seeds overlap')

    if set(validationSeeds).intersection(testSeeds):
        raise ValueError('Validation and testing seeds overlap')

    model = IsolationForest(
        n_estimators=120,
        contamination=0.02,
        random_state=42,
        n_jobs=1
    )

    print('Training the model...')
    model.fit(trainX)

    validationScores = model.decision_function(validationX)

    cutoffOptions = [-0.04, -0.02, 0.0, 0.02, 0.04]
    cutoff = 0.0
    bestRecall = -1.0
    bestFalsePositiveRate = float('inf')
    candidateFound = False

    for candidateCutoff in cutoffOptions:
        predictions = classifyScores(
            validationScores, candidateCutoff
        )

        results = metrics(validationY, predictions)

        recall = results['Recall']
        falsePositiveRate = results['False Positive Rate']

        if recall is None or falsePositiveRate is None:
            continue

        if falsePositiveRate <= 0.20:
            betterRecall = recall > bestRecall

            sameRecallLowerFalsePositiveRate = (
                recall == bestRecall
                and falsePositiveRate < bestFalsePositiveRate
            )

            if betterRecall or sameRecallLowerFalsePositiveRate:
                cutoff = candidateCutoff
                bestRecall = recall
                bestFalsePositiveRate = falsePositiveRate
                candidateFound = True

    if not candidateFound:
        print(
            'No candidate met the validation false-positive limit. '
            'Using cutoff 0.0.'
        )

    print('Selected cutoff:', cutoff)

    validationPredictions = classifyScores(
        validationScores, cutoff
    )

    validationResults = metrics(
        validationY, validationPredictions
    )

    testScores = model.decision_function(testX)
    testPredictions = classifyScores(testScores, cutoff)
    testResults = metrics(testY, testPredictions)

    # Collect separate results for each test scenario.
    byScenario = {}

    for scenario in scenarios:
        actualLabels = []
        predictedLabels = []

        for index in range(len(testKinds)):
            if testKinds[index] == scenario:
                actualLabels.append(testY[index])
                predictedLabels.append(testPredictions[index])

        byScenario[scenario] = metrics(
            actualLabels, predictedLabels
        )

    warningRatios = [0.8, 2 / 3, 0.75, 2 / 3]
    rulePredictions = []

    for features in testX:
        rulePrediction = 0

        for sensorIndex in range(4):
            if features[sensorIndex] >= warningRatios[sensorIndex]:
                rulePrediction = 1
                break

        rulePredictions.append(rulePrediction)

    ruleResults = metrics(testY, rulePredictions)


    targetsMet = False

    if testResults['Recall'] is not None:
        if testResults['False Positive Rate'] is not None:
            targetsMet = (
                testResults['Recall'] >= 0.80
                and testResults['False Positive Rate'] <= 0.20
            )

    # Saving trained model
    payload = {
        'model': model,
        'cutoff': cutoff
    }

    modelPath = out / 'anomaly.joblib'
    joblib.dump(payload, modelPath)

    checksum = hashlib.sha256(
        modelPath.read_bytes()
    ).hexdigest()

    meta = {
        'version': 'isolation-forest-demo-v1-' + checksum[:12],
        'algorithm': 'IsolationForest',
        'features': FEATURES,
        'window': 30,
        'seed': 42,
        'cutoff': cutoff,
        'sklearnVersion': sklearn.__version__,
        'numpyVersion': np.__version__,
        'sha256': checksum,
        'training': (
            '40 normal runs; validation and test use '
            'distinct seeds and runs'
        ),
        'scoreConvention': (
            'decision_function; anomaly if rawScore < cutoff'
        ),
        'generatorVersion': 'demo-d1-v1',
        'datasetCounts': {
            'train': len(trainX),
            'validation': len(validationX),
            'test': len(testX)
        }
    }

    report = {
        'notice': (
            'Evaluation uses synthetic bridge sensor scenarios. '
            'Results do not establish accuracy on physical bridges.'
        ),
        'test': testResults,
        'validation': validationResults,
        'byScenario': byScenario,
        'ruleBaseline': ruleResults,
        'trainRunIds': sorted(set(trainIds)),
        'validationRunIds': sorted(set(validationIds)),
        'testRunIds': sorted(set(testIds)),
        'targets': {
            'recall': 0.80,
            'falsePositiveRate': 0.20
        },
        'modelVersion': meta['version'],
        'targetsMet': targetsMet
    }

    metadataPath = out / 'metadata.json'
    metadataPath.write_text(
        json.dumps(meta, indent=2),
        encoding='utf-8'
    )

    evaluationPath = out / 'evaluation.json'
    evaluationPath.write_text(
        json.dumps(report, indent=2),
        encoding='utf-8'
    )

    summary = {
        'model': meta['version'],
        'test': testResults,
        'targetsMet': targetsMet
    }

    print(json.dumps(summary, indent=2))
    print('Training and evaluation complete.')

    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()

    parser.add_argument(
        '--out',
        type=Path,
        default=Path(__file__).resolve().parent.parent / 'models'
    )

    args = parser.parse_args()
    train(args.out)