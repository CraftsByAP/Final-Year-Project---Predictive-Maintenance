import math

class TrafficSimulation:
    def __init__(self, span):
        self.span = span

    def positions(self, seconds):
        routeLength = self.span + 16
        return [(seconds * 2.0) % routeLength - 8, (seconds * 1.5 + routeLength / 2) % routeLength - 8]

    def stationReadings(self, seconds, station, overloaded=False):
        positions = self.positions(seconds)
        mass = 1500.0
        if overloaded:
            mass = 14000.0
        weightedForce = 0.0
        totalMass = 0.0
        for x in positions:
            if 0 <= x <= self.span:
                totalMass += mass
                influence = 4 * x * (self.span - x) / self.span ** 2
                weightedForce += mass * 9.81 * influence
        E = 30e9
        # Chosen Sim section property
        I = 0.05 * (self.span / 20.0) ** 3
        centreDeflection = weightedForce * self.span ** 3 / (48 * E * I) * 1000
        stationFraction = station / 4
        shape = 4 * stationFraction * (1 - stationFraction)
        deflection = 0.3 + centreDeflection * shape
        crackWidth = 0.08 + max(0, deflection - 4) * 0.018
        strain = 180 + deflection * 45
        thermal = 4 + math.sin(seconds / 20)
        values = [round(deflection, 5), round(crackWidth, 5), round(strain, 5), round(thermal, 5)]
        return values, totalMass