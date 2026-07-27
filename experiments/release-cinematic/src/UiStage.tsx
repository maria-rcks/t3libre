import React from "react";
import { Img, staticFile } from "remotion";

/** Full-app captures are 1920x1080, shown at this stage size. */
export const STAGE_W = 1560;
export const STAGE_H = 878;

/** A full screenshot on a rounded card with an optional floor reflection. */
export const Screen: React.FC<{
  src: string;
  style?: React.CSSProperties;
  reflection?: number; // 0..1
  border?: string;
}> = ({ src, style, reflection = 0, border = "1px solid rgba(255,255,255,0.10)" }) => (
  <div style={{ position: "relative", width: STAGE_W, height: STAGE_H, ...style }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 14,
        overflow: "hidden",
        border,
        boxShadow: "0 40px 120px rgba(0,0,0,0.75)",
      }}
    >
      <Img src={staticFile(src)} style={{ width: STAGE_W, height: STAGE_H }} />
    </div>
    {reflection > 0.01 ? (
      <div
        style={{
          position: "absolute",
          top: STAGE_H + 6,
          left: 0,
          width: STAGE_W,
          height: STAGE_H * 0.35,
          transform: "scaleY(-1)",
          borderRadius: 14,
          overflow: "hidden",
          opacity: 0.16 * reflection,
          maskImage: "linear-gradient(to top, rgba(0,0,0,1), transparent 80%)",
          WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,1), transparent 80%)",
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            width: STAGE_W,
            height: STAGE_H,
            objectFit: "cover",
            objectPosition: "bottom",
            filter: "blur(3px)",
          }}
        />
      </div>
    ) : null}
  </div>
);

/**
 * A real captured UI element flying in from a 3D offset.
 * progress 0 = fully offset/blurred, 1 = landed sharp at (x, y).
 */
export const Element: React.FC<{
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  progress: number;
  from: { x: number; y: number; z: number; rx?: number; ry?: number };
  glow?: number;
  radius?: number;
  revealY?: number; // 0..1 vertical wipe from the top (for "expanding" panels)
}> = ({ src, x, y, w, h, progress, from, glow = 0, radius = 12, revealY = 1 }) => {
  const p = progress;
  const inv = 1 - p;
  if (p <= 0.001) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h * revealY,
        overflow: "hidden",
        borderRadius: radius,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "#0a0a0c",
        transform: `translate3d(${from.x * inv}px, ${from.y * inv}px, ${from.z * inv}px) rotateX(${(from.rx ?? 0) * inv}deg) rotateY(${(from.ry ?? 0) * inv}deg)`,
        opacity: Math.min(1, p * 1.6),
        filter: inv > 0.02 ? `blur(${inv * 10}px)` : undefined,
        boxShadow:
          glow > 0.01
            ? `0 24px 80px rgba(0,0,0,0.7), 0 0 ${44 * glow}px rgba(120,145,255,${0.3 * glow})`
            : "0 24px 80px rgba(0,0,0,0.7)",
      }}
    >
      <Img src={staticFile(src)} style={{ width: w, height: h, display: "block" }} />
    </div>
  );
};
