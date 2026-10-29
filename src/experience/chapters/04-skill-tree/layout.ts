// 章節 04 技能樹的星圖版面：伺服器端產生 SVG，瀏覽器端用同一份資料決定點亮順序。
// 座標系：viewBox 0 0 1000 1000，中心 (500, 500)。

export type NodeKind = 'root' | 'small' | 'notable' | 'build';

export interface TreeNode {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
  branch: number; // -1 = 中心
  /** 從中心算起的步數（點亮順序） */
  depth: number;
  buildId?: string;
}

export interface TreeEdge {
  id: string;
  from: string;
  to: string;
  d: string;
  branch: number;
  /** 0–1：在整體點亮進度中的開始與結束 */
  t0: number;
  t1: number;
}

export interface Tree {
  nodes: TreeNode[];
  edges: TreeEdge[];
  /** 分支名稱標籤的位置與對齊方向（-1 靠右對齊、1 靠左對齊、0 置中） */
  branchAnchors: { x: number; y: number; angle: number; align: -1 | 0 | 1 }[];
}

const C = 500;
const deg = (d: number) => (d * Math.PI) / 180;
const r1 = (n: number) => Math.round(n * 10) / 10;

export const BRANCH_ANGLES = [-90, 30, 150];
/** 分支名稱放在星輪的哪一側（+1：角度 +90°），另一側放小支線 */
const LABEL_SIDE = [-1, -1, 1];

