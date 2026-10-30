/**
 * 章節 06 的故事時間軸：把捲動位置換成故事時間 T，再由 T 算出整個場景的狀態。
 * 全部是純函式，畫面只取決於 T，所以停在中途、快速捲動、反向捲回都會得到同一個畫面。
 *
 * 文字段落（beat）的高度由 CSS 決定，這裡讀回實際位置當錨點；手機與桌機的捲動長度不同，
 * 故事時間不變：
 *
 *   T  0–1   開場：名字的原因（單層台灣，光點開始連接）
 *   T  1–2   台灣分成三層
 *   T  2–3   第一層 組織本身        T 3–4 往上
 *   T  4–5   第二層 產品本身        T 5–6 往上
 *   T  6–7   第三層 產品的設計和開發  T 7–8 拉回完整構圖
 *   T  8–9   光線貫穿三層
 *   T  9–10  鏡頭拉開，世界出現
 *   T 10–11  收尾
 */

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : Math.min(v, b));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const sineInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
export const outCubic = (t: number) => 1 - (1 - t) ** 3;

export const BEATS = ['open', 'l1', 'l2', 'l3', 'weave', 'close'] as const;
export type BeatId = (typeof BEATS)[number];

/** 一個 beat 的文字停靠區間（相對章節頂端的捲動量，px）。 */
export interface BeatSpan {
  /** 文字框剛好貼齊視窗 */
  a: number;
  /** 文字框開始離開 */
  b: number;
}

/** 每個 beat 的停靠起訖，依序對應 T = 0, 1, 2, … 11。 */
export function anchorsOf(spans: BeatSpan[]): number[] {
  const out: number[] = [];
  for (const s of spans) out.push(s.a, Math.max(s.b, s.a + 1));
  return out;
}

/** 捲動量 → 故事時間。頭尾之外依視窗高度外插，讓進場與離場仍有連續的變化。 */
export function storyTime(y: number, anchors: number[], vh: number): number {
  const n = anchors.length;
  if (y <= anchors[0]) return (y - anchors[0]) / vh;
  if (y >= anchors[n - 1]) return n - 1 + (y - anchors[n - 1]) / vh;
  let i = 0;
  while (i < n - 2 && y > anchors[i + 1]) i++;
  return i + (y - anchors[i]) / (anchors[i + 1] - anchors[i]);
}

export type Layout = 'side' | 'stack';

/** [T, 看向 x, y, z, 距離, 仰角°, 方位角°, 畫面位移 x, y（視窗比例）] */
type CamKey = [number, number, number, number, number, number, number, number, number];

export const SEP = 1.12;
const F1 = SEP;
const F2 = SEP * 2;

// 桌機：文字在左，島在右。鏡頭繞著三層往上走，每一層都換一個方位。
const SIDE: CamKey[] = [
  [-1.0, 0, 0, 0, 9.4, 85, 0, 0.17, 0],
  [0.0, 0, 0, 0, 8.3, 85, 0, 0.17, 0],
  [1.0, 0, 0, 0, 7.6, 78, 6, 0.17, 0],
  [2.0, 0, 0.92, 0.05, 10.2, 44, 26, 0.17, 0.0],
  [3.0, 0, 0.92, 0.02, 9.8, 42, 21, 0.17, 0.0],
  [4.0, 0, F1, 0.05, 9.9, 44, 42, 0.16, 0.0],
  [5.0, 0, F1, 0.02, 9.5, 42, 37, 0.16, 0.0],
  [6.0, 0, F2 - 0.5, 0.05, 9.9, 46, 58, 0.16, 0.0],
  [7.0, 0, F2 - 0.5, 0.02, 9.5, 44, 53, 0.16, 0.0],
  [8.0, 0, F1 + 0.1, 0, 11.6, 28, 40, 0.18, 0.0],
  [9.0, 0, F1 + 0.15, 0, 10.8, 31, 24, 0.18, 0.0],
  [10.0, 0, 0.7, 0, 13.6, 25, 34, 0.2, 0.13],
  [11.0, 0, 0.65, 0, 13.0, 26, 28, 0.2, 0.13],
];

