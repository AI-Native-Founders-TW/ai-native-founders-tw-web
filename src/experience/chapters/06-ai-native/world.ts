/**
 * 章節 06 的 WebGL 場景（只在章節接近時 dynamic import，Three.js 不進首屏）。
 *
 * 同一個世界從頭到尾沒有換場：台灣輪廓分成三層玻璃島體，鏡頭沿著三層往上走，
 * 一條光線貫穿三層後拉開鏡頭；海岸線的等距線往外擴散，同一片海面變成世界。
 *
 * 畫面組成（由遠到近）：
 *   天空（星塵、大氣邊緣）→ 世界球面（陸地點陣、海岸等距線）→ 三層島體（玻璃、海岸線、內容）
 *   → 貫穿光線與光柱 → 島內連線 → 向外連線。
 *
 * 除了環境的緩慢流動，畫面只取決於 story.ts 的狀態；線條全部是螢幕空間寬度的帶狀幾何，
 * 光暈用解析式計算（不做全螢幕 blur），低階裝置不會被後處理拖慢。
 */
import * as THREE from 'three';
import {
  at,
  field,
  type Graph,
  making,
  organization,
  type P4,
  type Pt,
  product,
  threadPath,
} from './layers';
import { camAt, clamp, type Layout, mix, range, SEP, smooth, stateAt } from './story';
import { TAIWAN_CENTER, TAIWAN_ISLETS, TAIWAN_MAIN } from './taiwan';

/** 本島南北長度（世界單位） */
export const L = 3.5;
const R = 17;
const SEA = -1.15;

const COLOR = {
  night: new THREE.Color(0x070a26),
  lav: new THREE.Color(0xceabfd),
  lav1: new THREE.Color(0xdecffe),
  iris: new THREE.Color(0x4d47fe),
  periwinkle: new THREE.Color(0x8d8bff),
  royal: new THREE.Color(0x1e47f3),
  sky: new THREE.Color(0x19acfe),
  sky2: new THREE.Color(0x8fd8ff),
  snow: new THREE.Color(0xf6fbfc),
};

const TINT = [
  { a: COLOR.lav, b: COLOR.lav1 },
  { a: COLOR.periwinkle, b: COLOR.sky2 },
  { a: COLOR.sky, b: COLOR.sky2 },
];

