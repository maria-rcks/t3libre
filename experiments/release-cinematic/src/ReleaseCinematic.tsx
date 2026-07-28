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
import { Screen, STAGE_H, STAGE_W } from "./UiStage";

export const TOTAL_FRAMES = 1860; // 62s @ 30fps

// Synced to the supplied track (public/track.mp3, gitignored):
// the drop lands at ~46.2s = frame 1386.
// Old act captures: ool_home.png / ool_thread.png — the light-grey UI
// from the pre-dark-theme revision.
const DROP = 1386;

// Timeline (30fps):
//    0–  80  logo intro on #000 (brief)
//   64– 660  SHOT A — old light-grey home: sweeps in steeply tilted,
//            settles flat + sharp for a readable beat, leans away
//  660–1030  SHOT B — old thread view from the opposite raked angle,
//            settles flat, then a slow diagonal dolly
// 1030–1270  SHOT C — steep low-angle zoom toward the old composer
// 1270–1386  BUILD — camera pulls back and tips over, motion blur,
//            darkens as the track tenses up
// 1386       DROP — the new dark UI slams in full-frame
// 1386–1500  new home holds nearly full-frame, slow settle
// 1500–1626  glass composer flies in from the right, 3D-raked +
//            motion-blurred, settles flat and huge front-center
// 1614–1744  Sidebar V2 thread rows sweep in one by one
// 1732–1810  work log lands, response unfolds below it
// 1796–1860  full new UI, slow dolly + light sheen, fade out
const ez = Easing.bezier(0.3, 0, 0.12, 1);
const slam = Easing.bezier(0.1, 0.9, 0.14, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const FONT = "'DM Sans', -apple-system, 'Segoe UI', sans-serif";
const BEAT = (60 / 124) * 30; // ~14.5 frames per beat

type Cam = { rx: number; ry: number; s: number; x: number; y: number; z: number };
type CamKey = Cam & { f: number; e?: (t: number) => number };

/** Piecewise keyframed camera; each segment eases with the *next* key's easing. */
const camAt = (keys: CamKey[], frame: number): Cam => {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (frame <= first.f) return first;
  if (frame >= last.f) return last;
  let i = 0;
  while (frame > keys[i + 1].f) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = (b.e ?? ez)((frame - a.f) / (b.f - a.f));
  const mix = (p: number, q: number) => p + (q - p) * t;
  return {
    rx: mix(a.rx, b.rx),
    ry: mix(a.ry, b.ry),
    s: mix(a.s, b.s),
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z: mix(a.z, b.z),
  };
};

/** Motion-blur amount from camera velocity between consecutive frames. */
const camBlur = (keys: CamKey[], frame: number): number => {
  const a = camAt(keys, frame - 1);
  const b = camAt(keys, frame);
  const v =
    Math.abs(b.ry - a.ry) * 1.6 +
    Math.abs(b.rx - a.rx) * 1.6 +
    Math.abs(b.s - a.s) * 55 +
    Math.abs(b.x - a.x) * 0.045 +
    Math.abs(b.y - a.y) * 0.045 +
    Math.abs(b.z - a.z) * 0.02;
  return Math.max(0, v - 0.28) * 6;
};

// SHOT A — home screen sweeps in steeply raked, settles dead flat and
// sharp (frames ~250–430 readable), then leans away into the cut.
const CAM_A: CamKey[] = [
  { f: 64, rx: 16, ry: -34, s: 1.9, x: 340, y: -90, z: -260 },
  { f: 250, rx: 0, ry: 0, s: 1.34, x: 0, y: 0, z: 0 },
  { f: 430, rx: 0, ry: 0, s: 1.38, x: 0, y: 0, z: 0, e: Easing.linear },
  { f: 560, rx: -8, ry: 18, s: 1.5, x: -170, y: 60, z: -120 },
  { f: 660, rx: -14, ry: 30, s: 1.7, x: -360, y: 120, z: -320 },
];

// SHOT B — thread view arrives from the opposite rake, settles flat
// (~800–930 readable), then a slow diagonal dolly.
const CAM_B: CamKey[] = [
  { f: 660, rx: -12, ry: 32, s: 1.85, x: -340, y: 130, z: -300 },
  { f: 800, rx: 0, ry: 0, s: 1.35, x: 0, y: 0, z: 0 },
  { f: 930, rx: 0, ry: 0, s: 1.4, x: 0, y: 0, z: 0, e: Easing.linear },
  { f: 1030, rx: 6, ry: -12, s: 1.52, x: 150, y: -60, z: -80 },
];

// SHOT C — steep low-angle push toward the composer area, then the
// BUILD: pull back hard, tip over, ready for the drop.
const CAM_C: CamKey[] = [
  { f: 1030, rx: 6, ry: -12, s: 1.52, x: 150, y: -60, z: -80 },
  { f: 1160, rx: 14, ry: -6, s: 1.9, x: 40, y: -360, z: 60 },
  { f: 1270, rx: 18, ry: 4, s: 2.15, x: -120, y: -480, z: 120, e: Easing.linear },
  { f: 1340, rx: 26, ry: 16, s: 1.55, x: 60, y: -160, z: -420 },
  { f: DROP, rx: 34, ry: 30, s: 1.15, x: 260, y: 140, z: -900, e: Easing.bezier(0.5, 0, 0.9, 1) },
];

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

/** Full-frame blurred app backdrop used behind element showcases. */
const BlurBackdrop: React.FC<{ src: string; opacity: number }> = ({ src, opacity }) => (
  <AbsoluteFill style={{ opacity }}>
    <Img
      src={staticFile(src)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: "blur(26px) brightness(0.5) saturate(1.1)",
        transform: "scale(1.1)",
      }}
    />
  </AbsoluteFill>
);

