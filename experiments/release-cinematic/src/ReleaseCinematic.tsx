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
import { Element, Screen, STAGE_H, STAGE_W } from "./UiStage";

export const TOTAL_FRAMES = 720; // 24s @ 30fps

// Timeline (30fps):
//   0– 70  intro: real T3 logo on #000
//  55–240  the old dark look (real captures, Sidebar V1), slow angles + DOF
// 240–290  old UI recedes into the dark (music impact at frame 264)
// 270–560  the new UI assembles element by element: topbar drops in,
//          thread rows land one by one, the user message arrives, the
//          work log expands, the response unfolds, the composer rises
// 545–645  the assembled elements resolve into the full live app
// 645–720  outro
const ez = Easing.bezier(0.3, 0, 0.12, 1);
const pop = Easing.bezier(0.18, 0.7, 0.16, 1);
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
      bottom: 56,
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

const seg = (frame: number, start: number, dur: number) =>
  interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing: pop });

export const ReleaseCinematic: React.FC = () => {
  const frame = useCurrentFrame();

  const intro = interpolate(frame, [0, 14, 50, 68], [0, 1, 1, 0], clamp);

  // old act
  const oldIn = interpolate(frame, [55, 100], [0, 1], { ...clamp, easing: ez });
  const oldSwap = interpolate(frame, [160, 178], [0, 1], { ...clamp, easing: ez });
  const oldDrift = interpolate(frame, [55, 240], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.3, 0, 0.6, 1),
  });
  const oldOut = interpolate(frame, [240, 288], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.5, 0, 0.9, 1),
  });
  const oldRotY = interpolate(oldDrift, [0, 1], [-24, -6]) + oldOut * 18;
  const oldRotX = interpolate(oldDrift, [0, 1], [8, 3]) - oldOut * 6;
  const oldScale = interpolate(oldDrift, [0, 1], [0.88, 1.02]) * (1 - oldOut * 0.35);
  const oldBlur = interpolate(oldDrift, [0, 0.3], [7, 0], clamp) + oldOut * 12;
  const showOld = frame >= 55 && oldOut < 1;

  // element build-up
  const pTopbar = seg(frame, 275, 34);
  const rowStarts = [305, 319, 333, 347, 361];
  const pUserMsg = seg(frame, 392, 32);
  const pWorklog = seg(frame, 424, 30);
  const responseReveal = interpolate(frame, [456, 502], [0, 1], { ...clamp, easing: ez });
  const pComposer = seg(frame, 500, 38);
  const composerGlow = interpolate(frame, [510, 540, 585], [0, 1, 0.3], clamp);

  // camera drift during the build
  const buildT = interpolate(frame, [270, 560], [0, 1], clamp);
  const camRotY = interpolate(buildT, [0, 1], [-8, 7]);
  const camRotX = interpolate(buildT, [0, 1], [4, -2]);
  const camScale = interpolate(buildT, [0, 1], [0.92, 1.0]);

  // resolve into the full app
  const resolve = interpolate(frame, [545, 585], [0, 1], { ...clamp, easing: ez });
  const finalHold = interpolate(frame, [585, 645], [0, 1], clamp);
  const finalRotY = interpolate(resolve, [0, 1], [7, 3]) + finalHold * -8;
  const finalScale = 1.0 + finalHold * 0.06;
  const finalOut = interpolate(frame, [632, 656], [1, 0], { ...clamp, easing: ez });
  const showBuild = frame >= 270 && resolve < 1;
  const showFinal = resolve > 0 && finalOut > 0.01;
  const outroIn = interpolate(frame, [648, 672], [0, 1], clamp);

  const switchFlash = interpolate(frame, [258, 268, 292], [0, 0.5, 0], clamp);

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden", fontFamily: FONT }}>
      <Audio src={staticFile("music.mp3")} />

      <AbsoluteFill
        style={{
          opacity: 0.45 + 0.55 * interpolate(frame, [260, 320], [0, 1], clamp),
          background:
            "radial-gradient(1200px 750px at 68% 12%, rgba(99,102,241,0.10), transparent 62%), radial-gradient(1000px 650px at 22% 92%, rgba(56,189,248,0.05), transparent 60%)",
        }}
      />

      {/* intro */}
      {frame < 70 ? (
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

      {/* OLD ACT — real captures of the previous dark UI (Sidebar V1) */}
      {showOld ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 2000,
            opacity: oldIn * (1 - oldOut),
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
            <div style={{ position: "absolute", inset: 0, opacity: 1 - oldSwap }}>
              <Screen src="olddark_home.png" reflection={1} />
            </div>
            {oldSwap > 0 ? (
              <div style={{ position: "absolute", inset: 0, opacity: oldSwap }}>
                <Screen src="olddark_thread.png" reflection={1} />
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* NEW ACT — the release assembles from real UI elements */}
      {showBuild ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 1900,
            opacity: (1 - resolve) * interpolate(frame, [270, 290], [0, 1], clamp),
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `rotateX(${camRotX}deg) rotateY(${camRotY}deg) scale(${camScale})`,
              transformStyle: "preserve-3d",
            }}
          >
            {/* topbar drops in from above */}
            <Element
              src="el_topbar.png"
              x={52}
              y={16}
              w={1456}
              h={45}
              progress={pTopbar}
              from={{ x: 0, y: -280, z: 320, rx: 48 }}
              radius={10}
            />
            {/* the new Sidebar V2 thread rows land one by one */}
            {rowStarts.map((s, i) => (
              <Element
                key={i}
                src={`el_row${i}.png`}
                x={58}
                y={112 + i * 124}
                w={322}
                h={108}
                progress={seg(frame, s, 30)}
                from={{ x: -520, y: -140 - i * 26, z: 400, ry: 48 }}
                glow={interpolate(seg(frame, s, 30), [0.7, 1], [0.8, 0], clamp)}
              />
            ))}
            {/* conversation: user message arrives */}
            <Element
              src="el_usermsg.png"
              x={880}
              y={112}
              w={560}
              h={72}
              progress={pUserMsg}
              from={{ x: 440, y: -40, z: 300, ry: -38 }}
            />
            {/* work log lands, then the response unfolds below it */}
            <Element
              src="el_worklog.png"
              x={730}
              y={224}
              w={710}
              h={109}
              progress={pWorklog}
              from={{ x: 120, y: 60, z: 380, rx: -18 }}
            />
            <Element
              src="el_response.png"
              x={730}
              y={352}
              w={710}
              h={168}
              progress={responseReveal > 0 ? 1 : 0}
              from={{ x: 0, y: 0, z: 0 }}
              revealY={responseReveal}
            />
            {/* the glass composer rises from the deep */}
            <Element
              src="el_composer.png"
              x={700}
              y={700}
              w={724}
              h={138}
              progress={pComposer}
              from={{ x: 0, y: 340, z: 460, rx: -42 }}
              glow={composerGlow}
              radius={16}
            />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* the elements resolve into the full live app */}
      {showFinal ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            perspective: 2000,
            opacity: resolve * finalOut,
          }}
        >
          <div
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `rotateX(${2 - finalHold * 2}deg) rotateY(${finalRotY}deg) scale(${finalScale})`,
              transformStyle: "preserve-3d",
            }}
          >
            <Screen src="new_thread.png" reflection={1} />
            {/* glass sheen sweeping across the new UI */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 14,
                overflow: "hidden",
                pointerEvents: "none",
                opacity: interpolate(finalHold, [0.05, 0.4, 0.75], [0, 0.5, 0], clamp),
                background: `linear-gradient(115deg, transparent ${interpolate(finalHold, [0.05, 0.75], [-25, 115], clamp)}%, rgba(190,205,255,0.14) ${interpolate(finalHold, [0.05, 0.75], [-13, 127], clamp)}%, transparent ${interpolate(finalHold, [0.05, 0.75], [-3, 137], clamp)}%)`,
              }}
            />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* flash at the switch */}
      {switchFlash > 0.01 ? (
        <AbsoluteFill
          style={{
            opacity: switchFlash,
            background:
              "radial-gradient(900px 600px at 50% 50%, rgba(150,170,255,0.35), transparent 70%)",
          }}
        />
      ) : null}

      {/* labels */}
      <Label
        title="The old look"
        sub="Previous latest — Sidebar V1, grouped projects"
        accent="#5f7ce8"
        opacity={oldIn * (1 - oldOut)}
        y={(1 - oldIn) * 26}
      />
      <Label
        title="The new release"
        sub="Sidebar V2 threads · live status · glass composer · true-black #000"
        accent="#7c93ff"
        opacity={interpolate(frame, [300, 330], [0, 1], clamp) * finalOut}
        y={interpolate(frame, [300, 330], [26, 0], clamp)}
      />

      {/* outro */}
      {frame >= 648 ? (
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