// 手機：島在上半部，文字在下半部。島本來就是直的，比桌機更貼近正上方俯視。
const STACK: CamKey[] = [
  [-1.0, 0, 0, 0, 14.2, 86, 0, 0, -0.21],
  [0.0, 0, 0, 0, 12.8, 86, 0, 0, -0.21],
  [1.0, 0, 0, 0, 12.0, 80, 5, 0, -0.21],
  [2.0, 0, 0.8, 0.05, 14.0, 50, 14, 0, -0.2],
  [3.0, 0, 0.8, 0.02, 13.6, 48, 10, 0, -0.2],
  [4.0, 0, F1, 0.05, 14.0, 50, 24, 0, -0.2],
  [5.0, 0, F1, 0.02, 13.6, 48, 20, 0, -0.2],
  [6.0, 0, F2 - 0.4, 0.05, 14.0, 52, 34, 0, -0.2],
  [7.0, 0, F2 - 0.4, 0.02, 13.6, 50, 30, 0, -0.2],
  [8.0, 0, F1 + 0.1, 0, 15.4, 28, 34, 0, -0.17],
  [9.0, 0, F1 + 0.15, 0, 14.6, 31, 18, 0, -0.17],
  [10.0, 0, 0.8, 0, 19.0, 24, 30, 0, -0.13],
  [11.0, 0, 0.75, 0, 18.2, 25, 24, 0, -0.13],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export interface CamState {
  tx: number;
  ty: number;
  tz: number;
  dist: number;
  elev: number;
  az: number;
  sx: number;
  sy: number;
}

export function camAt(T: number, layout: Layout): CamState {
  const K = layout === 'side' ? SIDE : STACK;
  const n = K.length;
  const t0 = clamp(T, K[0][0], K[n - 1][0]);
  let i = 0;
  while (i < n - 2 && t0 > K[i + 1][0]) i++;
  const a = K[Math.max(0, i - 1)];
  const b = K[i];
  const c = K[i + 1];
  const d = K[Math.min(n - 1, i + 2)];
  const t = clamp((t0 - b[0]) / (c[0] - b[0]));
  const at = (col: number) => catmull(a[col], b[col], c[col], d[col], t);
  return {
    tx: at(1),
    ty: at(2),
    tz: at(3),
    dist: at(4),
    elev: at(5),
    az: at(6),
    sx: at(7),
    sy: at(8),
  };
}

export interface SceneState {
  /** 三層的層距 */
  sep: number;
  /** 上面兩層從第一層分出來的程度 0–1 */
  peel: number;
  /** 三層各自的亮度（0.4 = 仍可辨識的背景層，1 = 焦點） */
  focus: [number, number, number];
  /** 三層內容畫出來的程度 */
  reveal: [number, number, number];
  /** 海岸線亮度 */
  rim: number;
  /** 光線頭部 0–1 */
  thread: number;
  /** 光線貫穿時的光柱 */
  column: number;
  /** 世界出現的程度 */
  world: number;
  /** 向外的連線 */
  arcs: number;
  /** 島內連線累積的程度 */
  net: number;
  /** 島內點線的亮度 */
  netAlpha: number;
}

/** 三層都回到同等亮度的時刻 */
const WHOLE_FROM = 7.15;

function focusOf(T: number, at: number) {
  const on = smooth(range(T, at - 1.0, at - 0.1));
  const off = 1 - smooth(range(T, at + 1.15, at + 1.9));
  return Math.max(on * off, 0);
}

export function stateAt(T: number): SceneState {
  const peel = smooth(range(T, 1.0, 1.85));
  const collapse = smooth(range(T, 9.0, 10.2));
  const sep = SEP * peel * mix(1, 0.72, collapse);
  const whole = smooth(range(T, WHOLE_FROM, 8));
  const dimFloor = 0.42;
  const focus = [focusOf(T, 2), focusOf(T, 4), focusOf(T, 6)].map((f, i) => {
    const base = i === 0 ? mix(1, dimFloor, smooth(range(T, 1.2, 2.4))) : dimFloor;
    return mix(Math.max(base, f), 0.92, whole);
  }) as [number, number, number];
  // 開場時只有第一層，其餘兩層從它分離才亮起
  focus[1] *= peel;
  focus[2] *= peel;
  const reveal: [number, number, number] = [
    range(T, 1.75, 2.95),
    range(T, 3.75, 4.95),
    range(T, 5.75, 6.95),
  ];
  const thread = sineInOut(range(T, 7.55, 9.1));
  const column = smooth(range(T, 8.05, 8.9)) * (1 - smooth(range(T, 9.25, 10.15)));
  const world = smooth(range(T, 8.95, 10.35));
  const arcs = range(T, 9.2, 10.7);
  // 光點先分散，隨捲動出現少量連結；到最後累積成整座島的連線
  const net = mix(0.16 * smooth(range(T, 0.2, 1)), 1, smooth(range(T, 9.35, 10.9)));
  const netAlpha = Math.max(
    smooth(range(T, -0.6, 0.45)) * (1 - smooth(range(T, 1.1, 2))),
    smooth(range(T, 9.2, 10)),
  );
  const rim = smooth(range(T, -0.8, 0.7));
  return { sep, peel, focus, reveal, rim, thread, column, world, arcs, net, netAlpha };
}

/** 版面：與 Chapter.astro 的 media query 同一個條件 */
export function layoutOf(w: number, h: number): Layout {
  return w >= 900 && w / h >= 1.05 ? 'side' : 'stack';
}
