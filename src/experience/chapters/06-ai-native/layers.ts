/**
 * 章節 06 的三層內容配置（純資料）：全部以台灣輪廓的南北軸定位，動畫版與靜態 SVG 共用。
 *
 * 座標：x 向東、y 向南，本島南北長度 = 1（見 taiwan.ts）。
 * at(s, w)：s 為南北位置（-1 南端、1 北端），w 為該緯度內的東西位置（-1 西岸、1 東岸）；
 * 只要 |w| < 1 就一定落在島內，配置不必另外判斷海岸線。
 */
import { TAIWAN_MAIN } from './taiwan';

export type Pt = [number, number];
/** x, 高度, z, 樓層（樓層會乘上目前的層距） */
export type P4 = [number, number, number, number];

export type NodeKind = 'dot' | 'ring' | 'hub' | 'bright';
export interface GraphNode {
  p: Pt;
  /** 世界單位的視覺大小 */
  size: number;
  kind: NodeKind;
  /** 依 reveal 0–1 出現的時間 */
  start: number;
  /** 依 reveal 0–1 淡出；不淡出時 > 1 */
  end: number;
}
export interface GraphLink {
  a: Pt;
  b: Pt;
  bow: number;
  start: number;
  dur: number;
  end: number;
  strong: number;
}
export interface GraphLabel {
  /** 對應 YAML tags 的 key：'hub' 或 items 的索引 */
  key: 'hub' | number;
  p: Pt;
}
export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
  labels: GraphLabel[];
  docs: { p: Pt; start: number }[];
  /** 第三層的連續迴圈 */
  loop?: Pt[];
}

const SOUTH = 0.5;

/** 每條緯線上島的東西範圍（只看本島）。 */
function spanAt(y: number): [number, number] {
  const xs: number[] = [];
  const n = TAIWAN_MAIN.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = TAIWAN_MAIN[i * 2];
    const y0 = TAIWAN_MAIN[i * 2 + 1];
    const x1 = TAIWAN_MAIN[j * 2];
    const y1 = TAIWAN_MAIN[j * 2 + 1];
    if (y0 <= y === y1 <= y) continue;
    xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
  }
  if (xs.length < 2) return [0, 0];
  return [Math.min(...xs), Math.max(...xs)];
}

export function at(s: number, w: number): Pt {
  const y = -s * SOUTH * 0.97;
  const [a, b] = spanAt(y);
  return [(a + b) / 2 + (w * (b - a)) / 2, y];
}

export function inIsland(x: number, y: number) {
  const [a, b] = spanAt(y);
  return x >= a && x <= b;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEVER = 2;

/** 組織本身：規格、計畫、知識等文件節點連入共同的脈絡，不同參與者共享。 */
export function organization(): Graph {
  const hub = at(0.0, 0.02);
  const named: Pt[] = [at(0.62, 0.05), at(-0.08, -0.72), at(-0.56, 0.38)];
  const others: Pt[] = [at(0.24, 0.66), at(-0.82, -0.18)];
  const docs = [...named, ...others];
  const people: Pt[] = [
    at(0.86, -0.34),
    at(0.42, -0.62),
    at(0.44, 0.74),
    at(-0.3, 0.74),
    at(-0.34, -0.42),
    at(-0.74, 0.5),
    at(0.14, -0.38),
    at(-0.2, 0.34),
  ];
  const nodes: GraphNode[] = [{ p: hub, size: 0.86, kind: 'hub', start: 0.1, end: NEVER }];
  const links: GraphLink[] = [];
  docs.forEach((d, i) => {
    links.push({
      a: d,
      b: hub,
      bow: i % 2 ? 0.05 : -0.05,
      start: 0.02 + i * 0.07,
      dur: 0.32,
      end: NEVER,
      strong: 1,
    });
  });
  people.forEach((p, i) => {
    nodes.push({ p, size: 0.26, kind: 'ring', start: 0.42 + i * 0.03, end: NEVER });
    // 每位參與者連到最近的兩份文件：大家用同一份資訊
    const near = [...docs]
      .sort((a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1]))
      .slice(0, 2);
    near.forEach((d, k) => {
      links.push({
        a: p,
        b: d,
        bow: k ? 0.03 : -0.03,
        start: 0.5 + i * 0.03 + k * 0.04,
        dur: 0.22,
        end: NEVER,
        strong: 0.5,
      });
    });
  });
  return {
    nodes,
    links,
    docs: docs.map((p, i) => ({ p, start: 0.02 + i * 0.07 })),
    labels: [
      { key: 'hub', p: hub },
      { key: 0, p: named[0] },
      { key: 1, p: named[1] },
      { key: 2, p: named[2] },
    ],
  };
}

