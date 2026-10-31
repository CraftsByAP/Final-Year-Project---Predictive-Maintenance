import { useEffect, useRef, useState } from "react";
import { BridgeMark } from "./AuthLayout";
import { errorMessage, requestApi } from "./apiClient";
import { roleLabel, type Account, type Reading, type UserRow } from "./types";

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
    const { user, onLogout, onSessionExpired, loggingOut, accountError } = props;
    const [activeTab, setActiveTab] = useState("overview");
    const [readings, setReadings] = useState<Reading[]>([]);
    const [users, setUsers] = useState<UserRow[]>([]);
    const [selectedSensor, setSelectedSensor] = useState("all");
    const [readingsError, setReadingsError] = useState("");
    const [usersError, setUsersError] = useState("");
    const [refreshing, setRefreshing] = useState(false);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [connectionOk, setConnectionOk] = useState(false);
    const [lastChecked, setLastChecked] = useState("");
    const [now, setNow] = useState(Date.now());
    const refreshInProgress = useRef(false);

    async function refreshReadings() {
        if (refreshInProgress.current) {
            return;
        }

        refreshInProgress.current = true;
        setRefreshing(true);

        try {
            const result = await requestApi("/api/readings?bridgeId=bridge1&limit=60");
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

    async function openAccounts() {
        if (user.role !== "superAdmin") {
            return;
        }

        setActiveTab("accounts");
        setLoadingUsers(true);
        setUsersError("");

        try {
            const result = await requestApi("/api/admin/users");
            if (result.status === 401) {
                onSessionExpired();
                return;
            }
            if (!result.ok) {
                throw new Error(result.data.error || "Accounts could not be loaded.");
            }
            setUsers(result.data.users);
        } catch (error) {
            setUsersError(errorMessage(error));
        } finally {
            setLoadingUsers(false);
        }
    }

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
                status = "Critical demo range";
                statusClass = "critical";
            } else if (magnitude >= sensor.warning) {
                status = "Warning demo range";
                statusClass = "warning";
            } else {
                status = "Within demo range";
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

    const accountRows = [];
    for (const account of users) {
        accountRows.push(
            <tr key={account.userId}>
                <td><strong>{account.username}</strong></td>
                <td>{roleLabel(account.role)}</td>
                <td>{account.email || "Not assigned"}</td>
                <td><span className={"statusPill " + (account.isActive === 1 ? "good" : "neutral")}>{account.isActive === 1 ? "Active" : "Inactive"}</span></td>
            </tr>
        );
    }

    return (
        <div className="dashboardPage">
            <aside className="sidebar">
                <a className="brand brandLight" href="/" aria-label="PMSB home">
                    <span className="brandSymbol"><BridgeMark /></span>
                    <span>PMSB<span className="brandCaption">BRIDGE MAINTENANCE</span></span>
                </a>
                <p className="navCaption">WORKSPACE</p>
                <nav aria-label="Main navigation">
                    <button className={activeTab === "overview" ? "navActive" : ""} aria-current={activeTab === "overview" ? "page" : undefined}
                        onClick={function () { setActiveTab("overview"); }}><span>01</span>Overview</button>
                    <button className={activeTab === "history" ? "navActive" : ""} aria-current={activeTab === "history" ? "page" : undefined}
                        onClick={function () { setActiveTab("history"); }}><span>02</span>Saved readings</button>
                    {user.role === "superAdmin" && <button className={activeTab === "accounts" ? "navActive" : ""} aria-current={activeTab === "accounts" ? "page" : undefined}
                        onClick={openAccounts}><span>03</span>Accounts</button>}
                </nav>
                <div className="sidebarBottom">
                    <span className="sidebarAvatar">{user.username.slice(0, 1).toUpperCase()}</span>
                    <div><strong>{user.username}</strong><span>{roleLabel(user.role)}</span></div>
                </div>
            </aside>

            <main className="dashboardMain">
                <header className="dashboardHeader">
                    <div><span className="eyebrow">MONITORING WORKSPACE</span><h1>{activeTab === "accounts" ? "Team accounts" : activeTab === "history" ? "Saved readings" : "Bridge overview"}</h1></div>
                    <div className="headerActions"><span className={"statusPill " + feedClass}><span className="smallDot" />{feedLabel}</span><button className="secondaryButton" onClick={onLogout} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button></div>
                </header>

                <div className="simulationNotice"><span className="noticeIcon">i</span><p><strong>Simulation environment.</strong> Readings are synthetic and limits are demonstration values. One step represents one simulated hour.</p></div>
                {accountError !== "" && <div className="errorBanner" role="alert">{accountError}</div>}

                {activeTab === "accounts" ? (
                    <section className="dataPanel">
                        <div className="panelHeading"><div><h2>Authorised accounts</h2><p>Account roles and registered email addresses.</p></div><span className="statusPill neutral">Super admin only</span></div>
                        {usersError !== "" && <div className="panelError" role="alert">{usersError}</div>}
                        {loadingUsers ? <p className="emptyState" role="status">Loading accounts…</p> : accountRows.length === 0 ? <p className="emptyState">No accounts to display.</p> : <div className="tableScroll"><table><thead><tr><th>Username</th><th>Role</th><th>Registered email</th><th>Status</th></tr></thead><tbody>{accountRows}</tbody></table></div>}
                    </section>
                ) : (
                    <>
                        <section className="bridgeHeading"><div><span className="bridgeTag">BRIDGE 01</span><h2>Bridge 1 <span>Demonstration profile</span></h2><p>{latestReading === null ? "No sensor frame received yet." : "Last frame recorded " + readableDate(latestReading.recordedAt)}</p></div><button className="secondaryButton" onClick={refreshReadings} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh data"}</button></section>
                        {readingsError !== "" && <div className="errorBanner" role="alert">{readingsError} Existing values, if shown, are cached readings.</div>}

                        {activeTab === "overview" && <>
                            <section className="summaryStrip" aria-label="Monitoring summary">
                                <div><span>Bridge profile</span><strong>01</strong></div>
                                <div><span>Frames in view</span><strong>{frameIds.size.toString().padStart(2, "0")}</strong></div>
                                <div><span>Sensor channels</span><strong>04</strong></div>
                                <div><span>Latest scenario</span><strong className="scenarioSummary">{latestReading === null ? "Waiting" : scenarioLabel(latestReading.scenario)}</strong></div>
                            </section>
                            <div className="sectionLabel"><h2>Latest sensor readings</h2><span>Values at the last recorded frame</span></div>
                            <section className="sensorGrid" aria-label="Sensor readings">{sensorCards}</section>
                        </>}

                        <section className="dataPanel">
                            <div className="panelHeading"><div><h2>Recorded observations</h2><p>Latest 60 stored frames · Showing {visibleRows.length} of {matchingRows.length} matching readings</p></div><div className="sensorFilter"><label htmlFor="sensorFilter">Sensor</label><select id="sensorFilter" value={selectedSensor} onChange={function (event) { setSelectedSensor(event.target.value); }}><option value="all">All sensors</option>{sensorOptions}</select></div></div>
                            {!hasLoaded ? <p className="emptyState" role="status">Loading stored readings…</p> : readingRows.length === 0 ? <p className="emptyState">No readings found. Start the Python worker to submit sensor frames.</p> : <div className="tableScroll"><table><thead><tr><th>Frame</th><th>Sensor</th><th>Reading</th><th>Scenario</th><th>Recorded time</th><th>Simulated hour</th></tr></thead><tbody>{readingRows}</tbody></table></div>}
                            <div className="tableFoot"><span>Times are shown in your browser's local timezone.</span><span>{lastChecked === "" ? "Waiting for API" : "API checked " + new Date(lastChecked).toLocaleTimeString("en-ZA")}</span></div>
                        </section>
                    </>
                )}
                <footer className="dashboardFoot"><span>PMSB · Predictive bridge maintenance</span><span>Authorised access · {roleLabel(user.role)}</span></footer>
            </main>
        </div>
    );
}