/** One element showcase: flies in from the side in deep 3D, settles flat front-on. */
const Showcase: React.FC<{
  src: string;
  w: number;
  h: number;
  enter: number; // 0..1 fly-in
  exit: number; // 0..1 fly-out
  fromRight?: boolean;
  glow?: number;
  y?: number;
}> = ({ src, w, h, enter, exit, fromRight = false, glow = 0, y = 0 }) => {
  if (enter <= 0.001 || exit >= 0.999) return null;
  const dir = fromRight ? 1 : -1;
  const inv = 1 - enter;
  const outP = exit;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 1500 }}>
      <div
        style={{
          width: w,
          height: h,
          marginTop: y,
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.14)",
          transform: `translate3d(${dir * 1700 * inv - dir * 600 * outP}px, ${90 * inv}px, ${-950 * inv - 650 * outP}px) rotateY(${dir * -72 * inv + dir * 38 * outP}deg) rotateX(${14 * inv}deg)`,
          opacity: Math.min(1, enter * 1.5) * (1 - outP),
          filter: inv > 0.02 || outP > 0.02 ? `blur(${(inv + outP) * 11}px)` : undefined,
          boxShadow: `0 50px 140px rgba(0,0,0,0.8), 0 0 ${60 * glow}px rgba(120,145,255,${0.35 * glow})`,
          background: "#050507",
        }}
      >
        <Img src={staticFile(src)} style={{ width: w, height: h, display: "block" }} />
      </div>
    </AbsoluteFill>
  );
};

