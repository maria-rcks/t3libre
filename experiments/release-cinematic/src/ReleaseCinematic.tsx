import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { AppMock, LayerTransforms } from "./AppMock";
import { mixColor, mixPalette, NEXT, OLD } from "./palette";

export const TOTAL_FRAMES = 520;

// Timeline (30fps):
//   0– 70  intro title
//  55–200  the old UI (previous latest), slow camera push
// 200–330  3D break-apart: layers float, recolor, glass turns on, sidebar morphs
// 330–460  the new UI (dark theme + Sidebar V2), slow drift
// 455–520  outro
const ez = Easing.bezier(0.33, 0, 0.15, 1);

const Label: React.FC<{
  title: string;
  sub: string;
  color: string;
  subColor: string;
  accent: string;
  opacity: number;
  y: number;
}> = ({ title, sub, color, subColor, accent, opacity, y }) => (
  <div
    style={{
      position: "absolute",
      left: 90,
      bottom: 64,
      opacity,
      transform: `translateY(${y}px)`,
      fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 34, height: 3, borderRadius: 2, background: accent }} />
      <div style={{ fontSize: 40, fontWeight: 800, color, letterSpacing: -0.5 }}>{title}</div>
    </div>
    <div style={{ fontSize: 19, color: subColor, marginTop: 8, marginLeft: 46 }}>{sub}</div>
  </div>
);

export const ReleaseCinematic: React.FC = () => {
  const frame = useCurrentFrame();

  // ---- phase progress values -------------------------------------------
  const intro = interpolate(frame, [0, 12, 52, 68], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const appIn = interpolate(frame, [58, 92], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ez,
  });
  // 0..1 across the whole break-apart transition
  const t = interpolate(frame, [200, 330], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ez,
  });
  // layers fly apart then come back: 0 → 1 → 0 (peak mid-transition)
  const burst = Math.sin(Math.PI * t) ** 1.2;
  // colors/glass/sidebar swap slightly after the layers lift off
  const swap = interpolate(t, [0.25, 0.72], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  });
  const outro = interpolate(frame, [452, 470, 508, 520], [0, 1, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const appOut = interpolate(frame, [448, 486], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ez,
  });

  const p = mixPalette(swap);

  // ---- camera ------------------------------------------------------------
  const driftOld = interpolate(frame, [58, 200], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const driftNew = interpolate(frame, [330, 460], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale =
    (0.92 + appIn * 0.06 + driftOld * 0.045) *
    (1 + burst * -0.09) *
    (1 + driftNew * 0.03) *
    (0.98 + appOut * 0.02);
  const camRotX = -4 * burst + 1.2 * Math.sin(frame / 90);
  const camRotY = interpolate(t, [0, 0.5, 1], [0, -14, 0], { easing: ez }) + 1.5 * Math.sin(frame / 110);
  const camY = 20 * (1 - appIn) + burst * 10;

  // ---- per-layer 3D transforms during the burst --------------------------
  const layer = (
    z: number,
    x: number,
    y: number,
    rx: number,
    ry: number,
  ): React.CSSProperties => ({
    transform: `translate3d(${x * burst}px, ${y * burst}px, ${z * burst}px) rotateX(${rx * burst}deg) rotateY(${ry * burst}deg)`,
  });

  const transforms: LayerTransforms = {
    sidebar: layer(190, -120, 0, 0, 18),
    topbar: layer(120, 40, -70, 14, 0),
    chat: layer(60, 60, 10, 0, -8),
    composer: layer(260, 30, 60, -16, -6),
  };

  const bg = mixColor(OLD.chrome, "#000000", Math.max(swap, 0));
  const showApp = frame >= 56 && appOut > 0.01;

  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {/* ambient backdrop for the new theme */}
      <AbsoluteFill
        style={{
          opacity: swap * 0.9,
          background:
            "radial-gradient(1100px 700px at 70% 10%, rgba(99,102,241,0.14), transparent 65%), radial-gradient(900px 600px at 20% 90%, rgba(56,189,248,0.07), transparent 60%)",
        }}
      />
      {/* light streak sweeping across during the swap */}
      <AbsoluteFill
        style={{
          opacity: burst * 0.5,
          background: `linear-gradient(105deg, transparent ${swap * 130 - 30}%, rgba(160,180,255,0.16) ${swap * 130 - 12}%, transparent ${swap * 130 + 6}%)`,
        }}
      />

      {/* intro */}
      {frame < 72 ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity: intro,
            fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif",
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: 20,
              background: OLD.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 34,
              fontWeight: 800,
              transform: `scale(${0.9 + intro * 0.1})`,
            }}
          >
            T3
          </div>
          <div style={{ marginTop: 28, fontSize: 54, fontWeight: 800, color: "#e7e7ec", letterSpacing: -1 }}>
            T3 Code
          </div>
          <div style={{ marginTop: 12, fontSize: 22, color: "#8b8b94" }}>
            previous latest → the new release
          </div>
        </AbsoluteFill>
      ) : null}

      {/* the app, on a 3D stage */}
      {showApp ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 1700,
            opacity: Math.min(appIn, appOut),
          }}
        >
          <div
            style={{
              transform: `translateY(${camY}px) scale(${scale}) rotateX(${camRotX}deg) rotateY(${camRotY}deg)`,
              transformStyle: "preserve-3d",
            }}
          >
            <AppMock p={p} morph={swap} transforms={transforms} layerShadow={burst} />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* scene labels */}
      {showApp ? (
        <>
          <Label
            title="The old look"
            sub="Previous latest — flat gray surfaces, grouped sidebar"
            color="#c9c9cf"
            subColor="#83838c"
            accent={OLD.primary}
            opacity={Math.min(appIn, interpolate(t, [0, 0.18], [1, 0], { extrapolateRight: "clamp" }))}
            y={(1 - appIn) * 24}
          />
          <Label
            title="The new release"
            sub="True-black dark theme · Sidebar V2 · glass surfaces"
            color="#f1f3f7"
            subColor="#9a9aa4"
            accent={NEXT.primary}
            opacity={Math.min(interpolate(t, [0.8, 1], [0, 1], { extrapolateLeft: "clamp" }), appOut)}
            y={interpolate(t, [0.8, 1], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
          />
        </>
      ) : null}

      {/* outro */}
      {frame > 448 ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity: outro * (1 - appOut),
            fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif",
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: 20,
              background: NEXT.primary,
              boxShadow: `0 0 60px ${NEXT.primary}66`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            T3
          </div>
          <div style={{ marginTop: 28, fontSize: 54, fontWeight: 800, color: "#f1f3f7", letterSpacing: -1 }}>
            The new T3 Code
          </div>
          <div style={{ marginTop: 12, fontSize: 22, color: "#9a9aa4" }}>
            Dark theme · Sidebar V2 · glass everywhere
          </div>
        </AbsoluteFill>
      ) : null}

      {/* subtle vignette */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(1200px 800px at 50% 45%, transparent 55%, rgba(0,0,0,0.4))",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
