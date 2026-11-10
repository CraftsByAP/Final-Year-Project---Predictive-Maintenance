import "./loaders.css";

export function LoadingSpinner() {
    return <span className="infrasightSpinner" aria-hidden="true" />;
}

export function LoadingState({ label, hint, skeleton = false }: {
    label: string;
    hint?: string;
    skeleton?: boolean;
}) {
    const placeholders = [];
    if (skeleton) {
        for (let index = 0; index < 4; index++) {
            placeholders.push(
                <div className="readingPlaceholder" key={index}>
                    <span /><span /><span />
                </div>
            );
        }
    }
    return <div className="infrasightLoading" role="status" aria-live="polite">
        <div className="infrasightLoadingLabel"><LoadingSpinner /><strong>{label}</strong></div>
        {hint && <p>{hint}</p>}
        {skeleton && <div className="readingPlaceholders" aria-hidden="true">{placeholders}</div>}
    </div>;
}