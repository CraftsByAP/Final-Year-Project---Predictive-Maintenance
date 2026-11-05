import type { Reading } from "./types";
import { getSensorSamples } from "./chartData";

type SensorDefinition = { name: string; label: string; unit: string; warning: number; critical: number };
type ChartProps = { readings: Reading[]; sensor: SensorDefinition; bridgeId: string };

export function SensorChart({ readings, sensor, bridgeId }: ChartProps) {
    const samples = getSensorSamples(readings, sensor.name, bridgeId);
    const width = 560;
    const height = 235;
    const left = 64;
    const right = 18;
    const top = 24;
    const bottom = 43;
    let minimum = 0;
    let maximum = sensor.critical;
    for (const sample of samples) {
        minimum = Math.min(minimum, sample.value);
        maximum = Math.max(maximum, sample.value);
    }
    const padding = (maximum - minimum) * 0.12;
    maximum += padding;
    if (minimum < 0) minimum -= padding;

    function yPosition(value: number) {
        return top + (maximum - value) / (maximum - minimum) * (height - top - bottom);
    }

    let firstHour = 0;
    let lastHour = 1;
    if (samples.length > 0) {
        firstHour = samples[0].simulatedHour;
        lastHour = samples[samples.length - 1].simulatedHour;
    }
    function xPosition(hour: number) {
        if (lastHour === firstHour) return left;
        return left + (hour - firstHour) / (lastHour - firstHour) * (width - left - right);
    }

    let points = "";
    for (const sample of samples) {
        points += xPosition(sample.simulatedHour) + "," + yPosition(sample.value) + " ";
    }

    const ticks = [];
    for (let index = 0; index <= 4; index++) {
        const value = minimum + (maximum - minimum) * index / 4;
        const y = yPosition(value);
        ticks.push(<g key={index}><line className="chartGridLine" x1={left} x2={width - right} y1={y} y2={y} /><text className="chartTick" x={left - 9} y={y + 4} textAnchor="end">{Number(value.toPrecision(3))}</text></g>);
    }
    let latestValue = "No readings yet";
    if (samples.length > 0) latestValue = samples[samples.length - 1].value.toFixed(3) + " " + sensor.unit;

    return <article className="trendCard">
        <div className="trendHeading"><h3>{sensor.label}</h3><span>{latestValue}</span></div>
        {samples.length === 0 ? <p className="chartEmpty">No readings for this bridge. Run the worker for {bridgeId}.</p> : <>
            <svg className="sensorChart" viewBox={"0 0 " + width + " " + height} role="img" aria-label={sensor.label + " for " + bridgeId + ": " + samples.length + " samples; latest " + latestValue + ". Horizontal axis: simulated hours. Vertical axis: " + sensor.unit + ". Values also available in the readings table."}>
                {ticks}
                <line className="chartWarning" x1={left} x2={width - right} y1={yPosition(sensor.warning)} y2={yPosition(sensor.warning)} />
                <line className="chartCritical" x1={left} x2={width - right} y1={yPosition(sensor.critical)} y2={yPosition(sensor.critical)} />
                <polyline className="chartReading" points={points.trim()} />
                <circle className="chartEnd" cx={xPosition(lastHour)} cy={yPosition(samples[samples.length - 1].value)} r="4" />
                <text className="chartTick" x={left} y={height - 22}>{firstHour}</text>
                {lastHour !== firstHour && <text className="chartTick" x={width - right} y={height - 22} textAnchor="end">{lastHour}</text>}
                <text className="chartAxisLabel" x={width / 2} y={height - 4} textAnchor="middle">Simulated hour · {sensor.unit} on vertical axis</text>
            </svg>
            <p className="chartLegend"><span>● Reading</span><span>– – Warning {sensor.warning}</span><span>··· Critical {sensor.critical}</span></p>
            <p className="chartNote">{samples.length} samples from latest run. Independent vertical scale; threshold lines are Limits.</p>
        </>}
    </article>;
}
