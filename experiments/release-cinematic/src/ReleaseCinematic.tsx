import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Screen, Slice, SliceName, STAGE_H, STAGE_W } from "./UiStage";

export const TOTAL_FRAMES = 690; // 23s @ 30fps

// Timeline (30fps):
//   0– 75  intro: real T3 logo on #000
//  60–270  the old UI (real screenshots), slow angled presentation
// 270–405  break-apart: real UI slices scatter in 3D, new slices assemble
//          (music impact lands at frame 285)
// 405–600  the new UI: dark #000 theme + Sidebar V2, slow angled drift
// 600–690  outro
const ez = Easing.bezier(0.3, 0, 0.12, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const FONT = "'DM Sans', -apple-system, 'Segoe UI', sans-serif";

const Label: React.FC<{
  title: string;
  sub: string;
  accent: string;
  opacity: number;
  y: number;
}> = ({ title, sub, accent, opacity, y }) => (
  <div
    style={{
      position: "absolute",
      left: 90,
      bottom: 60,
      opacity,
      transform: `translateY(${y}px)`,
      fontFamily: FONT,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 36, height: 3, borderRadius: 2, background: accent }} />
      <div style={{ fontSize: 42, fontWeight: 800, color: "#f1f3f7", letterSpacing: -0.5 }}>
        {title}
      </div>
    </div>
    <div style={{ fontSize: 20, color: "#8f8f99", marginTop: 8, marginLeft: 50 }}>{sub}</div>
  </div>
);

const LogoCard: React.FC<{ size: number; glow: number }> = ({ size, glow }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.16,
      overflow: "hidden",
      boxShadow:
        glow > 0
          ? `0 0 ${70 * glow}px rgba(124,147,255,${0.45 * glow}), 0 0 0 1px rgba(255,255,255,0.14)`
          : "0 0 0 1px rgba(255,255,255,0.14)",
    }}
  >
    <Img src={staticFile("logo.svg")} style={{ width: size, height: size }} />
  </div>
);

// per-slice scatter targets for the break-apart (x, y, z, rx, ry)
const SCATTER: Record<SliceName, [number, number, number, number, number]> = {
  sidebar: [-620, -40, 420, 6, 38],
  topbar: [180, -380, 260, 34, -6],
  contentUpper: [420, -60, 140, 8, -24],
  contentLower: [260, 420, 520, -30, -12],
};