export function buildTree(buildIdsByBranch: (string | undefined)[]): Tree {
  const nodes: TreeNode[] = [];
  const edges: { from: string; to: string; d?: string; branch: number }[] = [];
  const add = (n: Omit<TreeNode, 'depth'>) => {
    nodes.push({ ...n, x: r1(n.x), y: r1(n.y), depth: 0 });
    return n.id;
  };
  const polar = (angle: number, r: number, ox = C, oy = C) => ({
    x: ox + Math.cos(deg(angle)) * r,
    y: oy + Math.sin(deg(angle)) * r,
  });

  add({ id: 'root', ...polar(0, 0), kind: 'root', branch: -1 });

  const anchors: Tree['branchAnchors'] = [];

  BRANCH_ANGLES.forEach((a, b) => {
    const P = (ang: number, r: number) => polar(a + ang, r);
    // 入口（分支名稱的位置）
    const g = add({ id: `b${b}-gate`, ...P(0, 118), kind: 'notable', branch: b });
    const ls = LABEL_SIDE[b];
    edges.push({ from: 'root', to: g, branch: b });
    // 主幹
    const s1 = add({ id: `b${b}-s1`, ...P(-4, 172), kind: 'small', branch: b });
    const s2 = add({ id: `b${b}-s2`, ...P(4, 222), kind: 'small', branch: b });
    edges.push({ from: g, to: s1, branch: b }, { from: s1, to: s2, branch: b });

    // 星輪（流亡黯道式的節點環）
    const wc = P(0, 312);
    const R = 58;
    const ring: string[] = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const ang = a + 180 + (360 / N) * i; // 第 0 個朝向中心
      const p = polar(ang, R, wc.x, wc.y);
      ring.push(add({ id: `b${b}-w${i}`, ...p, kind: 'small', branch: b }));
    }
    const wcId = add({ id: `b${b}-wc`, ...wc, kind: 'notable', branch: b });
    edges.push({ from: s2, to: ring[0], branch: b });
    // 環上兩個方向同時往外走（弧線）
    const arc = (i: number, j: number, sweep: 0 | 1) => {
      const p = nodes.find((n) => n.id === ring[i])!;
      const q = nodes.find((n) => n.id === ring[j])!;
      return `M${p.x} ${p.y} A${R} ${R} 0 0 ${sweep} ${q.x} ${q.y}`;
    };
    for (let i = 0; i < N / 2; i++) {
      edges.push({ from: ring[i], to: ring[i + 1], d: arc(i, i + 1, 1), branch: b });
      const ccwFrom = i === 0 ? 0 : N - i;
      const ccwTo = N - i - 1;
      if (ccwTo !== N / 2 || i === N / 2 - 1) {
        edges.push({ from: ring[ccwFrom], to: ring[ccwTo], d: arc(ccwFrom, ccwTo, 0), branch: b });
      }
    }
    // 星輪中心從最外側的環節點連入
    edges.push({ from: ring[N / 2], to: wcId, branch: b });

    // 往外到流派節點
    const e1 = add({ id: `b${b}-e1`, ...P(-3, 405), kind: 'small', branch: b });
    const e2 = add({ id: `b${b}-e2`, ...P(3, 440), kind: 'small', branch: b });
    const k = add({
      id: `b${b}-build`,
      ...P(0, 476),
      kind: 'build',
      branch: b,
      buildId: buildIdsByBranch[b],
    });
    edges.push(
      { from: ring[N / 2], to: e1, branch: b },
      { from: e1, to: e2, branch: b },
      { from: e2, to: k, branch: b },
    );

    // 分支名稱：星輪旁、朝外的一側
    {
      const la = a + ls * 90;
      const lp = polar(la, 92, wc.x, wc.y);
      const cx = Math.cos(deg(la));
      anchors.push({
        x: r1(lp.x),
        y: r1(lp.y),
        angle: a,
        align: Math.abs(cx) < 0.3 ? 0 : cx > 0 ? 1 : -1,
      });
    }
    // 另一側的小支線
    for (const side of [-ls]) {
      const o1 = add({ id: `b${b}-o${side}1`, ...P(side * 17, 238), kind: 'small', branch: b });
      const o2 = add({ id: `b${b}-o${side}2`, ...P(side * 27, 262), kind: 'small', branch: b });
      const o3 = add({ id: `b${b}-o${side}3`, ...P(side * 33, 300), kind: 'notable', branch: b });
      edges.push(
        { from: s2, to: o1, branch: b },
        { from: o1, to: o2, branch: b },
        { from: o2, to: o3, branch: b },
      );
    }
    // 入口兩側的小節點
    for (const side of [-1, 1]) {
      const m = add({ id: `b${b}-m${side}`, ...P(side * 24, 150), kind: 'small', branch: b });
      edges.push({ from: g, to: m, branch: b });
    }
  });

  // 內圈：把三個入口串起來（不在點亮路徑上，最後才點亮）
  const inner: { from: string; to: string; d: string }[] = [];
  BRANCH_ANGLES.forEach((a, b) => {
    const next = (b + 1) % 3;
    const p = polar(a, 118);
    const q = polar(BRANCH_ANGLES[next], 118);
    inner.push({
      from: `b${b}-gate`,
      to: `b${next}-gate`,
      d: `M${r1(p.x)} ${r1(p.y)} A118 118 0 0 1 ${r1(q.x)} ${r1(q.y)}`,
    });
  });

  // 深度（BFS）
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const queue = ['root'];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of adj.get(id) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      byId.get(to)!.depth = byId.get(id)!.depth + 1;
      queue.push(to);
    }
  }

  // 每個分支依序點亮；分支內依深度
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const span = 1 / 3;
  const outEdges: TreeEdge[] = edges.map((e, i) => {
    const from = byId.get(e.from)!;
    const local0 = (from.depth / maxDepth) * 0.92;
    const local1 = ((from.depth + 1) / maxDepth) * 0.92;
    const base = e.branch * span;
    return {
      id: `e${i}`,
      from: e.from,
      to: e.to,
      branch: e.branch,
      d: e.d ?? `M${from.x} ${from.y} L${byId.get(e.to)!.x} ${byId.get(e.to)!.y}`,
      t0: base + local0 * span,
      t1: base + local1 * span,
    };
  });
  inner.forEach((e, i) => {
    outEdges.push({ id: `i${i}`, from: e.from, to: e.to, branch: -1, d: e.d, t0: 0.97, t1: 1 });
  });

  return { nodes, edges: outEdges, branchAnchors: anchors };
}

/** 背景星點（確定性） */
export function starfield(count: number, seed = 4) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: r1(r() * 1000),
    y: r1(r() * 1000),
    r: r1(0.4 + r() ** 3 * 1.6),
    o: Math.round((0.15 + r() * 0.5) * 100) / 100,
  }));
}
