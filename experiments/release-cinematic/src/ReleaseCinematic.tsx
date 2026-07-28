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
const DROP = 1386;

// Timeline (30fps):
//    0–  90  logo intro on #000
//   80– 600  old release home, slow angled push-in (fills the frame)
//  600–1010  old release thread view, opposite angle
// 1010–1260  slow zoom toward the old composer area
// 1260–1386  pull back + blur + darken as the track builds
// 1386       DROP — the new UI slams in full-frame
// 1500–1620  glass composer showcase: flies in from the side, settles flat
// 1620–1740  Sidebar V2 thread rows sweep in one by one, settle flat
// 1740–1808  work log + response unfold
// 1786–1860  full new UI, slow dolly + sheen, fade out
const ez = Easing.bezier(0.3, 0, 0.12, 1);
const slam = Easing.bezier(0.1, 0.9, 0.14, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const FONT = "'DM Sans', -apple-system, 'Segoe UI', sans-serif";
const BEAT = (60 / 124) * 30; // ~14.5 frames per beat

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
        filter: "blur(26px) brightness(0.45) saturate(1.1)",
        transform: "scale(1.1)",
      }}
    />
  </AbsoluteFill>
);

/** One element showcase: flies in from the side in 3D, settles flat front-on. */
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
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 1700 }}>
      <div
        style={{
          width: w,
          height: h,
          marginTop: y,
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.14)",
          transform: `translate3d(${dir * 1300 * inv - dir * 500 * outP}px, ${60 * inv}px, ${-700 * inv - 500 * outP}px) rotateY(${dir * -55 * inv + dir * 30 * outP}deg) rotateX(${8 * inv}deg)`,
          opacity: Math.min(1, enter * 1.5) * (1 - outP),
          filter: inv > 0.02 || outP > 0.02 ? `blur(${(inv + outP) * 9}px)` : undefined,
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

  const intro = interpolate(frame, [0, 16, 66, 88], [0, 1, 1, 0], clamp);

  // ---- old act (fills the frame, slow motion) ----
  const oldIn = interpolate(frame, [80, 150], [0, 1], { ...clamp, easing: ez });
  const oldSwap = interpolate(frame, [580, 620], [0, 1], { ...clamp, easing: ez });
  const act1 = interpolate(frame, [80, 620], [0, 1], clamp);
  const act2 = interpolate(frame, [620, 1010], [0, 1], clamp);
  const zoomAct = interpolate(frame, [1010, 1260], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.35, 0, 0.5, 1),
  });
  const buildOut = interpolate(frame, [1260, DROP - 6], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.6, 0, 0.9, 1),
  });
  const showOld = frame >= 80 && frame < DROP;

  // camera for old act: fills the screen (scale >= 1.25 of stage)
  let oRotY = 0;
  let oRotX = 0;
  let oScale = 1.25;
  let oX = 0;
  let oY = 0;
  if (frame < 620) {
    oRotY = interpolate(act1, [0, 1], [-14, -4]);
    oRotX = interpolate(act1, [0, 1], [5, 2]);
    oScale = interpolate(act1, [0, 1], [1.28, 1.38]);
    oX = interpolate(act1, [0, 1], [60, -40]);
  } else if (frame < 1010) {
    oRotY = interpolate(act2, [0, 1], [10, 3]);
    oRotX = interpolate(act2, [0, 1], [-3, 1]);
    oScale = interpolate(act2, [0, 1], [1.3, 1.42]);
    oX = interpolate(act2, [0, 1], [-80, 40]);
    oY = interpolate(act2, [0, 1], [-20, 30]);
  } else {
    // slow zoom toward the composer area (lower middle of the shot)
    oRotY = interpolate(zoomAct, [0, 1], [3, -6]);
    oRotX = interpolate(zoomAct, [0, 1], [1, 4]);
    oScale = interpolate(zoomAct, [0, 1], [1.42, 2.05]);
    oX = interpolate(zoomAct, [0, 1], [40, -120]);
    oY = interpolate(zoomAct, [0, 1], [30, -420]);
  }
  // build: pull back hard + blur
  oScale *= 1 - buildOut * 0.45;
  const oBlur = interpolate(oldIn, [0, 0.4], [8, 0], clamp) + buildOut * 16;
  const oDim = 1 - buildOut * 0.75;

  // ---- drop & new act ----
  const dropImpact = interpolate(frame, [DROP, DROP + 26], [0, 1], { ...clamp, easing: slam });
  const dropHold = interpolate(frame, [DROP, 1500], [0, 1], clamp);
  const flash = interpolate(frame, [DROP - 2, DROP + 4, DROP + 22], [0, 0.85, 0], clamp);
  const showDropScreen = frame >= DROP && frame < 1512;

  // showcases (beat-aligned)
  const composerEnter = interpolate(frame, [1500, 1530], [0, 1], { ...clamp, easing: slam });
  const composerExit = interpolate(frame, [1608, 1626], [0, 1], { ...clamp, easing: ez });
  const rowsEnter = (i: number) =>
    interpolate(frame, [1614 + i * BEAT * 0.5, 1640 + i * BEAT * 0.5], [0, 1], {
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

      {/* intro */}
      {frame < 90 ? (
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

      {/* OLD ACT — the previous release, real captures, frame-filling */}
      {showOld ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 2100,
            opacity: oldIn * oDim,
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `translate(${oX}px, ${oY}px) rotateX(${oRotX}deg) rotateY(${oRotY}deg) scale(${oScale})`,
              transformStyle: "preserve-3d",
              filter: oBlur > 0.2 ? `blur(${oBlur}px)` : undefined,
            }}
          >
            <div style={{ position: "absolute", inset: 0, opacity: 1 - oldSwap }}>
              <Screen src="oo_home.png" />
            </div>
            {oldSwap > 0 ? (
              <div style={{ position: "absolute", inset: 0, opacity: oldSwap }}>
                <Screen src="oo_thread.png" />
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* DROP — the new UI slams in full-frame */}
      {showDropScreen ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 2100,
            opacity: Math.min(1, dropImpact * 2) * interpolate(frame, [1494, 1512], [1, 0], clamp),
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `rotateY(${interpolate(dropHold, [0, 1], [-6, 4])}deg) rotateX(${interpolate(dropHold, [0, 1], [2, -1])}deg) scale(${interpolate(dropImpact, [0, 1], [1.75, 1.32]) + dropHold * 0.05})`,
              filter: dropImpact < 1 ? `blur(${(1 - dropImpact) * 6}px)` : undefined,
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
          {/* glass composer, big and front-on */}
          <Showcase
            src="el_composer.png"
            w={1240}
            h={236}
            enter={composerEnter}
            exit={composerExit}
            fromRight
            glow={interpolate(frame, [1530, 1560, 1608], [1, 0.35, 0.6], clamp)}
          />
          {/* Sidebar V2 thread rows, sweeping in one by one */}
          {rowsExit < 0.999 ? (
            <AbsoluteFill
              style={{ alignItems: "center", justifyContent: "center", perspective: 1700 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
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
                        width: 560,
                        height: 187,
                        borderRadius: 16,
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.14)",
                        transform: `translate3d(${-1200 * inv + 500 * rowsExit}px, ${40 * inv}px, ${-600 * inv - 400 * rowsExit}px) rotateY(${50 * inv - 28 * rowsExit}deg)`,
                        opacity: Math.min(1, e * 1.5) * (1 - rowsExit),
                        filter:
                          inv > 0.02 || rowsExit > 0.02
                            ? `blur(${(inv + rowsExit) * 8}px)`
                            : undefined,
                        boxShadow: "0 40px 110px rgba(0,0,0,0.8)",
                        background: "#050507",
                      }}
                    >
                      <Img
                        src={staticFile(`el_row${i}.png`)}
                        style={{ width: 560, height: 187, display: "block" }}
                      />
                    </div>
                  );
                })}
              </div>
            </AbsoluteFill>
          ) : null}
          {/* work log lands, response unfolds under it */}
          {worklogEnter > 0.001 && worklogExit < 0.999 ? (
            <AbsoluteFill
              style={{ alignItems: "center", justifyContent: "center", perspective: 1700 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                  transformStyle: "preserve-3d",
                  transform: `translate3d(${900 * (1 - worklogEnter) - 400 * worklogExit}px, 0px, ${-500 * (1 - worklogEnter) - 400 * worklogExit}px) rotateY(${-45 * (1 - worklogEnter) + 24 * worklogExit}deg)`,
                  opacity: Math.min(1, worklogEnter * 1.5) * (1 - worklogExit),
                  filter:
                    1 - worklogEnter > 0.02 || worklogExit > 0.02
                      ? `blur(${(1 - worklogEnter + worklogExit) * 8}px)`
                      : undefined,
                }}
              >
                <div
                  style={{
                    width: 1050,
                    height: 161,
                    borderRadius: 16,
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,0.14)",
                    boxShadow: "0 40px 110px rgba(0,0,0,0.8)",
                    background: "#050507",
                  }}
                >
                  <Img
                    src={staticFile("el_worklog.png")}
                    style={{ width: 1050, height: 161, display: "block" }}
                  />
                </div>
                <div
                  style={{
                    width: 1050,
                    height: 248 * responseReveal,
                    borderRadius: 16,
                    overflow: "hidden",
                    border: responseReveal > 0.02 ? "1px solid rgba(255,255,255,0.14)" : "none",
                    boxShadow: "0 40px 110px rgba(0,0,0,0.8)",
                    background: "#050507",
                  }}
                >
                  <Img
                    src={staticFile("el_response.png")}
                    style={{ width: 1050, height: 248, display: "block" }}
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
              transform: `rotateY(${interpolate(finalT, [0, 1], [5, -2])}deg) scale(${interpolate(finalT, [0, 1], [1.3, 1.38])})`,
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
