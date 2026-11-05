import { AccountsPanel } from "./AccountsPanel";
import { ReportsPanel } from "./ReportsPanel";
import { BackupsPanel } from "./BackupsPanel";
import { MaintenancePanel } from "./MaintenancePanel";
import { useEffect, useRef, useState } from "react";
import { AnalysisPanel } from "./AnalysisPanel";
import { SensorChart } from "./SensorChart";
import "./monitoring.css";
import { BridgeMark } from "./AuthLayout";
import { errorMessage, requestApi } from "./apiClient";
import { roleLabel, can, type Account, type Reading } from "./types";

type DashboardProps = {
    user: Account;
    onLogout: () => Promise<void>;
    onSessionExpired: () => void;
    loggingOut: boolean;
    accountError: string;
};

const sensorDefinitions = [
    { name: "deflection", label: "Deflection", unit: "mm", warning: 8, critical: 10 },
    { name: "crackWidth", label: "Crack width", unit: "mm", warning: 0.2, critical: 0.3 },
    { name: "strain", label: "Strain", unit: "microstrain", warning: 600, critical: 800 },
    { name: "thermal", label: "Thermal difference", unit: "°C", warning: 10, critical: 15 }
];

function readableDate(value: string) {
    return new Date(value).toLocaleString("en-ZA");
}

function scenarioLabel(scenario: string) {
    if (scenario === "crackWidth") return "Crack growth";
    if (scenario === "strainSpike") return "Strain spike";
    if (scenario === "normal") return "Normal";
    if (scenario === "combined") return "Combined";
    if (scenario === "deflection") return "Deflection";
    if (scenario === "thermal") return "Thermal";
    if (scenario === "recovery") return "Recovery";
    return scenario;
}

function sensorLabel(sensorName: string) {
    for (const sensor of sensorDefinitions) {
        if (sensor.name === sensorName) {
            return sensor.label;
        }
    }
    return sensorName;
}

export function Dashboard(props: DashboardProps) {
    const [bridgeId, setBridgeId] = useState("bridge1");
    // A new key resets cached readings before showing a different bridge.
    return <DashboardView key={bridgeId} {...props} bridgeId={bridgeId} onBridgeChange={setBridgeId} />;
}

type BridgeProps = DashboardProps & {
    bridgeId: string;
    onBridgeChange: (bridgeId: string) => void;
};