export const ReleaseCinematic: React.FC = () => {
  const frame = useCurrentFrame();

  const intro = interpolate(frame, [0, 14, 58, 80], [0, 1, 1, 0], clamp);

  // ---- old act: light-grey UI, keyframed 3D camera ----
  const showOld = frame >= 64 && frame < DROP;
  const oldKeys = frame < 660 ? CAM_A : frame < 1030 ? CAM_B : CAM_C;
  const cam = camAt(oldKeys, frame);
  const oldIn = interpolate(frame, [64, 120], [0, 1], { ...clamp, easing: ez });
  const shotBMix = interpolate(frame, [648, 672], [0, 1], { ...clamp, easing: ez });
  const buildDim = interpolate(frame, [1290, DROP - 4], [1, 0.3], {
    ...clamp,
    easing: Easing.bezier(0.6, 0, 0.9, 1),
  });
  const buildBlur = interpolate(frame, [1310, DROP - 4], [0, 14], {
    ...clamp,
    easing: Easing.bezier(0.6, 0, 0.9, 1),
  });
  const oBlur =
    camBlur(oldKeys, frame) + interpolate(oldIn, [0, 0.5], [10, 0], clamp) + buildBlur;

  // ---- drop & new act ----
  const dropImpact = interpolate(frame, [DROP, DROP + 24], [0, 1], { ...clamp, easing: slam });
  const dropHold = interpolate(frame, [DROP, 1500], [0, 1], clamp);
  const flash = interpolate(frame, [DROP - 2, DROP + 4, DROP + 22], [0, 0.9, 0], clamp);
  const showDropScreen = frame >= DROP && frame < 1512;

  // showcases (beat-aligned)
  const composerEnter = interpolate(frame, [1500, 1528], [0, 1], { ...clamp, easing: slam });
  const composerExit = interpolate(frame, [1606, 1626], [0, 1], { ...clamp, easing: ez });
  const rowsEnter = (i: number) =>
    interpolate(frame, [1614 + i * BEAT * 0.5, 1642 + i * BEAT * 0.5], [0, 1], {
      ...clamp,
      easing: slam,
    });
  const rowsExit = interpolate(frame, [1726, 1744], [0, 1], { ...clamp, easing: ez });
  const worklogEnter = interpolate(frame, [1732, 1758], [0, 1], { ...clamp, easing: slam });
  const responseReveal = interpolate(frame, [1752, 1786], [0, 1], { ...clamp, easing: ez });
  const worklogExit = interpolate(frame, [1792, 1810], [0, 1], { ...clamp, easing: ez });
  const showcasePhase = frame >= 1500 && frame < 1812;

  // final full app
  const finalIn = interpolate(frame, [1796, 1820], [0, 1], { ...clamp, easing: ez });
  const finalT = interpolate(frame, [1812, 1860], [0, 1], clamp);
  const fadeOut = interpolate(frame, [1836, 1860], [1, 0], clamp);
  const showFinal = frame >= 1796;

  const audioVolume = interpolate(frame, [0, 30, 1800, 1856], [0.7, 1, 1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden", fontFamily: FONT }}>
      <Audio src={staticFile("track.mp3")} volume={audioVolume} />

      {/* intro — the only overlay text in the whole piece */}
      {frame < 80 ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: intro }}>
          <LogoCard size={120} glow={0.35 * intro} />
          <div
            style={{
              marginTop: 30,
              fontSize: 54,
              fontWeight: 800,
              color: "#f1f3f7",
              letterSpacing: -1,
            }}
          >
            T3 Code
          </div>
        </AbsoluteFill>
      ) : null}

      {/* OLD ACT — the light-grey previous release, deep 3D camera */}
      {showOld ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 1600,
            opacity: oldIn * buildDim,
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `translate3d(${cam.x}px, ${cam.y}px, ${cam.z}px) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) scale(${cam.s})`,
              transformStyle: "preserve-3d",
              filter: oBlur > 0.25 ? `blur(${oBlur}px)` : undefined,
            }}
          >
            <div style={{ position: "absolute", inset: 0, opacity: 1 - shotBMix }}>
              <Screen src="ool_home.png" />
            </div>
            {shotBMix > 0 ? (
              <div style={{ position: "absolute", inset: 0, opacity: shotBMix }}>
                <Screen src="ool_thread.png" />
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* DROP — the new dark UI slams in full-frame */}
      {showDropScreen ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 1700,
            opacity: Math.min(1, dropImpact * 2) * interpolate(frame, [1494, 1512], [1, 0], clamp),
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `rotateY(${interpolate(dropHold, [0, 1], [-9, 5])}deg) rotateX(${interpolate(dropHold, [0, 1], [3, -2])}deg) scale(${interpolate(dropImpact, [0, 1], [1.85, 1.34]) + dropHold * 0.05})`,
              filter: dropImpact < 1 ? `blur(${(1 - dropImpact) * 8}px)` : undefined,
            }}
          >
            <Screen src="new_home.png" />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* ELEMENT SHOWCASES — blurred app behind, real element flat in front */}
      {showcasePhase ? (
        <>
          <BlurBackdrop
            src="new_thread.png"
            opacity={
              interpolate(frame, [1500, 1516], [0, 1], clamp) *
              (1 - interpolate(frame, [1794, 1812], [0, 1], clamp))
            }
          />
          {/* glass composer, big and front-on (776x148 capture at ~2x) */}
          <Showcase
            src="el_composer.png"
            w={1552}
            h={296}
            enter={composerEnter}
            exit={composerExit}
            fromRight
            glow={interpolate(frame, [1528, 1560, 1606], [1, 0.35, 0.6], clamp)}
          />
          {/* Sidebar V2 thread rows (233x78 captures at ~2.6x), one by one */}
          {rowsExit < 0.999 ? (
            <AbsoluteFill
              style={{ alignItems: "center", justifyContent: "center", perspective: 1500 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                  transformStyle: "preserve-3d",
                }}
              >
                {[0, 1, 2, 3].map((i) => {
                  const e = rowsEnter(i);
                  if (e <= 0.001) return null;
                  const inv = 1 - e;
                  return (
                    <div
                      key={i}
                      style={{
                        width: 606,
                        height: 203,
                        borderRadius: 16,
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.14)",
                        transform: `translate3d(${-1600 * inv + 600 * rowsExit}px, ${60 * inv}px, ${-800 * inv - 500 * rowsExit}px) rotateY(${66 * inv - 34 * rowsExit}deg) rotateX(${-8 * inv}deg)`,
                        opacity: Math.min(1, e * 1.5) * (1 - rowsExit),
                        filter:
                          inv > 0.02 || rowsExit > 0.02
                            ? `blur(${(inv + rowsExit) * 10}px)`
                            : undefined,
                        boxShadow: "0 40px 110px rgba(0,0,0,0.8)",
                        background: "#050507",
                      }}
                    >
                      <Img
                        src={staticFile(`el_row${i}.png`)}
                        style={{ width: 606, height: 203, display: "block" }}
                      />
                    </div>
                  );
                })}
              </div>
            </AbsoluteFill>
          ) : null}
          {/* work log lands, response unfolds under it (790px captures at 2x) */}
          {worklogEnter > 0.001 && worklogExit < 0.999 ? (
            <AbsoluteFill
              style={{ alignItems: "center", justifyContent: "center", perspective: 1500 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                  transformStyle: "preserve-3d",
                  transform: `translate3d(${1400 * (1 - worklogEnter) - 500 * worklogExit}px, 0px, ${-800 * (1 - worklogEnter) - 500 * worklogExit}px) rotateY(${-62 * (1 - worklogEnter) + 30 * worklogExit}deg) rotateX(${10 * (1 - worklogEnter)}deg)`,
                  opacity: Math.min(1, worklogEnter * 1.5) * (1 - worklogExit),
                  filter:
                    1 - worklogEnter > 0.02 || worklogExit > 0.02
                      ? `blur(${(1 - worklogEnter + worklogExit) * 10}px)`
                      : undefined,
                }}
              >
                <div
                  style={{
                    width: 1580,
                    height: 242,
                    borderRadius: 16,
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,0.14)",
                    boxShadow: "0 40px 110px rgba(0,0,0,0.8)",
                    background: "#050507",
                  }}
                >
                  <Img
                    src={staticFile("el_worklog.png")}
                    style={{ width: 1580, height: 242, display: "block" }}
                  />
                </div>
                <div
                  style={{
                    width: 1580,
                    height: 374 * responseReveal,
                    borderRadius: 16,
                    overflow: "hidden",
                    border: responseReveal > 0.02 ? "1px solid rgba(255,255,255,0.14)" : "none",
                    boxShadow: "0 40px 110px rgba(0,0,0,0.8)",
                    background: "#050507",
                  }}
                >
                  <Img
                    src={staticFile("el_response.png")}
                    style={{ width: 1580, height: 374, display: "block" }}
                  />
                </div>
              </div>
            </AbsoluteFill>
          ) : null}
        </>
      ) : null}

      {/* FINAL — the full new release, frame-filling */}
      {showFinal ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 2100,
            opacity: finalIn * fadeOut,
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `rotateY(${interpolate(finalT, [0, 1], [7, -3])}deg) rotateX(${interpolate(finalT, [0, 1], [-2, 1])}deg) scale(${interpolate(finalT, [0, 1], [1.32, 1.4])})`,
            }}
          >
            <Screen src="new_thread.png" />
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 14,
                overflow: "hidden",
                pointerEvents: "none",
                opacity: interpolate(finalT, [0.1, 0.5, 0.9], [0, 0.45, 0], clamp),
                background: `linear-gradient(115deg, transparent ${interpolate(finalT, [0.1, 0.9], [-25, 115], clamp)}%, rgba(190,205,255,0.15) ${interpolate(finalT, [0.1, 0.9], [-13, 127], clamp)}%, transparent ${interpolate(finalT, [0.1, 0.9], [-3, 137], clamp)}%)`,
              }}
            />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* drop flash */}
      {flash > 0.01 ? (
        <AbsoluteFill
          style={{
            opacity: flash,
            background:
              "radial-gradient(1100px 700px at 50% 50%, rgba(175,190,255,0.5), transparent 72%)",
          }}
        />
      ) : null}

      {/* vignette */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(1400px 900px at 50% 45%, transparent 60%, rgba(0,0,0,0.45))",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
