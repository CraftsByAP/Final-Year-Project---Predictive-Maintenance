import type { ReactNode } from "react";
//import { GradientBackdrop } from "./GradientBackdrop";

export function BridgeMark() {
    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M4 27H36M10 27V13M30 27V13M10 15C16 23 24 23 30 15M15 20V27M20 22V27M25 20V27" />
            <circle cx="10" cy="10" r="2" />
            <circle cx="30" cy="10" r="2" />
        </svg>
    );
}

export function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <main className="authPage">
            <section className="authStory" aria-label="About InfraSight">

                <a className="brand brandLight" href="/" aria-label="Home">
                    <span className="brandSymbol"><BridgeMark /></span>
                    <span>InfraSight<span className="brandCaption">BRIDGE MAINTENANCE</span></span>
                </a>

                <div className="storyContent">
                    <span className="eyebrow lightEyebrow">PREDICTIVE MAINTENANCE</span>
                    <h1>Predict Tomorrow,<br />Protect Today</h1>
                    <p>Bring bridge readings into focus and give your maintenance team the information it needs.</p>

                    <div className="bridgeDrawing">
                        <svg viewBox="0 0 620 225" fill="none" role="img" aria-label="Illustration of a bridge and sensor positions">
                            <path className="drawingGrid" d="M0 185H620M0 160H620M0 135H620M0 110H620M0 85H620M0 60H620M60 20V210M160 20V210M260 20V210M360 20V210M460 20V210M560 20V210" />
                            <path className="drawingGround" d="M5 192H615" />
                            <path className="drawingSupport" d="M112 125V190H139V125M480 125V190H507V125" />
                            <path className="drawingDeck" d="M25 112H595V126H25Z" />
                            <path className="drawingCable" d="M125 112V42M493 112V42M125 48C245 138 373 138 493 48M125 48L25 112M493 48L595 112" />
                            <path className="drawingHangers" d="M175 80V112M225 100V112M275 110V112M343 110V112M393 100V112M443 80V112" />
                            <circle className="sensorHalo" cx="310" cy="119" r="15" />
                            <circle className="sensorDot" cx="310" cy="119" r="4" />
                            <circle className="sensorDot" cx="125" cy="132" r="4" />
                            <circle className="sensorDot" cx="493" cy="132" r="4" />
                            <path className="drawingLabel" d="M310 138V164H382" />
                            <text x="389" y="168">SENSOR MONITORING</text>
                        </svg>
                        <div className="drawingCaption"><span className="smallDot" /> Simulation-based monitoring</div>
                    </div>

                    <div className="storyFeatures">
                        <span>Sensor readings</span>
                        <span>Trend visibility</span>
                        <span>Controlled access</span>
                    </div>
                </div>

                <p className="storyFoot">Information for authorised maintenance teams.</p>
            </section>

            <section className="authFormSide">
                <div className="authCard">{children}</div>
                <p className="authFoot">Accounts are issued by your system administrator.</p>
            </section>
        </main>
    );
}
