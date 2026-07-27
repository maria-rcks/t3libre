import React from "react";
import { Img, staticFile } from "remotion";

/** Screenshot geometry: captures are 1920x1080, shown at this stage size. */
export const STAGE_W = 1560;
export const STAGE_H = 878;

/** Fractional crop regions of the real app screenshots. */
export const SLICES = {
  sidebar: { x: 0, y: 0, w: 0.1084, h: 1 },
  topbar: { x: 0.1084, y: 0, w: 0.8916, h: 0.048 },
  contentUpper: { x: 0.1084, y: 0.048, w: 0.8916, h: 0.5 },
  contentLower: { x: 0.1084, y: 0.548, w: 0.8916, h: 0.452 },
} as const;

export type SliceName = keyof typeof SLICES;

export const Slice: React.FC<{
  src: string;
  name: SliceName;
  style?: React.CSSProperties;
  radius?: number;
}> = ({ src, name, style, radius = 0 }) => {
  const r = SLICES[name];
  return (
    <div
      style={{
        position: "absolute",
        left: r.x * STAGE_W,
        top: r.y * STAGE_H,
        width: r.w * STAGE_W,
        height: r.h * STAGE_H,
        overflow: "hidden",
        borderRadius: radius,
        ...style,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          left: -r.x * STAGE_W,
          top: -r.y * STAGE_H,
          width: STAGE_W,
          height: STAGE_H,
        }}
      />
    </div>
  );
};

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