function DashboardView(props: BridgeProps) {
    const { user, onLogout, onSessionExpired, loggingOut, accountError, bridgeId, onBridgeChange } = props;
    const bridgeNumber = bridgeId.slice(-1);
    const [activeTab, setActiveTab] = useState("overview");
    const [readings, setReadings] = useState<Reading[]>([]);
    const [selectedSensor, setSelectedSensor] = useState("all");
    const [readingsError, setReadingsError] = useState("");
    const [refreshing, setRefreshing] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [connectionOk, setConnectionOk] = useState(false);
    const [lastChecked, setLastChecked] = useState("");
    const [now, setNow] = useState(Date.now());
    const refreshInProgress = useRef(false);

    async function refreshReadings() {
        if (!can(user, "readings.view")) return;
        if (refreshInProgress.current) {
            return;
        }

        refreshInProgress.current = true;
        setRefreshing(true);

        try {
            const result = await requestApi("/api/readings?bridgeId=" + encodeURIComponent(bridgeId) + "&limit=60");
            if (result.status === 401) {
                onSessionExpired();
                return;
            }
            if (!result.ok) {
                throw new Error(result.data.error || "Readings could not be loaded.");
            }
            if (!Array.isArray(result.data.readings)) {
                throw new Error("The readings response has an unexpected format.");
            }

            setReadings(result.data.readings);
            setConnectionOk(true);
            setReadingsError("");
            setLastChecked(new Date().toISOString());
        } catch (error) {
            setConnectionOk(false);
            setReadingsError(errorMessage(error));
        } finally {
            setHasLoaded(true);
            setRefreshing(false);
            refreshInProgress.current = false;
        }
    }

    useEffect(function () {
        refreshReadings();
        const timer = window.setInterval(function () {
            setNow(Date.now());
            refreshReadings();
        }, 2000);

        return function () {
            window.clearInterval(timer);
        };
    }, [user.userId]);

    // Results are ordered oldest first by the API.
    let latestReading: Reading | null = null;
    if (readings.length > 0) {
        latestReading = readings[readings.length - 1];
    }

    let feedLabel = "Waiting for readings";
    let feedClass = "neutral";
    if (!hasLoaded) {
        feedLabel = "Loading readings";
    } else if (!connectionOk) {
        feedLabel = "API disconnected";
        feedClass = "critical";
    } else if (latestReading !== null) {
        const readingAge = now - Date.parse(latestReading.recordedAt);
        if (readingAge >= 0 && readingAge <= 10000) {
            feedLabel = "Live feed";
            feedClass = "good";
        } else {
            feedLabel = "Stored data · Feed stale";
            feedClass = "warning";
        }
    }

    const frameIds = new Set<number>();
    for (const reading of readings) {
        frameIds.add(reading.frameId);
    }

    // Ordinary loops build the elements that React will display.
    const sensorCards = [];
    for (const sensor of sensorDefinitions) {
        let latestSensorReading: Reading | null = null;

        for (const reading of readings) {
            if (reading.sensorName === sensor.name) {
                latestSensorReading = reading;
            }
        }

        let status = "No reading";
        let statusClass = "neutral";
        if (latestSensorReading !== null) {
            const magnitude = Math.abs(latestSensorReading.value);
            if (magnitude >= sensor.critical) {
                status = "Critical Range";
                statusClass = "critical";
            } else if (magnitude >= sensor.warning) {
                status = "Warning Range";
                statusClass = "warning";
            } else {
                status = "Within Range";
                statusClass = "good";
            }
        }

        sensorCards.push(
            <article className="sensorCard" key={sensor.name}>
                <div className="sensorTop"><h3>{sensor.label}</h3><span className={"statusDot " + statusClass} /></div>
                <p className="sensorValue">
                    {latestSensorReading === null ? "—" : latestSensorReading.value.toFixed(3)}
                    <span>{sensor.unit}</span>
                </p>
                <span className={"statusPill " + statusClass}>{status}</span>
                <p className="sensorLimits">Warning {sensor.warning} · Critical {sensor.critical}</p>
            </article>
        );
    }

    const sensorCharts = [];
    for (const sensor of sensorDefinitions) {
        sensorCharts.push(<SensorChart key={sensor.name} readings={readings} sensor={sensor} bridgeId={bridgeId} />);
    }

    const matchingRows = [];
    for (const reading of readings) {
        if (selectedSensor === "all" || reading.sensorName === selectedSensor) {
            matchingRows.push(reading);
        }
    }

    const visibleRows = matchingRows.slice(-20);
    const readingRows = [];
    for (const reading of visibleRows) {
        readingRows.push(
            <tr key={reading.frameId + ":" + reading.sensorName}>
                <td className="frameCell">#{reading.frameId}</td>
                <td>{sensorLabel(reading.sensorName)}</td>
                <td className="numberCell">{reading.value.toFixed(3)} <span>{reading.unit}</span></td>
                <td><span className="scenarioTag">{scenarioLabel(reading.scenario)}</span></td>
                <td>{readableDate(reading.recordedAt)}</td>
                <td className="numberCell">{reading.simulatedHour}</td>
            </tr>
        );
    }

    const sensorOptions = [];
    for (const sensor of sensorDefinitions) {
        sensorOptions.push(<option key={sensor.name} value={sensor.name}>{sensor.label}</option>);
    }

    return (
        <div className="dashboardPage">
            <aside className="sidebar">
                <a className="brand brandLight" href="/" aria-label="InfraSight Home">
                    <span className="brandSymbol"><BridgeMark /></span>
                    <span>InfraSight<span className="brandCaption">BRIDGE MAINTENANCE</span></span>
                </a>
                <p className="navCaption">WORKSPACE</p>
                <nav aria-label="Main navigation">
                    <button className={activeTab === "overview" ? "navActive" : ""} aria-current={activeTab === "overview" ? "page" : undefined}
                        onClick={function () { setActiveTab("overview"); }}><span>01</span>Overview</button>
                    <button className={activeTab === "history" ? "navActive" : ""} aria-current={activeTab === "history" ? "page" : undefined}
                        onClick={function () { setActiveTab("history"); }}><span>02</span>Saved readings</button>
                    {(can(user, "maintenance.own") || can(user, "maintenance.manage")) && <button className={activeTab === "maintenance" ? "navActive" : ""} onClick={function () { setActiveTab("maintenance"); }}><span>03</span>Maintenance</button>}
                    {can(user, "reports.view") && <button className={activeTab === "reports" ? "navActive" : ""} onClick={function () { setActiveTab("reports"); }}><span>04</span>Reports</button>}
                    {can(user, "backups.manage") && <button className={activeTab === "backups" ? "navActive" : ""} onClick={function () { setActiveTab("backups"); }}><span>05</span>Backups</button>}
                    {(can(user, "accounts.manage") || can(user, "roles.manage")) && <button className={activeTab === "accounts" ? "navActive" : ""} aria-current={activeTab === "accounts" ? "page" : undefined}
                        onClick={function () { setActiveTab("accounts"); }}><span>06</span>Accounts</button>}
                </nav>
                <div className="sidebarBottom">
                    <span className="sidebarAvatar">{user.username.slice(0, 1).toUpperCase()}</span>
                    <div><strong>{user.username}</strong><span>{roleLabel(user.role)}</span></div>
                </div>
            </aside>

            <main className="dashboardMain">
                <header className="dashboardHeader">
                    <div><span className="eyebrow">MONITORING WORKSPACE</span><h1>{activeTab === "reports" ? "Reports" : activeTab === "backups" ? "Database backups" : activeTab === "maintenance" ? "Maintenance tasks" : activeTab === "accounts" ? "Team accounts" : activeTab === "history" ? "Saved readings" : "Bridge overview"}</h1></div>
                    <div className="headerActions"><span className={"statusPill " + feedClass}><span className="smallDot" />{feedLabel}</span><button className="secondaryButton" onClick={onLogout} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button></div>
                </header>

                <div className="simulationNotice"><span className="noticeIcon">i</span><p><strong>Simulation Environment.</strong> </p></div>
                {accountError !== "" && <div className="errorBanner" role="alert">{accountError}</div>}

                {activeTab === "reports" ? <ReportsPanel onSessionExpired={onSessionExpired} /> : activeTab === "backups" ? <BackupsPanel onSessionExpired={onSessionExpired} /> : activeTab === "maintenance" ? <MaintenancePanel user={user} onSessionExpired={onSessionExpired} /> : activeTab === "accounts" ? <AccountsPanel user={user} onSessionExpired={onSessionExpired} /> : !can(user, "readings.view") ? <p className="emptyState">This Role Cannot View Bridge Readings.</p> : (
                    <>
                        <section className="bridgeHeading"><div><span className="bridgeTag">BRIDGE 0{bridgeNumber}</span><h2>Bridge {bridgeNumber} <span>Demonstration profile</span></h2><p>{latestReading === null ? "No sensor frame received yet." : "Last frame recorded " + readableDate(latestReading.recordedAt)}</p></div><div className="bridgeControls"><label htmlFor="bridgeChoice">Bridge</label><select id="bridgeChoice" value={bridgeId} onChange={function (event) { onBridgeChange(event.target.value); }}><option value="bridge1">Bridge 1 : 20 m </option><option value="bridge2">Bridge 2 : 34 m </option><option value="bridge3">Bridge 3 : 48 m </option></select><button className="secondaryButton" onClick={refreshReadings} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh data"}</button></div></section>
                        {readingsError !== "" && <div className="errorBanner" role="alert">{readingsError} Existing values, if shown, are cached readings.</div>}

                        {activeTab === "overview" && <>
                            <section className="summaryStrip" aria-label="Monitoring summary">
                                <div><span>Bridge profile</span><strong>0{bridgeNumber}</strong></div>
                                <div><span>Frames in view</span><strong>{frameIds.size.toString().padStart(2, "0")}</strong></div>
                                <div><span>Sensor channels</span><strong>04</strong></div>
                                <div><span>Latest scenario</span><strong className="scenarioSummary">{latestReading === null ? "Waiting" : scenarioLabel(latestReading.scenario)}</strong></div>
                            </section>
                            <div className="sectionLabel"><h2>Latest sensor readings</h2><span>Values at the last recorded frame</span></div>
                            <section className="sensorGrid" aria-label="Sensor readings">{sensorCards}</section>
                            <div className="sectionLabel"><h2>Sensor trends</h2><span>Latest run only : up to 60 stored frames</span></div>
                            <section className="trendGrid" aria-label="Sensor trend graphs">{sensorCharts}</section>
                            <AnalysisPanel readings={readings} />
                        </>}

                        <section className="dataPanel">
                            <div className="panelHeading"><div><h2>Recorded observations</h2><p>Latest 60 stored frames : Showing {visibleRows.length} of {matchingRows.length} matching readings</p></div><div className="sensorFilter"><label htmlFor="sensorFilter">Sensor</label><select id="sensorFilter" value={selectedSensor} onChange={function (event) { setSelectedSensor(event.target.value); }}><option value="all">All sensors</option>{sensorOptions}</select></div></div>
                            {!hasLoaded ? <p className="emptyState" role="status">Loading stored readings…</p> : readingRows.length === 0 ? <p className="emptyState">No readings found. Start the Python worker to submit sensor frames.</p> : <div className="tableScroll"><table><thead><tr><th>Frame</th><th>Sensor</th><th>Reading</th><th>Scenario</th><th>Recorded time</th><th>Simulated hour</th></tr></thead><tbody>{readingRows}</tbody></table></div>}
                            <div className="tableFoot"><span>Times are shown in your browser's local timezone.</span><span>{lastChecked === "" ? "Waiting for API" : "API checked " + new Date(lastChecked).toLocaleTimeString("en-ZA")}</span></div>
                        </section>
                    </>
                )}
                <footer className="dashboardFoot"><span>||~INFRASIGHT~||</span><span>Authorised access · {roleLabel(user.role)}</span></footer>
            </main>
        </div>
    );
}