export const ReleaseCinematic: React.FC = () => {
  const frame = useCurrentFrame();

  const intro = interpolate(frame, [0, 14, 52, 72], [0, 1, 1, 0], clamp);
  const oldIn = interpolate(frame, [62, 110], [0, 1], { ...clamp, easing: ez });
  const t = interpolate(frame, [270, 405], [0, 1], { ...clamp, easing: ez });
  const scatterOut = interpolate(t, [0, 0.55], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.5, 0, 0.8, 1),
  });
  const assembleIn = interpolate(t, [0.35, 1], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 0.6, 0.18, 1),
  });
  const newHold = interpolate(frame, [405, 600], [0, 1], clamp);
  const outroIn = interpolate(frame, [600, 622], [0, 1], clamp);
  const newOut = interpolate(frame, [585, 615], [1, 0], { ...clamp, easing: ez });

  // crossfades between the two real captures inside each act
  const oldSwap = interpolate(frame, [178, 196], [0, 1], { ...clamp, easing: ez });
  const newSwap = interpolate(frame, [498, 516], [0, 1], { ...clamp, easing: ez });

  // ---- camera paths ----
  // Old act: starts steeply angled and far, slowly straightens while pushing in.
  const oldDrift = interpolate(frame, [62, 270], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.3, 0, 0.6, 1),
  });
  const oldRotY = interpolate(oldDrift, [0, 1], [-26, -7]);
  const oldRotX = interpolate(oldDrift, [0, 1], [9, 3]);
  const oldScale =
    interpolate(oldDrift, [0, 1], [0.86, 1.02]) * interpolate(scatterOut, [0, 1], [1, 1.06]);
  const oldBlur = interpolate(oldDrift, [0, 0.35], [7, 0], clamp);

  // New act: sweeps in from the opposite angle, then a slow dolly.
  const newRotY =
    interpolate(assembleIn, [0, 1], [30, 10]) + interpolate(newHold, [0, 1], [0, -13]);
  const newRotX = interpolate(assembleIn, [0, 1], [-10, 4]) + interpolate(newHold, [0, 1], [0, -2]);
  const newScale =
    interpolate(assembleIn, [0, 1], [0.8, 0.96]) + interpolate(newHold, [0, 1], [0, 0.1]);
  const holdBlur = interpolate(assembleIn, [0.75, 1], [5, 0], clamp);

  const showOld = frame >= 60 && scatterOut < 1;
  const showNew = assembleIn > 0 && newOut > 0.01;

  // streak sweeping during the switch
  const streakX = interpolate(t, [0.2, 0.85], [-30, 130], clamp);

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden", fontFamily: FONT }}>
      <Audio src={staticFile("music.mp3")} />

      {/* faint ambient glow, stronger once the new theme lands */}
      <AbsoluteFill
        style={{
          opacity: 0.5 + 0.5 * assembleIn,
          background:
            "radial-gradient(1200px 750px at 68% 12%, rgba(99,102,241,0.10), transparent 62%), radial-gradient(1000px 650px at 22% 92%, rgba(56,189,248,0.05), transparent 60%)",
        }}
      />

      {/* intro */}
      {frame < 75 ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: intro }}>
          <LogoCard size={110} glow={0.3 * intro} />
          <div
            style={{
              marginTop: 30,
              fontSize: 58,
              fontWeight: 800,
              color: "#f1f3f7",
              letterSpacing: -1,
            }}
          >
            T3 Code
          </div>
          <div style={{ marginTop: 12, fontSize: 22, color: "#8f8f99" }}>
            previous latest → the new release
          </div>
        </AbsoluteFill>
      ) : null}

      {/* OLD ACT — real screenshots of the previous UI */}
      {showOld ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 2000,
            opacity: oldIn,
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `rotateX(${oldRotX}deg) rotateY(${oldRotY}deg) scale(${oldScale})`,
              transformStyle: "preserve-3d",
              filter: oldBlur > 0.2 ? `blur(${oldBlur}px)` : undefined,
            }}
          >
            {scatterOut < 0.01 ? (
              <>
                <div style={{ position: "absolute", inset: 0, opacity: 1 - oldSwap }}>
                  <Screen src="old_home.png" reflection={1} />
                </div>
                {oldSwap > 0 ? (
                  <div style={{ position: "absolute", inset: 0, opacity: oldSwap }}>
                    <Screen src="old_thread.png" reflection={1} />
                  </div>
                ) : null}
              </>
            ) : (
              // break-apart: the real UI slices scatter into 3D space
              (Object.keys(SCATTER) as SliceName[]).map((name) => {
                const [sx, sy, sz, rx, ry] = SCATTER[name];
                const p = scatterOut;
                return (
                  <Slice
                    key={name}
                    src="old_thread.png"
                    name={name}
                    radius={10 * p}
                    style={{
                      transform: `translate3d(${sx * p}px, ${sy * p}px, ${sz * p}px) rotateX(${rx * p}deg) rotateY(${ry * p}deg)`,
                      opacity: 1 - p * 0.98,
                      filter: `blur(${p * 9}px)`,
                      boxShadow: `0 ${26 * p}px ${70 * p}px rgba(0,0,0,0.6)`,
                    }}
                  />
                );
              })
            )}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* NEW ACT — real screenshots of the dark #000 theme + Sidebar V2 */}
      {showNew ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 2000,
            opacity: Math.min(1, assembleIn * 1.4) * newOut,
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `rotateX(${newRotX}deg) rotateY(${newRotY}deg) scale(${newScale})`,
              transformStyle: "preserve-3d",
              filter: holdBlur > 0.2 ? `blur(${holdBlur}px)` : undefined,
            }}
          >
            {assembleIn < 1 ? (
              // slices assemble from mirrored scatter positions
              (Object.keys(SCATTER) as SliceName[]).map((name) => {
                const [sx, sy, sz, rx, ry] = SCATTER[name];
                const p = 1 - assembleIn;
                return (
                  <Slice
                    key={name}
                    src="new_home.png"
                    name={name}
                    radius={10 * p}
                    style={{
                      transform: `translate3d(${-sx * p}px, ${-sy * p}px, ${(sz + 160) * p}px) rotateX(${-rx * p}deg) rotateY(${-ry * p}deg)`,
                      opacity: 1 - p * 0.75,
                      filter: `blur(${p * 7}px)`,
                      boxShadow: `0 ${26 * p}px ${70 * p}px rgba(0,0,0,0.6)`,
                    }}
                  />
                );
              })
            ) : (
              <>
                <div style={{ position: "absolute", inset: 0, opacity: 1 - newSwap }}>
                  <Screen src="new_home.png" reflection={1} />
                </div>
                {newSwap > 0 ? (
                  <div style={{ position: "absolute", inset: 0, opacity: newSwap }}>
                    <Screen src="new_thread.png" reflection={1} />
                  </div>
                ) : null}
                {/* glass sheen sweeping across the new UI */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 14,
                    overflow: "hidden",
                    pointerEvents: "none",
                    opacity: interpolate(newHold, [0.1, 0.35, 0.6], [0, 0.5, 0], clamp),
                    background: `linear-gradient(115deg, transparent ${interpolate(newHold, [0.1, 0.6], [-25, 115], clamp)}%, rgba(190,205,255,0.14) ${interpolate(newHold, [0.1, 0.6], [-13, 127], clamp)}%, transparent ${interpolate(newHold, [0.1, 0.6], [-3, 137], clamp)}%)`,
                  }}
                />
              </>
            )}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* light streak during the switch */}
      {t > 0 && t < 1 ? (
        <AbsoluteFill
          style={{
            opacity: Math.sin(Math.PI * t) * 0.55,
            background: `linear-gradient(105deg, transparent ${streakX - 16}%, rgba(160,180,255,0.2) ${streakX}%, transparent ${streakX + 12}%)`,
          }}
        />
      ) : null}

      {/* labels */}
      <Label
        title="The old look"
        sub="Previous latest — light chrome, grouped project sidebar"
        accent="#5f7ce8"
        opacity={Math.min(oldIn, interpolate(t, [0, 0.2], [1, 0], clamp)) * (frame >= 60 ? 1 : 0)}
        y={(1 - oldIn) * 26}
      />
      <Label
        title="The new release"
        sub="True-black dark theme · Sidebar V2 · glass surfaces"
        accent="#7c93ff"
        opacity={interpolate(t, [0.85, 1], [0, 1], clamp) * newOut}
        y={interpolate(t, [0.85, 1], [26, 0], clamp)}
      />

      {/* outro */}
      {frame >= 600 ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: outroIn }}>
          <LogoCard size={110} glow={outroIn} />
          <div
            style={{
              marginTop: 30,
              fontSize: 58,
              fontWeight: 800,
              color: "#f1f3f7",
              letterSpacing: -1,
            }}
          >
            The new T3 Code
          </div>
          <div style={{ marginTop: 12, fontSize: 22, color: "#8f8f99" }}>
            Dark theme · Sidebar V2 · glass everywhere
          </div>
        </AbsoluteFill>
      ) : null}

      {/* vignette */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(1250px 820px at 50% 45%, transparent 55%, rgba(0,0,0,0.5))",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