/** 產品本身：從各個領域出發探索 Agent as a Service，再收斂成產品。不是實際產品或案例。 */
export function product(): Graph {
  const problems: Pt[] = [at(0.8, -0.3), at(0.66, 0.46), at(0.5, -0.56), at(0.44, 0.12)];
  const options: Pt[] = [
    at(0.1, -0.68),
    at(0.16, -0.14),
    at(0.14, 0.52),
    at(-0.16, -0.46),
    at(-0.14, 0.14),
    at(-0.2, 0.7),
  ];
  const products: Pt[] = [at(-0.66, -0.2), at(-0.78, 0.22)];
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  problems.forEach((p, i) => {
    nodes.push({ p, size: 0.3, kind: 'ring', start: i * 0.05, end: NEVER });
  });
  // 哪些可能走得通：其餘的路徑在收斂時淡出
  const chosen = new Set([1, 3, 4]);
  options.forEach((p, i) => {
    const keep = chosen.has(i);
    nodes.push({
      p,
      size: 0.22,
      kind: 'dot',
      start: 0.22 + i * 0.04,
      end: keep ? NEVER : 0.78,
    });
  });
  const reach = [
    [0, 1, 3],
    [1, 2, 4],
    [0, 3],
    [1, 4, 5],
  ];
  reach.forEach((targets, i) => {
    for (const k of targets) {
      links.push({
        a: problems[i],
        b: options[k],
        bow: (i + k) % 2 ? 0.05 : -0.05,
        start: 0.1 + i * 0.05 + k * 0.025,
        dur: 0.26,
        end: chosen.has(k) ? NEVER : 0.74,
        strong: chosen.has(k) ? 1 : 0.6,
      });
    }
  });
  const next: [number, number][] = [
    [1, 0],
    [3, 0],
    [4, 1],
    [4, 0],
  ];
  for (const [k, t] of next) {
    links.push({
      a: options[k],
      b: products[t],
      bow: k % 2 ? 0.04 : -0.04,
      start: 0.58 + k * 0.03,
      dur: 0.26,
      end: NEVER,
      strong: 1.1,
    });
  }
  products.forEach((p, i) => {
    nodes.push({ p, size: 0.46, kind: 'bright', start: 0.76 + i * 0.06, end: NEVER });
  });
  return {
    nodes,
    links,
    docs: [],
    labels: [
      { key: 0, p: problems[0] },
      { key: 1, p: options[1] },
      { key: 2, p: products[0] },
    ],
  };
}

const LOOP_TURNS = 2.75;

/** 在島內沿 s/w 走的橢圓螺旋；每走一圈範圍變大，表達做一輪、改善一輪。 */
export function spiral(t: number): Pt {
  const turns = LOOP_TURNS * t;
  const th = turns * Math.PI * 2 - Math.PI / 2;
  const r = 0.3 + 0.56 * t;
  return at(r * Math.sin(th) * 0.98, r * Math.cos(th) * 1.02);
}

/** 產品的設計和開發：從市場調查一路到規格驅動開發。這是示意，不是組織規定的流程。 */
export function making(): Graph {
  const steps = 220;
  const loop: Pt[] = [];
  for (let i = 0; i <= steps; i++) loop.push(spiral(i / steps));
  // 五個站位平均分布在最外面一圈：市場調查 → 產品設計 → Pitch Deck → Funding Plan → 規格驅動開發
  const station = (q: number) => spiral((LOOP_TURNS - (4 - q) * 0.2) / LOOP_TURNS);
  const stations = [station(0), station(1), station(2), station(3), station(4)];
  const nodes: GraphNode[] = stations.map((p, i) => ({
    p,
    size: 0.3,
    kind: 'ring',
    start: 0.46 + i * 0.09,
    end: NEVER,
  }));
  nodes.push({ p: at(0, 0), size: 0.5, kind: 'bright', start: 0.1, end: NEVER });
  return {
    nodes,
    links: [],
    docs: [],
    loop,
    labels: stations.map((p, i) => ({ key: i, p })),
  };
}

export interface Field {
  points: Pt[];
  /** i, j, 依累積進度出現的時間 */
  links: [number, number, number][];
}

