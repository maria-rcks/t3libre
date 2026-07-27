import React from "react";
import { Palette, mixColor } from "./palette";

/**
 * Stylized recreation of the T3 Code workspace, split into independent layers
 * (sidebar / topbar / chat / composer) so the transition can lift each one
 * into 3D space separately.
 *
 * `morph` (0..1) crossfades Sidebar V1 (grouped project tree) into Sidebar V2
 * (flat thread cards) and turns on glass/glow treatments.
 */

export type LayerTransforms = {
  sidebar?: React.CSSProperties;
  topbar?: React.CSSProperties;
  chat?: React.CSSProperties;
  composer?: React.CSSProperties;
};

const Dot: React.FC<{ color: string; size?: number; glow?: boolean }> = ({
  color,
  size = 8,
  glow,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size,
      background: color,
      boxShadow: glow ? `0 0 10px ${color}` : undefined,
      flexShrink: 0,
    }}
  />
);

const Bar: React.FC<{ w: number; h?: number; color: string; r?: number }> = ({
  w,
  h = 10,
  color,
  r = 5,
}) => <div style={{ width: w, height: h, borderRadius: r, background: color }} />;

const SidebarV1: React.FC<{ p: Palette; opacity: number }> = ({ p, opacity }) => {
  const group = (label: number, rows: number[], selected?: number) => (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px", marginBottom: 10 }}>
        <div style={{ width: 0, height: 0, borderLeft: `5px solid ${p.faint}`, borderTop: "4px solid transparent", borderBottom: "4px solid transparent" }} />
        <Bar w={label} h={9} color={p.faint} />
      </div>
      {rows.map((w, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "0 8px 4px",
            padding: "9px 12px",
            borderRadius: 7,
            background: i === selected ? p.rowSelected : "transparent",
            border: i === selected ? `1px solid ${p.cardBorder}` : "1px solid transparent",
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${p.faint}` }} />
          <Bar w={w} h={9} color={i === selected ? p.foreground : p.muted} />
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, opacity, paddingTop: 12 }}>
      {group(64, [118, 92, 140], 1)}
      {group(88, [104, 128])}
      {group(52, [96, 132, 84])}
    </div>
  );
};

const SidebarV2: React.FC<{ p: Palette; opacity: number }> = ({ p, opacity }) => {
  const glow = p.glow;
  const card = (
    title: number,
    sub: number,
    status: string,
    selected: boolean,
    working?: boolean,
  ) => (
    <div
      style={{
        margin: "0 10px 8px",
        padding: "11px 13px",
        borderRadius: 10,
        background: selected ? p.rowSelected : p.card,
        border: `1px solid ${selected ? mixColor(p.cardBorder, "#ffffff", 0.15 * glow) : p.cardBorder}`,
        boxShadow: glow && selected ? "0 4px 24px rgba(124,147,255,0.10)" : undefined,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Dot color={status} glow={glow > 0.5 && working} />
        <Bar w={title} h={9} color={p.foreground} />
        {working ? (
          <div
            style={{
              marginLeft: "auto",
              padding: "2px 7px",
              borderRadius: 20,
              border: `1px solid ${p.cardBorder}`,
              fontSize: 10,
              fontFamily: "monospace",
              color: p.muted,
            }}
          >
            2m 14s
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 17 }}>
        <Bar w={sub} h={7} color={p.faint} />
        <Bar w={26} h={7} color={p.faint} />
      </div>
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, opacity, paddingTop: 8 }}>
      <div style={{ display: "flex", gap: 6, padding: "4px 12px 12px" }}>
        {["All", "Working", "Settled"].map((label, i) => (
          <div
            key={label}
            style={{
              padding: "5px 12px",
              borderRadius: 20,
              fontSize: 12,
              color: i === 0 ? p.foreground : p.muted,
              background: i === 0 ? p.rowSelected : "transparent",
              border: `1px solid ${i === 0 ? p.cardBorder : "transparent"}`,
            }}
          >
            {label}
          </div>
        ))}
      </div>
      {card(112, 68, "#34d399", true, true)}
      {card(138, 54, "#7c93ff", false)}
      {card(96, 76, "#fbbf24", false, true)}
      {card(124, 60, p.faint, false)}
      {card(84, 48, p.faint, false)}
    </div>
  );
};

export const AppMock: React.FC<{
  p: Palette;
  morph: number; // 0 = sidebar v1, 1 = sidebar v2
  transforms?: LayerTransforms;
  layerShadow?: number; // 0..1 drop shadows while layers float in 3D
}> = ({ p, morph, transforms = {}, layerShadow = 0 }) => {
  const glow = p.glow;
  const shadow = (extra = "") =>
    layerShadow > 0
      ? `0 ${30 * layerShadow}px ${80 * layerShadow}px rgba(0,0,0,${0.55 * layerShadow})${extra}`
      : undefined;

  const glass = (surface: string): React.CSSProperties =>
    glow > 0.05
      ? {
          background: surface,
          backdropFilter: `blur(${16 * glow}px) saturate(${1 + 0.1 * glow})`,
          WebkitBackdropFilter: `blur(${16 * glow}px) saturate(${1 + 0.1 * glow})`,
        }
      : { background: surface };

  return (
    <div
      style={{
        width: 1560,
        height: 940,
        borderRadius: 18,
        position: "relative",
        background: p.background,
        border: `1px solid ${p.cardBorder}`,
        overflow: layerShadow > 0.02 ? "visible" : "hidden",
        transformStyle: "preserve-3d",
        fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      {/* ambient glow of the new theme */}
      {glow > 0.01 ? (
        <div
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: 18,
            opacity: glow,
            background:
              "radial-gradient(900px 500px at 78% 8%, rgba(99,102,241,0.16), transparent 60%), radial-gradient(700px 420px at 30% 100%, rgba(56,189,248,0.08), transparent 60%)",
            pointerEvents: "none",
          }}
        />
      ) : null}

      {/* Sidebar layer */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 320,
          borderRight: `1px solid ${p.sidebarBorder}`,
          borderRadius: "18px 0 0 18px",
          boxShadow: shadow(),
          transformStyle: "preserve-3d",
          ...glass(p.sidebar),
          ...transforms.sidebar,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 16px 10px" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: p.primary,
              boxShadow: glow ? `0 0 18px ${mixColor(p.primary, "#000000", 0)}55` : undefined,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            T3
          </div>
          <div style={{ color: p.foreground, fontWeight: 700, fontSize: 15 }}>T3 Code</div>
          <div
            style={{
              marginLeft: "auto",
              width: 22,
              height: 22,
              borderRadius: 6,
              border: `1px solid ${p.sidebarBorder}`,
            }}
          />
        </div>
        <div style={{ position: "relative", height: 800 }}>
          <SidebarV1 p={p} opacity={1 - morph} />
          <SidebarV2 p={p} opacity={morph} />
        </div>
      </div>

      {/* Topbar layer */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 320,
          right: 0,
          height: 54,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 20px",
          borderBottom: `1px solid ${p.sidebarBorder}`,
          borderRadius: "0 18px 0 0",
          boxShadow: shadow(),
          ...glass(p.topbar),
          ...transforms.topbar,
        }}
      >
        <Bar w={150} h={11} color={p.foreground} />
        <div
          style={{
            padding: "3px 10px",
            borderRadius: 20,
            border: `1px solid ${p.cardBorder}`,
            fontSize: 11,
            fontFamily: "monospace",
            color: p.muted,
          }}
        >
          main
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Bar w={64} h={26} r={7} color={p.card} />
          <Bar w={64} h={26} r={7} color={p.card} />
          <div
            style={{
              width: 74,
              height: 26,
              borderRadius: 7,
              background: p.primary,
              boxShadow: glow ? `0 0 20px ${p.primary}44` : undefined,
            }}
          />
        </div>
      </div>

      {/* Chat layer */}
      <div
        style={{
          position: "absolute",
          top: 54,
          left: 320,
          right: 0,
          bottom: 160,
          padding: "28px 120px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxShadow: shadow(),
          background: layerShadow > 0.02 ? p.background : "transparent",
          ...transforms.chat,
        }}
      >
        <div
          style={{
            alignSelf: "flex-end",
            width: 420,
            padding: 16,
            borderRadius: 14,
            border: `1px solid ${p.cardBorder}`,
            display: "flex",
            flexDirection: "column",
            gap: 9,
            ...glass(p.card),
          }}
        >
          <Bar w={330} h={9} color={p.foreground} />
          <Bar w={240} h={9} color={p.muted} />
        </div>
        <div style={{ display: "flex", gap: 12, width: 640 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: p.primary,
              flexShrink: 0,
              boxShadow: glow ? `0 0 14px ${p.primary}55` : undefined,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
            <Bar w={520} h={9} color={p.foreground} />
            <Bar w={560} h={9} color={p.muted} />
            <Bar w={430} h={9} color={p.muted} />
            <div
              style={{
                marginTop: 8,
                borderRadius: 10,
                border: `1px solid ${p.cardBorder}`,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                ...glass(p.card),
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Dot color="#34d399" size={7} glow={glow > 0.5} />
                <Bar w={180} h={8} color={p.muted} />
              </div>
              <Bar w={380} h={8} color={p.faint} />
              <Bar w={300} h={8} color={p.faint} />
            </div>
            <Bar w={480} h={9} color={p.muted} />
          </div>
        </div>
      </div>

      {/* Composer layer */}
      <div
        style={{
          position: "absolute",
          left: 320 + 100,
          right: 100,
          bottom: 34,
          height: 110,
          borderRadius: 22,
          border: `1px solid ${p.composerBorder}`,
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow: shadow() ?? (glow > 0.4 ? "0 12px 50px rgba(0,0,0,0.5)" : undefined),
          ...glass(p.composer),
          ...transforms.composer,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Bar w={210} h={10} color={p.muted} />
          <div style={{ width: 2, height: 16, background: p.primary, borderRadius: 2 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, border: `1.5px solid ${p.faint}`, display: "flex", alignItems: "center", justifyContent: "center", color: p.faint, fontSize: 15 }}>
            +
          </div>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              border: `1px solid ${p.cardBorder}`,
              fontSize: 11,
              color: p.muted,
            }}
          >
            claude-sonnet-4.5
          </div>
          <div
            style={{
              marginLeft: "auto",
              width: 30,
              height: 30,
              borderRadius: 9,
              background: p.primary,
              boxShadow: glow ? `0 0 22px ${p.primary}66` : undefined,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 14,
            }}
          >
            ↑
          </div>
        </div>
      </div>
    </div>
  );
};
