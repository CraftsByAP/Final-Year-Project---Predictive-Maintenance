import { useEffect, useState, type FormEvent } from "react";
import { AuthLayout } from "./AuthLayout";
import { Dashboard } from "./Dashboard";
import { errorMessage, requestApi } from "./apiClient";
import type { Account } from "./types";
import "./index.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";

export function App() {
    const [screen, setScreen] = useState("loading");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [code, setCode] = useState("");
    const [codeId, setCodeId] = useState("");
    const [codeExpiresAt, setCodeExpiresAt] = useState(0);
    const [secondsRemaining, setSecondsRemaining] = useState(600);
    const [user, setUser] = useState<Account | null>(null);
    const [csrfToken, setCsrfToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    // Refreshing the page = restore a valid existing session.
    useEffect(function () {
        let cancelled = false;

        async function restoreSession() {
            try {
                const result = await requestApi("/api/auth/me");
                if (cancelled) {
                    return;
                }
                if (result.ok) {
                    setUser(result.data.user);
                    setCsrfToken(result.data.user.csrfToken);
                    setScreen("dashboard");
                } else if (result.status === 401) {
                    setScreen("password");
                } else {
                    setError(result.data.error || "The session could not be checked.");
                    setScreen("password");
                }
            } catch (error) {
                if (!cancelled) {
                    setError(errorMessage(error));
                    setScreen("password");
                }
            }
        }

        restoreSession();
        return function () {
            cancelled = true;
        };
    }, []);

    useEffect(function () {
        if (screen !== "otp") {
            return;
        }

        function updateCountdown() {
            const remaining = Math.ceil((codeExpiresAt - Date.now()) / 1000);
            setSecondsRemaining(Math.max(0, remaining));
        }

        updateCountdown();
        const timer = window.setInterval(updateCountdown, 1000);
        return function () {
            window.clearInterval(timer);
        };
    }, [screen, codeExpiresAt]);

    async function submitPassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");

        if (username.trim() === "" || password === "") {
            setError("Enter your username and password.");
            return;
        }

        setBusy(true);
        try {
            const result = await requestApi("/api/auth/login", "POST", {
                username: username.trim(),
                password: password
            });

            if (!result.ok) {
                throw new Error(result.data.error || "Sign-in could not be started.");
            }

            setCodeId(result.data.codeId);
            setPassword("");
            setCode("");
            setCodeExpiresAt(Date.now() + 10 * 60 * 1000);
            setSecondsRemaining(600);
            setScreen("otp");
        } catch (error) {
            setError(errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    async function submitCode(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");

        if (!/^\d{6}$/.test(code.trim())) {
            setError("Enter the six-digit code from your email.");
            return;
        }

        setBusy(true);
        try {
            const result = await requestApi("/api/auth/verify", "POST", {
                codeId: codeId,
                code: code.trim()
            });

            if (!result.ok) {
                throw new Error(result.data.error || "The code could not be verified.");
            }

            setUser(result.data.user);
            setCsrfToken(result.data.csrfToken);
            setCode("");
            setCodeId("");
            setScreen("dashboard");
        } catch (error) {
            setError(errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    function returnToLogin() {
        setUser(null);
        setCsrfToken("");
        setCode("");
        setCodeId("");
        setPassword("");
        setScreen("password");
    }

    function sessionExpired() {
        returnToLogin();
        setError("Your session has ended. Please sign in again.");
    }

    async function logout() {
        setBusy(true);
        setError("");
        try {
            const result = await requestApi("/api/auth/logout", "POST", {}, csrfToken);
            if (!result.ok) {
                throw new Error(result.data.error || "Sign-out failed. Please try again.");
            }
            returnToLogin();
        } catch (error) {
            setError(errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    if (screen === "dashboard" && user !== null) {
        return (
            <Dashboard
                user={user}
                onLogout={logout}
                onSessionExpired={sessionExpired}
                loggingOut={busy}
                accountError={error}
            />
        );
    }

    const minutes = Math.floor(secondsRemaining / 60);
    const seconds = String(secondsRemaining % 60).padStart(2, "0");

    return (
        <AuthLayout>
            {screen === "loading" ? (
                <div className="loadingState" role="status">
                    <span className="spinner" />
                    <h2>Checking your session</h2>
                    <p>Connecting to InfraSight…</p>
                </div>
            ) : (
                <>
                    <div className="accessBadge"><span className="smallDot" /> AUTHORISED STAFF ACCESS</div>
                    <div className="stepLabels" aria-label="Sign-in progress">
                        <span className={screen === "password" ? "currentStep" : "completedStep"}>01 · Password</span>
                        <span className="stepDivider" />
                        <span className={screen === "otp" ? "currentStep" : ""}>02 · Email code</span>
                    </div>

                    <h2>{screen === "otp" ? "Check your email" : "Welcome back."}</h2>
                    <p className="formIntro">
                        {screen === "otp"
                            ? "Enter the 6-digit code sent to the Email registered to this Account."
                            : "Sign in"}
                    </p>

                    {error !== "" && <div className="errorBanner" role="alert">{error}</div>}

                    {screen === "password" ? (
                        <form onSubmit={submitPassword}>
                            <label htmlFor="username">Username</label>
                            <input
                                id="username" name="username" type="text"
                                autoComplete="username" required maxLength={100}
                                placeholder="Your assigned username"
                                value={username} disabled={busy}
                                onChange={function (event) { setUsername(event.target.value); }}
                            />

                            <label htmlFor="password">Password</label>
                            <input
                                id="password" name="password" type="password"
                                autoComplete="current-password" required maxLength={128}
                                placeholder="Enter your password"
                                value={password} disabled={busy}
                                onChange={function (event) { setPassword(event.target.value); }}
                            />

                            <button className="primaryButton" type="submit" disabled={busy}>
                                {busy ? "Checking details & sending code…" : "Continue to email verification"}
                                {!busy && <span aria-hidden="true">↗</span>}
                            </button>
                            <p className="formNote">Need an account or help signing in? Contact your system administrator.</p>
                        </form>
                    ) : (
                        <form onSubmit={submitCode}>
                            <div className="accountContext">Signing in as <strong>{username}</strong></div>
                            <label htmlFor="code">Verification code</label>
                            <input
                                id="code" name="code" className="codeInput" type="text"
                                inputMode="numeric" autoComplete="one-time-code"
                                required minLength={6} maxLength={6} pattern="[0-9]{6}"
                                placeholder="000000" value={code}
                                disabled={busy || secondsRemaining === 0}
                                onChange={function (event) { setCode(event.target.value); }}
                            />

                            <p className="codeTimer" aria-live="off">
                                {secondsRemaining > 0 ? "Code expires in " + minutes + ":" + seconds : "Code expired. Start sign-in again for a fresh code."}
                            </p>

                            <button className="primaryButton" type="submit" disabled={busy || secondsRemaining === 0}>
                                {busy ? "Verifying…" : "Verify & open dashboard"}
                                {!busy && <span aria-hidden="true">↗</span>}
                            </button>
                            <button className="textButton" type="button" disabled={busy}
                                onClick={function () { setError(""); returnToLogin(); }}>
                                Back to sign in
                            </button>
                            <p className="formNote">Check your Junk folder .To request another code, sign in again.</p>
                        </form>
                    )}
                </>
            )}
        </AuthLayout>
    );
}

export default App;


