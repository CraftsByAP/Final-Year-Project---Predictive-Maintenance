from sensorSIm import SensorSimulation

def main():
    simulation = SensorSimulation(seed=42, span=20.0)

    print("Bridge Sensor Simulation: Crack Width ")
    print("Step || Deflection (mm) || Crack (mm) || Strain (microstrain) || Thermal difference (degrees Celsius)")

    for step in range(1, 31):
        readings = simulation.values(step, scenario="crackWidth")
        deflection, crack, strain, thermal = readings

        print(
            f"{step:>4} | "
            f"{deflection:>.3f} | "
            f"{crack:>.3f} | "
            f"{strain:>.3f} | "
            f"{thermal:>.3f}"
        )


if __name__ == "__main__":
    main()