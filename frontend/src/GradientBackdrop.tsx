import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

// Request Deco Library only when Animation is allowed.
const MovingGradient = lazy(function () { return import("./MovingGradient"); });

class GradientBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    render() {
        if (this.state.failed) return null;
        return this.props.children;
    }
}

export function GradientBackdrop() {
    const [allowAnimation, setAllowAnimation] = useState(false);

    useEffect(function () {
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        function updatePreference() { setAllowAnimation(!preference.matches); }
        updatePreference();
        preference.addEventListener("change", updatePreference);
        return function () { preference.removeEventListener("change", updatePreference); };
    }, []);

    return (
        <div className="gradientBackdrop" aria-hidden="true">
            {allowAnimation && <GradientBoundary><Suspense fallback={null}><MovingGradient /></Suspense></GradientBoundary>}
        </div>
    );
}
