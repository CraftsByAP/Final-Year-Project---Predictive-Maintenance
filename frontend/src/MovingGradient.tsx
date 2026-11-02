import { ShaderGradientCanvas, ShaderGradient } from "@shadergradient/react";

export default function MovingGradient() {
    return (
        <ShaderGradientCanvas style={{ position: "absolute", inset: 0 }} pixelDensity={1}>
            <ShaderGradient
                control="props"
                type="plane"
                animate="on"
                color1="#241436"
                color2="#9B7ED6"
                color3="#E4FF3B"
                uSpeed={0.12}
                uStrength={2}
                uFrequency={3}
                cDistance={4}
                cPolarAngle={90}
                brightness={0.8}
                grain="off"
                lightType="3d"
            />
        </ShaderGradientCanvas>
    );
}