/** 散落全島的光點與島內連線：開場只亮少量，收尾累積到整座島。 */
export function field(count: number, seed = 7): Field {
  const r = rng(seed);
  const points: Pt[] = [];
  let guard = 0;
  while (points.length < count && guard++ < count * 200) {
    const s = r() * 2 - 1;
    const p = at(s * 0.95, (r() * 2 - 1) * 0.86);
    if (points.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.052)) continue;
    points.push(p);
  }
  const seen = new Set<string>();
  const links: [number, number, number][] = [];
  points.forEach((p, i) => {
    const near = points
      .map((q, j) => [Math.hypot(q[0] - p[0], q[1] - p[1]), j] as const)
      .filter(([, j]) => j !== i)
      .sort((a, b) => a[0] - b[0])
      .slice(0, 3);
    for (const [, j] of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([i, j, r()]);
    }
  });
  links.sort((a, b) => a[2] - b[2]);
  return { points, links };
}

function catmullPt(a: P4, b: P4, c: P4, d: P4, t: number): P4 {
  const f = (i: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * b[i] +
        (c[i] - a[i]) * t +
        (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t2 +
        (3 * b[i] - a[i] - 3 * c[i] + d[i]) * t3)
    );
  };
  return [f(0), f(1), f(2), f(3)];
}

/**
 * 一條連續的光線：由第一層往上，依序走過三層再離開第三層。
 * 回傳 [x, y, z, floor]，以及各層「被走到」時的進度（0–1）與經過的點。
 */
export function threadPath(L: number, samples = 420) {
  const on = (p: Pt, floor: number, lift = 0.04): P4 => [p[0] * L, lift, p[1] * L, floor];
  const org = organization();
  const prod = product();
  const waypoints: P4[] = [
    [at(-0.3, 0.1)[0] * L, -1.5, at(-0.3, 0.1)[1] * L, 0],
    on(at(-0.12, 0.05), 0, 0.2),
    on(org.nodes[0].p, 0),
    on(org.docs[0].p, 0),
    on(at(0.92, 0.1), 0),
    [at(1, 0.4)[0] * L + 0.3, 0.35, at(1, 0.4)[1] * L - 0.25, 0.5],
    on(at(0.92, 0.1), 1),
    on(prod.labels[0].p, 1),
    on(prod.labels[1].p, 1),
    on(at(-0.14, 0.14), 1),
    on(prod.labels[2].p, 1),
    on(at(-0.92, 0.1), 1),
    [at(-1, 0.4)[0] * L + 0.3, 0.35, at(-1, 0.4)[1] * L + 0.25, 1.5],
    on(at(-0.92, 0.1), 2),
    on(spiral(0.86), 2),
    on(spiral(0.74), 2),
    on(spiral(0.6), 2),
    on(at(0.12, 0), 2, 0.3),
    [at(0.2, -0.1)[0] * L, 1.4, at(0.2, -0.1)[1] * L, 2],
  ];
  const n = waypoints.length;
  const pts: P4[] = [];
  const perSeg = Math.ceil(samples / (n - 1));
  for (let i = 0; i < n - 1; i++) {
    const a = waypoints[Math.max(0, i - 1)];
    const b = waypoints[i];
    const c = waypoints[i + 1];
    const d = waypoints[Math.min(n - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) pts.push(catmullPt(a, b, c, d, k / perSeg));
  }
  pts.push(waypoints[n - 1]);
  // 依線段長度換算進度，光線頭部才會等速
  const SEP_REF = 1.12;
  const len = [0];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay, az, af] = pts[i - 1];
    const [bx, by, bz, bf] = pts[i];
    len.push(len[i - 1] + Math.hypot(bx - ax, by - ay + (bf - af) * SEP_REF, bz - az));
  }
  const total = len[len.length - 1];
  const along = len.map((v) => v / total);
  const when = (floor: number, x: number, z: number) => {
    let best = 0;
    let dist = Number.POSITIVE_INFINITY;
    pts.forEach((p, i) => {
      if (Math.abs(p[3] - floor) > 0.02) return;
      const d = Math.hypot(p[0] - x, p[2] - z);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return along[best];
  };
  const hits: { at: number; p: Pt }[] = [
    { at: when(0, org.nodes[0].p[0] * L, org.nodes[0].p[1] * L), p: org.nodes[0].p },
    { at: when(1, prod.labels[1].p[0] * L, prod.labels[1].p[1] * L), p: prod.labels[1].p },
    { at: when(2, spiral(0.74)[0] * L, spiral(0.74)[1] * L), p: spiral(0.74) },
  ];
  return { pts, along, hits };
}