const GLSL_COMMON = /* glsl */ `
const vec3 NIGHT = vec3(0.027, 0.039, 0.149);
const vec3 VIOLET = vec3(0.22, 0.047, 0.455);
const vec3 ROYAL = vec3(0.118, 0.278, 0.953);
const vec3 IRIS = vec3(0.302, 0.278, 0.996);
const vec3 SKY = vec3(0.098, 0.675, 0.996);
const vec3 LAV1 = vec3(0.871, 0.812, 0.996);
const vec3 SNOW = vec3(0.965, 0.984, 0.988);
float sq(float x) { return x * x; }
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// ── 帶狀線 ─────────────────────────────────────────────────

interface RibbonPath {
  pts: (P4 | [number, number, number])[];
  start?: number;
  dur?: number;
  end?: number;
  seed?: number;
  /** 半寬（CSS px，含光暈） */
  width?: number;
  tint?: number;
  closed?: boolean;
  /** 算方向時前後各看幾個點；海岸線的小轉折在斜角時才不會把線翻過來 */
  span?: number;
}

function ribbonGeometry(paths: RibbonPath[]) {
  let verts = 0;
  let tris = 0;
  for (const p of paths) {
    const n = p.pts.length + (p.closed ? 1 : 0);
    verts += n * 2;
    tris += (n - 1) * 2;
  }
  const pos = new Float32Array(verts * 3);
  const prev = new Float32Array(verts * 4);
  const next = new Float32Array(verts * 4);
  const floor = new Float32Array(verts);
  const side = new Float32Array(verts);
  const along = new Float32Array(verts);
  const width = new Float32Array(verts);
  const tint = new Float32Array(verts);
  const meta = new Float32Array(verts * 4);
  const index = new Uint32Array(tris * 3);
  let v = 0;
  let idx = 0;
  for (const path of paths) {
    const src = path.closed ? [...path.pts, path.pts[0]] : path.pts;
    const n = src.length;
    // 依實際長度分配 along，曲線上的揭露才會等速
    const len = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const a = src[i - 1];
      const b = src[i];
      len[i] = len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const total = len[n - 1] || 1;
    const first = v;
    for (let i = 0; i < n; i++) {
      const c = src[i];
      const k0 = path.span ?? 1;
      const m = n - 1;
      const a = src[path.closed ? (i - k0 + m * 2) % m : Math.max(0, i - k0)];
      const b = src[path.closed ? (i + k0) % m : Math.min(m, i + k0)];
      for (let k = 0; k < 2; k++) {
        pos.set([c[0], c[1], c[2]], v * 3);
        prev.set([a[0], a[1], a[2], a[3] ?? 0], v * 4);
        next.set([b[0], b[1], b[2], b[3] ?? 0], v * 4);
        floor[v] = c[3] ?? 0;
        side[v] = k ? 1 : -1;
        along[v] = len[i] / total;
        width[v] = path.width ?? 5;
        tint[v] = path.tint ?? 0;
        meta.set([path.start ?? 0, path.dur ?? 1, path.end ?? 2, path.seed ?? 0], v * 4);
        v++;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = first + i * 2;
      index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], idx);
      idx += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPrev', new THREE.BufferAttribute(prev, 4));
  g.setAttribute('aNext', new THREE.BufferAttribute(next, 4));
  g.setAttribute('aFloor', new THREE.BufferAttribute(floor, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  g.setAttribute('aWidth', new THREE.BufferAttribute(width, 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  g.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

const ribbonVert = /* glsl */ `
attribute vec4 aPrev, aNext, aMeta;
attribute float aFloor, aSide, aAlong, aWidth, aTint;
uniform float uSep, uPx;
uniform vec2 uRes;
varying float vSide, vAlong, vTint, vW;
varying vec4 vMeta;
vec4 toClip(vec3 p, float f) {
  return projectionMatrix * modelViewMatrix * vec4(p.x, p.y + f * uSep, p.z, 1.0);
}
void main() {
  vec4 c = toClip(position, aFloor);
  vec4 a = toClip(aPrev.xyz, aPrev.w);
  vec4 b = toClip(aNext.xyz, aNext.w);
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 sa = a.xy / max(a.w, 0.001) * asp;
  vec2 sb = b.xy / max(b.w, 0.001) * asp;
  vec2 dir = sb - sa;
  float l = length(dir);
  dir = l > 1e-5 ? dir / l : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float w = aWidth * uPx;
  c.xy += n / asp * aSide * w * 2.0 / uRes.y * c.w;
  gl_Position = c;
  vSide = aSide; vAlong = aAlong; vTint = aTint; vW = aWidth; vMeta = aMeta;
}`;

const ribbonFrag = /* glsl */ `
uniform vec3 uA, uB;
uniform float uAlpha, uReveal, uTime, uFlow, uFlowF, uFlowS, uTip, uCore, uHalo, uEnds;
uniform vec3 uMask;
uniform vec2 uRes;
varying float vSide, vAlong, vTint, vW;
varying vec4 vMeta;
void main() {
  float start = vMeta.x, dur = vMeta.y, endAt = vMeta.z, seed = vMeta.w;
  float local = clamp((uReveal - start) / max(dur, 0.0001), 0.0, 1.0);
  if (local <= 0.0) discard;
  float vis = 1.0 - smoothstep(local - 0.006, local + 0.002, vAlong);
  float fade = 1.0 - smoothstep(endAt, endAt + 0.1, uReveal);
  float e = abs(vSide);
  float x = e * vW;
  float core = exp(-x * x / uCore);
  float halo = exp(-x / max(vW * 0.34, 0.6)) * (1.0 - e);
  float tip = uTip * exp(-sq((vAlong - local) / 0.018)) * step(local, 0.9995);
  float bead = uFlow * pow(0.5 + 0.5 * sin(vAlong * uFlowF - uTime * uFlowS + seed * 6.283), 28.0);
  float body = core + halo * uHalo;
  vec3 col = mix(uA, uB, vTint);
  vec3 rgb = col * body * (1.0 + bead * 2.2) + SNOW * core * (tip * 2.2 + bead * 0.8) + col * halo * tip * 1.4;
  // 線的頭尾收細，不留切斷的端點
  float ends = mix(1.0, smoothstep(0.0, 0.05, vAlong) * (1.0 - smoothstep(0.93, 1.0, vAlong)), uEnds);
  // 畫面上文字所在的區域：線在進入前就淡出
  vec2 sc = gl_FragCoord.xy / uRes;
  float mask = uMask.z > 0.5 ? smoothstep(uMask.x, uMask.y, sc.x) : (uMask.z < -0.5 ? smoothstep(uMask.x, uMask.y, sc.y) : 1.0);
  gl_FragColor = vec4(rgb * vis * fade * ends * mask * uAlpha, 1.0);
}`;

function ribbonMaterial(
  common: Record<string, THREE.IUniform>,
  a: THREE.Color,
  b: THREE.Color,
  o: {
    core?: number;
    halo?: number;
    flow?: number;
    flowF?: number;
    flowS?: number;
    tip?: number;
    ends?: number;
  } = {},
) {
  return new THREE.ShaderMaterial({
    vertexShader: ribbonVert,
    fragmentShader: GLSL_COMMON + ribbonFrag,
    uniforms: {
      uRes: common.uRes,
      uPx: common.uPx,
      uTime: common.uTime,
      uSep: { value: 0 },
      uA: { value: a },
      uB: { value: b },
      uAlpha: { value: 1 },
      uReveal: { value: 1 },
      uFlow: { value: o.flow ?? 0 },
      uFlowF: { value: o.flowF ?? 18 },
      uFlowS: { value: o.flowS ?? 1.6 },
      uTip: { value: o.tip ?? 0 },
      uCore: { value: o.core ?? 1.2 },
      uHalo: { value: o.halo ?? 0.4 },
      uEnds: { value: o.ends ?? 0 },
      uMask: { value: new THREE.Vector3(0, 1, 0) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // 帶狀線的繞向取決於行進方向，不能做背面剔除
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ── 點 ─────────────────────────────────────────────────────

interface PointSpec {
  x: number;
  y: number;
  z: number;
  floor?: number;
  size: number;
  kind: number;
  start: number;
  end?: number;
  tint?: number;
  seed?: number;
}

function pointsGeometry(list: PointSpec[]) {
  const pos = new Float32Array(list.length * 3);
  const size = new Float32Array(list.length);
  const kind = new Float32Array(list.length);
  const meta = new Float32Array(list.length * 4);
  const floor = new Float32Array(list.length);
  list.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    size[i] = p.size;
    kind[i] = p.kind;
    floor[i] = p.floor ?? 0;
    meta.set([p.start, p.end ?? 2, p.tint ?? 0, p.seed ?? i * 0.37], i * 4);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('aFloor', new THREE.BufferAttribute(floor, 1));
  g.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4));
  return g;
}

const pointsVert = /* glsl */ `
attribute float aSize, aKind, aFloor;
attribute vec4 aMeta;
uniform float uScale, uReveal, uSep, uTime;
varying float vKind, vVis, vTint, vTw;
void main() {
  vec4 mv = modelViewMatrix * vec4(position.x, position.y + aFloor * uSep, position.z, 1.0);
  float vis = smoothstep(aMeta.x, aMeta.x + 0.07, uReveal) * (1.0 - smoothstep(aMeta.y, aMeta.y + 0.1, uReveal));
  vVis = vis; vKind = aKind; vTint = aMeta.z;
  vTw = 0.82 + 0.18 * sin(uTime * (0.7 + fract(aMeta.w * 7.0)) + aMeta.w * 19.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vis > 0.001 ? aSize * uScale / -mv.z : 0.0;
}`;

const pointsFrag = /* glsl */ `
uniform vec3 uA, uB;
uniform float uAlpha;
varying float vKind, vVis, vTint, vTw;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float e = 1.0 - r;
  float glow = e * e * 0.5;
  float core = 0.0, whiteCore = 0.0;
  if (vKind < 0.5) { // 光點
    core = exp(-r * r * 90.0);
    whiteCore = core;
  } else if (vKind < 1.5) { // 空心環：等待被回答的問題、參與者
    core = exp(-sq((r - 0.34) / 0.035)) * 1.1 + 0.08 * step(r, 0.34);
    glow *= 0.55;
  } else if (vKind < 2.5) { // 共同的脈絡：中心＋外環
    core = exp(-r * r * 60.0) * 1.6 + exp(-sq((r - 0.2) / 0.012)) * 0.9 + exp(-sq((r - 0.44) / 0.008)) * 0.35;
    whiteCore = exp(-r * r * 90.0);
    glow *= 1.3;
  } else { // 成形的產品：菱形
    float d = abs(q.x) + abs(q.y);
    core = (1.0 - smoothstep(0.17, 0.19, d)) * 1.2 + exp(-sq((d - 0.32) / 0.012)) * 0.55;
    whiteCore = 1.0 - smoothstep(0.1, 0.17, d);
    glow *= 1.2;
  }
  vec3 col = mix(uA, uB, vTint);
  vec3 rgb = col * (core + glow) + SNOW * whiteCore;
  gl_FragColor = vec4(rgb * vVis * vTw * uAlpha, 1.0);
}`;

function pointsMaterial(common: Record<string, THREE.IUniform>, a: THREE.Color, b: THREE.Color) {
  return new THREE.ShaderMaterial({
    vertexShader: pointsVert,
    fragmentShader: GLSL_COMMON + pointsFrag,
    uniforms: {
      uScale: common.uScale,
      uTime: common.uTime,
      uSep: { value: 0 },
      uA: { value: a },
      uB: { value: b },
      uAlpha: { value: 1 },
      uReveal: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ── 距離場：海岸線內外的等距線 ─────────────────────────────

/** Felzenszwalb 距離轉換（一維）；輸入輸出都是距離平方。 */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

function edt2d(grid: Float64Array, n: number) {
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = grid[y * n + x];
    edt1d(f, n, d, v, z);
    for (let y = 0; y < n; y++) grid[y * n + x] = d[y];
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) f[x] = grid[y * n + x];
    edt1d(f, n, d, v, z);
    for (let x = 0; x < n; x++) grid[y * n + x] = d[x];
  }
}

/** 正值在島內。half：涵蓋範圍（島的單位），回傳 half float 紋理。 */
function signedField(n: number, half: number) {
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = '#fff';
  const toPx = (v: number) => ((v + half) / (2 * half)) * n;
  const trace = (ring: number[]) => {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i += 2) ctx.lineTo(toPx(ring[i]), toPx(ring[i + 1]));
    ctx.closePath();
    ctx.fill();
  };
  trace(TAIWAN_MAIN);
  for (const r of TAIWAN_ISLETS) trace(r);
  const px = ctx.getImageData(0, 0, n, n).data;
  const inside = new Float64Array(n * n);
  const outside = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const on = px[i * 4] > 127;
    inside[i] = on ? 1e20 : 0;
    outside[i] = on ? 0 : 1e20;
  }
  edt2d(inside, n);
  edt2d(outside, n);
  const unit = (2 * half) / n;
  const data = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const d = (Math.sqrt(inside[i]) - Math.sqrt(outside[i])) * unit;
    data[i] = THREE.DataUtils.toHalfFloat(d);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ── 場景 ───────────────────────────────────────────────────

function islandShapes() {
  const toShape = (ring: number[]) => {
    const s = new THREE.Shape();
    for (let i = 0; i < ring.length; i += 2) {
      const x = ring[i] * L;
      const y = ring[i + 1] * L;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  };
  return [toShape(TAIWAN_MAIN), ...TAIWAN_ISLETS.map(toShape)];
}

// 文件小卡的方向：面向第一層聚焦時的鏡頭
const DOC_AZ = (30 * Math.PI) / 180;
const DOC_EL = (34 * Math.PI) / 180;
const DOC_RIGHT = [Math.cos(DOC_AZ), 0, -Math.sin(DOC_AZ)];
const DOC_UP = [
  -Math.sin(DOC_EL) * Math.sin(DOC_AZ),
  Math.cos(DOC_EL),
  -Math.sin(DOC_EL) * Math.cos(DOC_AZ),
];

const ringPts = (ring: number[], y: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) out.push([ring[i] * L, y, ring[i + 1] * L]);
  return out;
};

/** 兩點之間略微彎曲的曲線，貼在島面上。 */
function curve(a: Pt, b: Pt, bow: number, lift: number, n = 14): [number, number, number][] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const cx = mx - dy * bow * 3;
  const cy = my + dx * bow * 3;
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      (u * u * a[0] + 2 * u * t * cx + t * t * b[0]) * L,
      lift + Math.sin(t * Math.PI) * 0.03,
      (u * u * a[1] + 2 * u * t * cy + t * t * b[1]) * L,
    ]);
  }
  return out;
}

// 向外連線的淡出區：[起, 迄, 軸]；軸 1 = 由左到右，-1 = 由下到上（gl_FragCoord 的 y 向上）
const MASK_SIDE: [number, number, number] = [0.5, 0.62, 1];
const MASK_STACK: [number, number, number] = [0.46, 0.56, -1];

export interface WorldOptions {
  quality: 'high' | 'mid';
  layout: Layout;
}

export interface TagAnchor {
  id: string;
  floor: number;
  p: Pt;
  lift: number;
}

export function createWorld(canvas: HTMLCanvasElement, opt: WorldOptions) {
  const high = opt.quality === 'high';
  const dpr = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: dpr < 1.5,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x070a26, 1);
  let pixelCap = high ? 1.75 : 1.5;
  renderer.setPixelRatio(Math.min(dpr, pixelCap));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  const common: Record<string, THREE.IUniform> = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uPx: { value: renderer.getPixelRatio() },
    uTime: { value: 0 },
    uScale: { value: 1 },
  };
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T) => {
    disposables.push(o);
    return o;
  };

  // 距離場：近場給島面，遠場給海面
  const NEAR_HALF = 0.72;
  const FAR_HALF = 3.2;
  const sdfNear = own(signedField(high ? 340 : 256, NEAR_HALF));
  const sdfFar = own(signedField(200, FAR_HALF));

  const land = own(new THREE.Texture());
  land.minFilter = THREE.NearestFilter;
  land.magFilter = THREE.NearestFilter;
  land.generateMipmaps = false;
  land.colorSpace = THREE.NoColorSpace;

  // ── 天空 ──
  const skyUniforms = {
    uTime: common.uTime,
    uInv: { value: new THREE.Matrix4() },
    uCam: { value: new THREE.Vector3() },
    uCenter: { value: new THREE.Vector3(0, SEA - R, 0) },
    uRadius: { value: R },
    uWorld: { value: 0 },
    uDim: { value: 1 },
    uGlow: { value: new THREE.Vector3(0, 1, 0) },
  };
  const sky = new THREE.Mesh(
    own(new THREE.PlaneGeometry(2, 2)),
    own(
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec2 vNdc;
          void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
        fragmentShader:
          GLSL_COMMON +
          /* glsl */ `
          uniform mat4 uInv; uniform vec3 uCam, uCenter, uGlow; uniform float uRadius, uWorld, uDim, uTime;
          varying vec2 vNdc;
          float stars(vec3 d, float scale, float cut) {
            // 依視線主軸選投影面，俯視時星點不會被拉成條紋
            vec3 a = abs(d);
            vec2 p = (a.y > a.x && a.y > a.z ? d.xz / a.y : (a.x > a.z ? d.yz / a.x : d.xy / a.z)) * scale;
            vec2 c = floor(p);
            float h = hash(c);
            vec2 sp = c + 0.5 + (vec2(hash(c + 3.1), hash(c + 7.7)) - 0.5) * 0.8;
            float s = smoothstep(0.09, 0.0, length(p - sp)) * step(cut, h);
            return s * (0.55 + 0.45 * sin(uTime * (0.6 + h * 2.0) + h * 40.0));
          }
          void main() {
            vec4 f = uInv * vec4(vNdc, 1.0, 1.0);
            vec3 rd = normalize(f.xyz / f.w - uCam);
            vec3 col = NIGHT * 0.86;
            // 冷暗的層次：紫在下、藍在上方遠處，不與文字搶對比
            float elev = rd.y;
            col += VIOLET * 0.26 * exp(-sq((elev + 0.22) / 0.42));
            col += ROYAL * 0.10 * exp(-sq((elev - 0.4) / 0.5));
            float st = stars(rd, 26.0, 0.9) + stars(rd, 54.0, 0.94) * 0.6;
            col += mix(LAV1, SKY, 0.35) * st * 0.42 * uDim;
            // 大氣邊緣：只在世界出現時亮起
            vec3 oc = uCam - uCenter;
            float b = dot(oc, rd);
            float c2 = max(dot(oc, oc) - b * b, 0.0);
            float x = sqrt(c2) - uRadius;
            float limb = b < 0.0 ? exp(-max(x, 0.0) * 1.15) : 0.0;
            col += (ROYAL * 0.55 + SKY * 0.34 + LAV1 * 0.08 * exp(-max(x, 0.0) * 6.0)) * limb * uWorld;
            // 暗部漸層在 8-bit 會出現色階，用極細的顆粒打散
            col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.012;
            gl_FragColor = vec4(col, 1.0);
          }`,
        uniforms: skyUniforms,
        depthTest: false,
        depthWrite: false,
      }),
    ),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -20;
  scene.add(sky);

  // ── 世界 ──
  // 球面的最高點是台灣；北方 = -z，與島面同向
  const lat0 = (TAIWAN_CENTER.lat * Math.PI) / 180;
  const lon0 = (TAIWAN_CENTER.lon * Math.PI) / 180;
  const up = new THREE.Vector3(
    Math.cos(lat0) * Math.cos(lon0),
    Math.sin(lat0),
    Math.cos(lat0) * Math.sin(lon0),
  );
  const northE = new THREE.Vector3(
    -Math.sin(lat0) * Math.cos(lon0),
    Math.cos(lat0),
    -Math.sin(lat0) * Math.sin(lon0),
  );
  const eastE = new THREE.Vector3(-Math.sin(lon0), 0, Math.cos(lon0));
  // 場景方向 → 地球方向：場景 x = 東、y = 上、z = 南
  const earth = new THREE.Matrix3().set(
    eastE.x,
    up.x,
    -northE.x,
    eastE.y,
    up.y,
    -northE.y,
    eastE.z,
    up.z,
    -northE.z,
  );
  const worldUniforms = {
    uTime: common.uTime,
    uCam: skyUniforms.uCam,
    uCenter: skyUniforms.uCenter,
    uRadius: skyUniforms.uRadius,
    uEarth: { value: earth },
    uLand: { value: land },
    uSdf: { value: sdfFar },
    uHalf: { value: FAR_HALF * L },
    uL: { value: L },
    uRipple: { value: 0 },
    uAlpha: { value: 0 },
  };
  const globe = new THREE.Mesh(
    own(new THREE.SphereGeometry(R, high ? 160 : 112, high ? 120 : 84)),
    own(
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader:
          GLSL_COMMON +
          /* glsl */ `
          uniform vec3 uCam, uCenter; uniform mat3 uEarth; uniform sampler2D uLand, uSdf;
          uniform float uRadius, uHalf, uL, uRipple, uAlpha, uTime;
          varying vec3 vW;
          const float PI = 3.14159265;
          void main() {
            vec3 n = normalize(vW - uCenter);
            vec3 v = normalize(uCam - vW);
            float ang = acos(clamp(n.y, -1.0, 1.0));
            float ground = ang * uRadius;
            vec2 p = normalize(n.xz + 1e-5) * ground;
            // 離海岸的距離：近處沿著海岸線，遠處變成同心圓
            vec2 suv = p / (2.0 * uHalf) + 0.5;
            float sd = -texture2D(uSdf, clamp(suv, 0.0, 1.0)).r;
            float far = ground / uL - 0.5;
            float dc = mix(sd, far, smoothstep(1.2, 2.6, ground / uL));

            float front = uRipple * 34.0;
            float wake = smoothstep(front, front - 5.0, ground);

            // 陸地點陣：格點對齊經緯度，點的大小換算回球面距離
            vec3 e = uEarth * n;
            float lat = asin(clamp(e.y, -1.0, 1.0));
            float lon = atan(e.z, e.x);
            const float SP = 0.0092;
            float row = (floor(lat / SP) + 0.5) * SP;
            float sx = SP / max(cos(row), 0.2);
            float cl = (floor(lon / sx) + 0.5) * sx;
            vec2 muv = vec2((cl + PI) / (2.0 * PI), 1.0 - (0.5 - row / PI));
            float isLand = texture2D(uLand, muv).r;
            float dd = length(vec2((lon - cl) * cos(row), lat - row)) / SP;
            float aa = fwidth(dd) * 1.2 + 0.001;
            float dotM = 1.0 - smoothstep(0.2 - aa, 0.2 + aa, dd);
            float clear = smoothstep(0.1, 0.42, dc);
            float tw = 0.7 + 0.3 * sin(uTime * 0.5 + (row + cl) * 60.0);
            vec3 col = NIGHT * 0.5;
            col += mix(ROYAL, LAV1, 0.42) * dotM * isLand * clear * tw * 0.72 * wake;

            // 海岸等距線：從島往外擴散
            float k = dc * 7.0 - uTime * 0.16;
            float g = abs(fract(k) - 0.5);
            float line = 1.0 - smoothstep(0.0, fwidth(k) * 1.3 + 0.012, g);
            float reach = exp(-max(dc, 0.0) * 0.62);
            col += mix(SKY, IRIS, 0.45) * line * reach * wake * 0.42 * step(0.0, dc);

            // 島下方的光、地球邊緣
            col += IRIS * 0.2 * exp(-ground * 0.26) * wake;
            float fres = pow(1.0 - max(dot(n, v), 0.0), 3.2);
            col += (ROYAL * 0.5 + SKY * 0.22) * fres;
            gl_FragColor = vec4(col, uAlpha);
          }`,
        uniforms: worldUniforms,
        transparent: true,
        depthWrite: true,
      }),
    ),
  );
  globe.position.set(0, SEA - R, 0);
  globe.renderOrder = -10;
  scene.add(globe);

  // ── 三層島體 ──
  const shapes = islandShapes();
  const fillGeo = own(new THREE.ShapeGeometry(shapes, 1));
  fillGeo.rotateX(Math.PI / 2); // shape 的 y 就是向南，轉到 xz 平面時 z = y
  // ShapeGeometry 的法線朝 +z，翻到上方
  const wallGeo = own(wallGeometry());

  function wallGeometry() {
    const rings = [TAIWAN_MAIN];
    const pos: number[] = [];
    const v: number[] = [];
    const idx: number[] = [];
    let base = 0;
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 0; i <= n; i++) {
        const j = i % n;
        const x = ring[j * 2] * L;
        const z = ring[j * 2 + 1] * L;
        pos.push(x, 0, z, x, -0.065, z);
        v.push(0, 1);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
      base += (n + 1) * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1));
    g.setIndex(idx);
    return g;
  }

  const graphs: Graph[] = [organization(), product(), making()];
  const plates = [0, 1, 2].map((i) => makePlate(i, graphs[i]));

  function makePlate(i: number, g: Graph) {
    const group = new THREE.Group();
    scene.add(group);
    const tint = TINT[i];
    const fillUniforms = {
      uTime: common.uTime,
      uCam: skyUniforms.uCam,
      uSdf: { value: sdfNear },
      uHalf: { value: NEAR_HALF * L },
      uL: { value: L },
      uTint: { value: tint.a },
      uTint2: { value: tint.b },
      uAlpha: { value: 1 },
      uIso: { value: 1 },
      uPulseC: { value: new THREE.Vector2() },
      uPulseR: { value: 0 },
      uPulseA: { value: 0 },
      uGlass: { value: 0 },
    };
    const fill = new THREE.Mesh(
      fillGeo,
      own(
        new THREE.ShaderMaterial({
          vertexShader: /* glsl */ `
            varying vec2 vP; varying vec3 vW;
            void main() {
              vP = position.xz;
              vec4 w = modelMatrix * vec4(position, 1.0);
              vW = w.xyz;
              gl_Position = projectionMatrix * viewMatrix * w;
            }`,
          fragmentShader:
            GLSL_COMMON +
            /* glsl */ `
            uniform vec3 uCam, uTint, uTint2;
            uniform sampler2D uSdf;
            uniform vec2 uPulseC;
            uniform float uHalf, uL, uAlpha, uIso, uPulseR, uPulseA, uTime, uGlass;
            varying vec2 vP; varying vec3 vW;
            void main() {
              vec2 uv = vP / (2.0 * uHalf) + 0.5;
              float d = texture2D(uSdf, uv).r;          // 島的單位，向內為正
              vec2 q = vP / uL;

              // 等距線：越往內越淡，像等高線
              float k = d * 44.0;
              float g = abs(fract(k) - 0.5);
              float iso = 1.0 - smoothstep(0.0, fwidth(k) * 1.2 + 0.02, g);
              iso *= exp(-d * 8.0);

              // 點陣：島的材質
              vec2 grid = q * 74.0;
              vec2 cell = floor(grid);
              float h = hash(cell);
              vec2 f = fract(grid) - 0.5;
              float aa = fwidth(grid.x) * 0.9;
              float dm = 1.0 - smoothstep(0.1 - aa, 0.1 + aa, length(f));
              float flick = 0.45 + 0.55 * noise(q * 9.0 + uTime * 0.07);

              // 玻璃：視線越斜，反光越強；一道柔光隨鏡頭掠過
              vec3 v = normalize(uCam - vW);
              float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 2.6);
              float band = exp(-sq((dot(vP, normalize(vec2(0.8, -0.6))) + (uCam.x - uCam.z) * 0.32) / 0.95));

              float edge = exp(-d * 11.0);
              vec3 col = mix(NIGHT, uTint, 0.1 + 0.16 * edge);
              col += uTint * edge * 0.3;
              col += uTint2 * iso * 0.34 * uIso;
              col += mix(uTint, SNOW, 0.35) * dm * flick * (0.2 + 0.2 * h) * uIso;
              col += mix(uTint2, SNOW, 0.5) * (fres * 0.2 + band * 0.1) * uGlass;

              // 光線經過時，從穿過的位置往外推一圈
              float r = length(q - uPulseC);
              float ring = exp(-sq((r - uPulseR) / 0.05)) * uPulseA;
              col += mix(uTint2, SNOW, 0.6) * ring * (0.5 + iso * 3.0 + dm * 2.4);

              float a = 0.5 + 0.28 * fres;
              gl_FragColor = vec4(col * uAlpha, a * uAlpha);
            }`,
          uniforms: fillUniforms,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          blendEquation: THREE.AddEquation,
        }),
      ),
    );
    fill.renderOrder = i * 10;
    group.add(fill);

    const wallMat = own(
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute float aV; varying float vV;
          void main() { vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTint; uniform float uAlpha; varying float vV;
          void main() { gl_FragColor = vec4(uTint * pow(1.0 - vV, 1.6) * 0.72 * uAlpha, 1.0); }`,
        uniforms: { uTint: { value: tint.a }, uAlpha: { value: 1 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.renderOrder = i * 10 + 1;
    group.add(wall);

    // 海岸線
    const rimPaths: RibbonPath[] = [
      { pts: ringPts(TAIWAN_MAIN, 0.002), closed: true, width: 8, tint: 0.35, span: 3 },
    ];
    const rimGeo = own(ribbonGeometry(rimPaths));
    const rimMat = own(ribbonMaterial(common, tint.a, COLOR.snow, { core: 0.9, halo: 0.3 }));
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.frustumCulled = false;
    rim.renderOrder = i * 10 + 2;
    group.add(rim);

    // 內容的連線
    const lift = 0.05;
    const linkPaths: RibbonPath[] = g.links.map((l, k) => ({
      pts: curve(l.a, l.b, l.bow, lift),
      start: l.start,
      dur: l.dur,
      end: l.end,
      seed: k * 0.137,
      width: 3.4 + l.strong * 1.8,
      tint: l.strong >= 1 ? 0.7 : 0.15,
    }));
    if (g.loop) {
      linkPaths.push({
        pts: g.loop.map((p) => [p[0] * L, lift, p[1] * L]),
        start: 0,
        dur: 0.94,
        seed: 0.3,
        width: 6.5,
        tint: 0.75,
      });
    }
    const linkGeo = own(ribbonGeometry(linkPaths));
    const linkMat = own(
      ribbonMaterial(common, tint.a, tint.b, {
        core: 1.1,
        halo: 0.3,
        flow: 0.9,
        flowF: g.loop ? 64 : 15,
        flowS: 1.5,
        tip: 1.2,
      }),
    );
    const links = new THREE.Mesh(linkGeo, linkMat);
    links.frustumCulled = false;
    links.renderOrder = i * 10 + 3;
    group.add(links);

    // 節點
    const kindId = { dot: 0, ring: 1, hub: 2, bright: 3 };
    const nodeGeo = own(
      pointsGeometry(
        g.nodes.map((n, k) => ({
          x: n.p[0] * L,
          y: lift + 0.03,
          z: n.p[1] * L,
          size: n.size,
          kind: kindId[n.kind],
          start: n.start,
          end: n.end,
          tint: n.kind === 'bright' || n.kind === 'hub' ? 1 : 0.2,
          seed: k * 0.61,
        })),
      ),
    );
    const nodeMat = own(pointsMaterial(common, tint.a, tint.b));
    const nodes = new THREE.Points(nodeGeo, nodeMat);
    nodes.frustumCulled = false;
    nodes.renderOrder = i * 10 + 4;
    group.add(nodes);

    // 文件節點：浮在島面上的小卡
    let docs: THREE.Mesh | null = null;
    let docMat: THREE.ShaderMaterial | null = null;
    if (g.docs.length) {
      const W = 0.21;
      const H = 0.27;
      const pos: number[] = [];
      const uv: number[] = [];
      const st: number[] = [];
      const idx: number[] = [];
      g.docs.forEach((d, n) => {
        const cx = d.p[0] * L;
        const cz = d.p[1] * L;
        const y0 = 0.09;
        const corners: [number, number][] = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
        for (const [sx, sy] of corners) {
          const u = (sx * W) / 2;
          const v = (sy * H) / 2 + H / 2;
          pos.push(
            cx + DOC_RIGHT[0] * u + DOC_UP[0] * v,
            y0 + DOC_UP[1] * v,
            cz + DOC_RIGHT[2] * u + DOC_UP[2] * v,
          );
          uv.push((sx + 1) / 2, (sy + 1) / 2);
          st.push(d.start);
        }
        const b = n * 4;
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('aStart', new THREE.Float32BufferAttribute(st, 1));
      geo.setIndex(idx);
      own(geo);
      docMat = own(
        new THREE.ShaderMaterial({
          vertexShader: /* glsl */ `
            attribute float aStart; uniform float uReveal;
            varying vec2 vUv; varying float vVis;
            void main() {
              vUv = uv; vVis = smoothstep(aStart, aStart + 0.14, uReveal);
              vec3 p = position; p.y -= (1.0 - vVis) * 0.1;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
          fragmentShader:
            GLSL_COMMON +
            /* glsl */ `
            uniform vec3 uTint; uniform float uAlpha;
            varying vec2 vUv; varying float vVis;
            float box(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
            void main() {
              vec2 p = (vUv - 0.5) * vec2(0.3, 0.38);
              float d = box(p, vec2(0.145, 0.185), 0.018);
              float aa = fwidth(d) * 1.1;
              float shape = 1.0 - smoothstep(-aa, aa, d);
              float edge = exp(-abs(d) * 150.0);
              // 文件的文字列（裝飾）
              float bars = 0.0;
              for (int i = 0; i < 4; i++) {
                float y = 0.11 - float(i) * 0.062;
                float w = i == 0 ? 0.062 : (i == 3 ? 0.07 : 0.1);
                float bd = box(p - vec2(-0.105 + w, y), vec2(w, 0.0075), 0.006);
                bars += 1.0 - smoothstep(0.0, aa * 1.2, bd);
              }
              vec3 col = mix(NIGHT, uTint, 0.26) * shape;
              col += uTint * bars * 0.5 * shape;
              col += mix(uTint, SNOW, 0.5) * edge * 0.9;
              float a = shape * 0.82;
              gl_FragColor = vec4(col * vVis * uAlpha, a * vVis * uAlpha);
            }`,
          uniforms: { uTint: { value: tint.b }, uAlpha: { value: 1 }, uReveal: { value: 0 } },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          blendEquation: THREE.AddEquation,
        }),
      );
      docs = new THREE.Mesh(geo, docMat);
      docs.frustumCulled = false;
      docs.renderOrder = i * 10 + 5;
      group.add(docs);
    }

    return { group, fill, fillUniforms, wallMat, rimMat, linkMat, nodeMat, docMat, wall };
  }

  // ── 島內的光點與連線 ──
  const fieldData = field(high ? 104 : 72);
  const netLinks: RibbonPath[] = fieldData.links.map(([i, j, t], k) => ({
    pts: curve(fieldData.points[i], fieldData.points[j], k % 2 ? 0.04 : -0.04, 0.05, 10),
    start: t * 0.86,
    dur: 0.13,
    seed: k * 0.21,
    width: 2.6,
    tint: 0.2 + 0.7 * (k % 3 ? 0 : 1),
  }));
  const netGeo = own(ribbonGeometry(netLinks));
  const netMat = own(
    ribbonMaterial(common, COLOR.lav1, COLOR.sky2, {
      core: 0.55,
      halo: 0.16,
      flow: 0.32,
      flowF: 9,
      flowS: 1.2,
      tip: 1.2,
    }),
  );
  const net = new THREE.Mesh(netGeo, netMat);
  net.frustumCulled = false;
  net.renderOrder = 30;
  scene.add(net);
  const netDotGeo = own(
    pointsGeometry(
      fieldData.points.map((p, i) => ({
        x: p[0] * L,
        y: 0.06,
        z: p[1] * L,
        size: 0.13,
        kind: 0,
        start: -1,
        tint: i % 3 ? 0 : 1,
      })),
    ),
  );
  const netDotMat = own(pointsMaterial(common, COLOR.lav1, COLOR.sky2));
  const netDots = new THREE.Points(netDotGeo, netDotMat);
  netDots.frustumCulled = false;
  netDots.renderOrder = 31;
  scene.add(netDots);

  // ── 貫穿三層的光線 ──
  const thread = threadPath(L, high ? 520 : 380);
  const threadGeo = own(
    ribbonGeometry([{ pts: thread.pts, start: 0, dur: 1, width: 10, tint: 0.35, span: 2 }]),
  );
  const threadMat = own(
    ribbonMaterial(common, COLOR.sky2, COLOR.snow, { core: 1.5, halo: 0.42, tip: 2.2, ends: 1 }),
  );
  const threadMesh = new THREE.Mesh(threadGeo, threadMat);
  threadMesh.frustumCulled = false;
  threadMesh.renderOrder = 40;
  scene.add(threadMesh);

  // 光線的頭：跟著路徑走的亮點
  const headGeo = own(
    pointsGeometry([{ x: 0, y: 0, z: 0, size: 0.82, kind: 2, start: -1, tint: 1 }]),
  );
  const headMat = own(pointsMaterial(common, COLOR.sky2, COLOR.snow));
  const head = new THREE.Points(headGeo, headMat);
  head.frustumCulled = false;
  head.renderOrder = 41;
  scene.add(head);

  // 光柱：貫穿三層時的柔和體積光
  const columnGeo = own(new THREE.CylinderGeometry(0.62, 0.62, 7, 40, 1, true));
  const columnMat = own(
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vN, vV; varying float vY;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = uv.y;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying vec3 vN, vV; varying float vY;
        void main() {
          float f = pow(abs(dot(normalize(vN), normalize(vV))), 3.4);
          float e = smoothstep(0.0, 0.3, vY) * (1.0 - smoothstep(0.62, 1.0, vY));
          gl_FragColor = vec4(uColor * f * e * uAlpha, 1.0);
        }`,
      uniforms: { uColor: { value: new THREE.Color(0x6a8dff) }, uAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  const column = new THREE.Mesh(columnGeo, columnMat);
  column.renderOrder = 35;
  scene.add(column);

  // ── 向外的連線 ──
  // 終點刻意不落在任何標記上：線是願景示意，不代表實際據點
  const arcPaths: RibbonPath[] = [];
  const arcCount = high ? 26 : 16;
  const seeds = field(arcCount + 8, 19).points;
  for (let i = 0; i < arcCount; i++) {
    const p = seeds[i % seeds.length];
    // 只往鏡頭背後的半邊飛：線越過地平線離開畫面，不朝鏡頭掃過文字
    const u = (i + 0.5) / arcCount;
    const bearing = ((142 + 200 * u + 9 * Math.sin(i * 12.9)) * Math.PI) / 180;
    const reach = 0.5 + 0.55 * Math.abs(Math.sin(i * 7.31));
    const height = 0.8 + reach * 1.9;
    const steps = 54;
    const pts: P4[] = [];
    const sx = p[0] * L;
    const sz = p[1] * L;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const a = reach * t;
      const q = new THREE.Vector3(
        Math.sin(a) * Math.cos(bearing),
        Math.cos(a),
        Math.sin(a) * Math.sin(bearing),
      );
      const base = q.multiplyScalar(R + 0.02).add(new THREE.Vector3(0, SEA - R, 0));
      const blend = (1 - t) ** 3;
      const lift = Math.sin(t * Math.PI) ** 0.8 * height * (1 - t * 0.22);
      pts.push([
        mix(base.x, sx, blend),
        mix(base.y + lift, 0.06, blend),
        mix(base.z, sz, blend),
        2 * blend,
      ]);
    }
    arcPaths.push({
      pts,
      start: (i * 0.618) % 0.72,
      dur: 0.28,
      seed: i * 0.173,
      width: i % 4 ? 2.8 : 4,
      tint: i % 2,
    });
  }
  const arcGeo = own(ribbonGeometry(arcPaths));
  const arcMat = own(
    ribbonMaterial(common, COLOR.periwinkle, COLOR.sky2, {
      core: 0.6,
      halo: 0.24,
      flow: 0.8,
      flowF: 11,
      flowS: 1.5,
      tip: 2,
      ends: 1,
    }),
  );
  const arcs = new THREE.Mesh(arcGeo, arcMat);
  arcs.frustumCulled = false;
  arcs.renderOrder = 45;
  scene.add(arcs);

  // ── 尺寸 ──
  let W = 1;
  let H = 1;
  let layout = opt.layout;
  function resize(w: number, h: number, next: Layout) {
    W = Math.max(1, w);
    H = Math.max(1, h);
    layout = next;
    renderer.setPixelRatio(Math.min(dpr, pixelCap));
    renderer.setSize(W, H, false);
    const px = renderer.getPixelRatio();
    common.uPx.value = px;
    (common.uRes.value as THREE.Vector2).set(W * px, H * px);
    camera.aspect = W / H;
    camera.fov = layout === 'side' ? 30 : 34;
    camera.updateProjectionMatrix();
    common.uScale.value = (H * px) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  // 手機版文字高度隨螢幕而變：場景縮放並對準文字上方實際可用的區域
  const fit = { zoom: 1, dy: 0 };
  function frameTo(zoom: number, dy: number) {
    fit.zoom = zoom;
    fit.dy = dy;
  }

  // 依實際幀時間降解析度：只往下調，避免在臨界值來回抖動
  let slow = 0;
  let frames = 0;
  function watch(dt: number) {
    frames++;
    if (frames < 30) return;
    slow = slow * 0.96 + (dt > 26 ? 0.04 : 0);
    if (slow > 0.55 && pixelCap > 1) {
      pixelCap = Math.max(1, pixelCap - 0.25);
      slow = 0;
      frames = 0;
      resize(W, H, layout);
    }
  }

  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();

  function render(T: number, time: number, mx: number, my: number, dt = 16) {
    watch(dt);
    const st = stateAt(T);
    const c = camAt(T, layout);
    const az = ((c.az + mx * 1.6) * Math.PI) / 180;
    const el = ((c.elev + my * 0.9) * Math.PI) / 180;
    look.set(c.tx, c.ty, c.tz);
    camera.position.set(
      c.tx + Math.sin(az) * Math.cos(el) * c.dist * fit.zoom,
      c.ty + Math.sin(el) * c.dist * fit.zoom,
      c.tz + Math.cos(az) * Math.cos(el) * c.dist * fit.zoom,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.setViewOffset(W, H, -c.sx * W, -(c.sy + fit.dy) * H, W, H);
    camera.updateMatrixWorld();

    common.uTime.value = time;
    tmp.copy(camera.position);
    skyUniforms.uCam.value.copy(tmp);
    skyUniforms.uInv.value.copy(camera.matrixWorld).multiply(camera.projectionMatrixInverse);
    skyUniforms.uWorld.value = st.world;

    worldUniforms.uRipple.value = st.world;
    worldUniforms.uAlpha.value = st.world;
    globe.visible = st.world > 0.002;

    plates.forEach((p, i) => {
      p.group.position.y = i * st.sep;
      const f = st.focus[i];
      const a = i === 0 ? st.rim : st.rim * smooth(clamp(f * 2.4));
      const glass = i === 0 ? mix(0.25, 1, st.peel) : 1;
      p.fillUniforms.uAlpha.value = a * mix(0.2, 1, f * f);
      p.fillUniforms.uIso.value = mix(0.25, 0.8, f);
      p.fillUniforms.uGlass.value = glass;
      p.wallMat.uniforms.uAlpha.value = a * mix(0.4, 1, f) * st.peel;
      p.rimMat.uniforms.uAlpha.value = a * mix(0.3, 1, f * f);
      p.linkMat.uniforms.uAlpha.value = a * mix(0.3, 1, f);
      p.nodeMat.uniforms.uAlpha.value = a * mix(0.34, 1, f);
      p.linkMat.uniforms.uReveal.value = st.reveal[i];
      p.nodeMat.uniforms.uReveal.value = st.reveal[i];
      const detail = 1 - smooth(range(T, 9.1, 9.9));
      p.linkMat.uniforms.uAlpha.value *= mix(0.12, 1, detail);
      p.nodeMat.uniforms.uAlpha.value *= detail;
      if (p.docMat) {
        p.docMat.uniforms.uAlpha.value = a * mix(0.4, 1, f) * detail;
        p.docMat.uniforms.uReveal.value = st.reveal[i];
      }
      const hit = thread.hits[i];
      const since = (st.thread - hit.at) / 0.34;
      const on = since > 0 && since < 1;
      p.fillUniforms.uPulseC.value.set(hit.p[0], hit.p[1]);
      p.fillUniforms.uPulseR.value = since * 1.05;
      p.fillUniforms.uPulseA.value = on ? (1 - since) ** 1.4 * 1.4 : 0;
    });

    // 開場的光點在單層上，分層後沉到最上層，收尾時整座島一起累積
    const netY = st.sep * 2;
    net.position.y = netY;
    netDots.position.y = netY;
    netMat.uniforms.uReveal.value = st.net;
    netMat.uniforms.uAlpha.value = st.netAlpha * mix(1, 0.62, smooth(range(T, 9.2, 10.2)));
    netDotMat.uniforms.uAlpha.value = st.netAlpha * mix(0.75, 0.7, st.net);

    threadMat.uniforms.uSep.value = st.sep;
    threadMat.uniforms.uReveal.value = st.thread;
    const trailFade = 1 - smooth(range(T, 9.7, 10.6)) * 0.72;
    threadMat.uniforms.uAlpha.value = (st.thread > 0 ? 1 : 0) * trailFade;
    threadMesh.visible = st.thread > 0;

    const headOn = st.thread > 0.001 && st.thread < 0.999;
    head.visible = headOn;
    if (headOn) {
      const list = thread.along;
      let lo = 0;
      let hi = list.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (list[m] < st.thread) lo = m;
        else hi = m;
      }
      const k = (st.thread - list[lo]) / Math.max(list[hi] - list[lo], 1e-5);
      const a = thread.pts[lo];
      const b = thread.pts[hi];
      head.position.set(
        mix(a[0], b[0], k),
        mix(a[1], b[1], k) + mix(a[3], b[3], k) * st.sep,
        mix(a[2], b[2], k),
      );
    }

    columnMat.uniforms.uAlpha.value = st.column * 0.1;
    column.visible = st.column > 0.002;
    column.position.set(thread.hits[1].p[0] * L * 0.3, st.sep, thread.hits[1].p[1] * L * 0.3);

    arcMat.uniforms.uSep.value = st.sep;
    arcMat.uniforms.uReveal.value = st.arcs;
    arcMat.uniforms.uAlpha.value = smooth(range(st.arcs, 0, 0.2));
    arcMat.uniforms.uMask.value.set(...(layout === 'side' ? MASK_SIDE : MASK_STACK));
    arcs.visible = st.arcs > 0.001;

    renderer.render(scene, camera);
  }

  /** 把場景座標投影成章節畫面上的 CSS px。 */
  function project(x: number, y: number, z: number) {
    tmp.set(x, y, z).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
  }

  /** 樓層上的點目前的場景座標。 */
  function pointOn(floor: number, p: Pt, lift: number, T: number) {
    const st = stateAt(T);
    return project(p[0] * L, floor * st.sep + lift, p[1] * L);
  }

  const ready = (async () => {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        land.image = img;
        land.needsUpdate = true;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = '/stage/world-land.png';
    });
    resize(
      canvas.clientWidth || window.innerWidth,
      canvas.clientHeight || window.innerHeight,
      layout,
    );
    render(-1, 0, 0, 0);
    await renderer.compileAsync(scene, camera).catch(() => undefined);
  })();

  function dispose() {
    for (const d of disposables) d.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  const labelPoint = (g: number, key: 'hub' | number) =>
    graphs[g].labels.find((l) => l.key === key)?.p ?? at(0, 0);

  return { render, resize, frameTo, pointOn, project, ready, dispose, labelPoint };
}

export type World = ReturnType<typeof createWorld>;
export { SEP };
