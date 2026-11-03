from db import openDatabase, getRecentReadings


def main():
    connection = openDatabase()

    try:
        tableNames = [
            'frames',
            'readings',
            'predictions',
            'forecasts'
        ]

        for tableName in tableNames:
            # Table names come only from the fixed list above.
            query = 'SELECT COUNT(*) FROM ' + tableName
            result = connection.execute(query).fetchone()

            print(tableName, ':', result[0])

    finally:
        connection.close()

    print('\nReadings from the latest three frames:')

    readings = getRecentReadings(limit=3)

    for reading in readings:
        print(
            'Frame:', reading['frameId'],
            '| Sensor:', reading['sensorName'],
            '| Value:', reading['value'],
            reading['unit']
        )


if __name__ == '__main__':
    main()