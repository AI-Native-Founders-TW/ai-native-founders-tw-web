// 章節 03 的 SVG 構圖（品質 low 的動態版、減少動態／無 JS 的靜態版共用）。
// 純數學，伺服器端與瀏覽器都能算。

export interface SvgScene {
  w: number;
  h: number;
  earth: { cx: number; cy: number; r: number };
  tpe: { x: number; y: number };
  sfo: { x: number; y: number };
  d: string;
  /** 依弧長取點（t: 0–1） */
  at: (t: number) => { x: number; y: number };
  dawn: { x: number; y: number };
  stars: { x: number; y: number; r: number; o: number }[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function svgScene(w: number, h: number): SvgScene {
  const portrait = h > w;
  const r = Math.max(w, h) * (portrait ? 1.6 : 1.35);
  const horizon = h * (portrait ? 0.6 : 0.74);
  const cy = horizon + r;
  const cx = w / 2;
  const onEarth = (x: number) => ({ x, y: cy - Math.sqrt(r * r - (x - cx) ** 2) });
  const tpe = onEarth(w * (portrait ? 0.14 : 0.17));
  const sfo = onEarth(w * (portrait ? 0.86 : 0.83));
  const c = { x: w / 2, y: h * (portrait ? 0.22 : 0.16) };
  const d = `M${tpe.x.toFixed(1)} ${tpe.y.toFixed(1)} Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${sfo.x.toFixed(1)} ${sfo.y.toFixed(1)}`;

  // 二次貝茲曲線 → 弧長查表
  const bez = (t: number) => ({
    x: (1 - t) ** 2 * tpe.x + 2 * (1 - t) * t * c.x + t * t * sfo.x,
    y: (1 - t) ** 2 * tpe.y + 2 * (1 - t) * t * c.y + t * t * sfo.y,
  });
  const N = 200;
  const lut: number[] = [0];
  let prev = bez(0);
  for (let i = 1; i <= N; i++) {
    const p = bez(i / N);
    lut.push(lut[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  const total = lut[N];
  const at = (t: number) => {
    const target = Math.min(1, Math.max(0, t)) * total;
    let i = 1;
    while (i < N && lut[i] < target) i++;
    const f = (target - lut[i - 1]) / (lut[i] - lut[i - 1] || 1);
    return bez((i - 1 + f) / N);
  };

  const rand = rng(31);
  const stars = Array.from({ length: portrait ? 70 : 110 }, () => ({
    x: rand() * w,
    y: rand() * horizon * 0.95,
    r: 0.5 + rand() ** 3 * 1.4,
    o: 0.25 + rand() * 0.6,
  }));

  return {
    w,
    h,
    earth: { cx, cy, r },
    tpe,
    sfo,
    d,
    at,
    dawn: { x: sfo.x + w * 0.08, y: sfo.y },
    stars,
  };
}
