/**
 * Theme palettes lifted from apps/web/src/index.css.
 *
 * "old"  — the previous release: zinc-family dark theme (milky gray surfaces,
 *          flat borders, no glass) with the Sidebar V1 grouped project tree.
 * "next" — the new release: neutral-black workspace, white-alpha lifted
 *          surfaces, glass composer, and the Sidebar V2 flat thread list.
 */
export type Palette = {
  background: string;
  chrome: string;
  card: string;
  cardBorder: string;
  sidebar: string;
  sidebarBorder: string;
  rowHover: string;
  rowSelected: string;
  foreground: string;
  muted: string;
  faint: string;
  primary: string;
  composer: string;
  composerBorder: string;
  topbar: string;
  glow: number; // 0..1 amount of ambient glow / glass
};

export const OLD: Palette = {
  background: "#131316", // zinc-950-ish milky gray
  chrome: "#1b1b1f",
  card: "#232327", // zinc-900 raised cards
  cardBorder: "#33333a",
  sidebar: "#1b1b1f",
  sidebarBorder: "#2c2c33",
  rowHover: "#26262b",
  rowSelected: "#2e2e35",
  foreground: "#d4d4d8",
  muted: "#86868f",
  faint: "#5b5b64",
  primary: "#5f7ce8", // old oklch(0.488 0.217 264) — duller blue
  composer: "#202024",
  composerBorder: "#3a3a42",
  topbar: "#1b1b1f",
  glow: 0,
};

export const NEXT: Palette = {
  background: "#0a0a0a", // neutral-950 → near-black workspace
  chrome: "#000000",
  card: "rgba(255,255,255,0.045)", // white-alpha lifted surfaces
  cardBorder: "rgba(255,255,255,0.08)",
  sidebar: "#050505",
  sidebarBorder: "rgba(255,255,255,0.07)",
  rowHover: "rgba(255,255,255,0.06)",
  rowSelected: "rgba(255,255,255,0.10)",
  foreground: "#f1f3f7",
  muted: "#a3a3a3",
  faint: "#5f5f66",
  primary: "#7c93ff", // new oklch(0.588 0.217 264) — brighter indigo
  composer: "rgba(20,20,24,0.72)", // glass surface
  composerBorder: "rgba(255,255,255,0.14)",
  topbar: "rgba(10,10,10,0.6)",
  glow: 1,
};

const parse = (c: string): [number, number, number, number] => {
  if (c.startsWith("#")) {
    const h = c.slice(1);
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 1];
  const parts = m[1].split(",").map((p) => parseFloat(p));
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
};

export const mixColor = (a: string, b: string, t: number): string => {
  const ca = parse(a);
  const cb = parse(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  const al = ca[3] + (cb[3] - ca[3]) * t;
  return `rgba(${r},${g},${bl},${al.toFixed(3)})`;
};

export const mixPalette = (t: number): Palette => {
  if (t <= 0) return OLD;
  if (t >= 1) return NEXT;
  const out = {} as Record<string, string | number>;
  for (const key of Object.keys(OLD) as (keyof Palette)[]) {
    const a = OLD[key];
    const b = NEXT[key];
    out[key] = typeof a === "number" ? (a as number) + ((b as number) - (a as number)) * t : mixColor(a as string, b as string, t);
  }
  return out as Palette;
};
