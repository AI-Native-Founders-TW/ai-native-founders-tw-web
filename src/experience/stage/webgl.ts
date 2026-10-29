/**
 * WebGL 光帶（動態載入；Three.js 不進首屏 bundle）。
 *
 * 兩條絲帶：
 *  - leg：A 的左腳、頂點與右肩，淡紫 → 白
 *  - wave：A 的波浪右腳，靛 → 天藍
 * 每條絲帶由多股細光絲組成，沿著 x 扭轉（twist），扭到側面時光絲收攏成高光，形成絲綢感。
 * 噪聲讓整條絲帶像流體一樣漂動；游標靠近時光帶被吸過去、被照亮，移動越快擾動越大。
 * 捲到終點線時，uMorph 把 A 攤平成三條向右奔跑的賽道。
 */
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { pointer } from '../engine';
import { stageState } from './index';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const frag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;      // CSS px
uniform float uTime;
uniform vec3 uMark;     // A 的盒子：中心 x, y（CSS px，y 向下）, 邊長
uniform vec2 uMouse;    // CSS px
uniform float uMouseOn;
uniform float uSpeed;
uniform float uScroll;
uniform float uMorph;
uniform float uPx;      // 1 CSS px = ? device px
uniform vec3 uDot;      // Logo 光點：x, y, 半徑（CSS px）
uniform float uBake;
uniform float uLaneY;   // 終點線賽道的 y（logo 座標）    // 1 = 只輸出光帶（黑底），用來烘焙降級版的靜態圖

#define STRANDS __STRANDS__

const vec3 NIGHT = vec3(0.027, 0.039, 0.149);
const vec3 VIOLET = vec3(0.22, 0.047, 0.455);
const vec3 ROYAL = vec3(0.118, 0.278, 0.953);
const vec3 IRIS = vec3(0.302, 0.278, 0.996);
const vec3 SKY = vec3(0.098, 0.675, 0.996);
const vec3 LAV = vec3(0.808, 0.671, 0.992);
const vec3 LAV1 = vec3(0.871, 0.812, 0.996);
const vec3 SNOW = vec3(0.965, 0.984, 0.988);

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
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float softabs(float x, float r) { return sqrt(x * x + r * r) - r; }

// A 的左腳＋頂點（倒 V），logo 座標（512，y 向下）
float fLeg(float x) {
  float u = x - 258.0;
  float k = mix(1.55, 1.02, smoothstep(-40.0, 40.0, u));
  return 146.0 + k * softabs(u, 30.0);
}
// 波浪：從 A 內側升起、越過浪頭、往右下奔流
float fWave(float x) {
  float u = x - 312.0;
  float k = mix(0.0115, 0.0098, smoothstep(-20.0, 20.0, u));
  float y = 222.0 + k * u * u;
  float over = max(u - 110.0, 0.0);
  return y - k * over * over + over * 0.0;
}
// 終點線：三條賽道
float fLane(float x, float lane, float t) {
  return uLaneY + lane * 16.0 + sin(x * 0.009 + t * 0.9 + lane * 1.7) * (4.0 + 3.0 * lane * lane);
}

// 一條絲帶的光（回傳 rgb）
vec3 ribbon(vec2 q, float scale, float which, float t, float lane, vec3 cA, vec3 cB, float x0, float x1, float fadeIn, float fadeOut, float glowBoost) {
  float x = q.x;
  float fy, dfy;
  if (which < 0.5) { fy = fLeg(x); dfy = (fLeg(x + 1.0) - fLeg(x - 1.0)) * 0.5; }
  else { fy = fWave(x); dfy = (fWave(x + 1.0) - fWave(x - 1.0)) * 0.5; }
  float ly = fLane(x, lane, t);
  fy = mix(fy, ly, uMorph);
  dfy = mix(dfy, 0.0, uMorph);

  float norm = inversesqrt(1.0 + dfy * dfy);
  // 絲帶的頭尾收成尖端（像 Logo 波浪的起點），而不是被垂直切掉
  float taper = smoothstep(fadeIn - 4.0, fadeIn + 80.0, x) * (1.0 - smoothstep(fadeOut - 80.0, fadeOut + 4.0, x));
  taper = mix(sqrt(taper), 1.0, uMorph);
  float width = mix(26.0, 11.0, uMorph) * taper;
  float phase = x * 0.0105 + t * 0.42 + which * 2.1 + lane + sin(x * 0.004 - t * 0.2) * 0.8;
  float tw = sin(phase);
  float edgeOn = 1.0 - abs(tw);              // 1 = 絲帶側面朝向鏡頭
  float front = step(0.0, tw);               // 正面／背面

  // 沿著絲帶的顏色
  float g = smoothstep(x0, x1, x);
  vec3 base = mix(cA, cB, g);
  vec3 back = mix(base, IRIS, 0.45) * 0.6;

  // 絲帶出現與消失的範圍
  float ext = smoothstep(fadeIn - 6.0, fadeIn + 30.0, x) * (1.0 - smoothstep(fadeOut - 30.0, fadeOut + 6.0, x));
  ext = mix(ext, 1.0, uMorph);
  float extWide = smoothstep(fadeIn - 40.0, fadeIn + 160.0, x) * (1.0 - smoothstep(fadeOut - 160.0, fadeOut + 40.0, x));
  extWide = mix(extWide, 1.0, uMorph);

  float dy = (q.y - fy) * norm;              // logo 單位
  float dc = abs(dy) * scale;                // px
  vec3 col = vec3(0.0);

  // 絲面：沿截面做柔和的明暗，正面亮、背面深
  float hw = max(abs(width * tw), 0.8 / scale);
  float v = dy / hw;
  float aa = 1.4 / (hw * scale);
  float inside = smoothstep(1.0 + aa, 1.0 - aa, abs(v));
  float sheen = 0.55 + 0.45 * cos(v * 1.4 + phase * 1.3);
  vec3 face = mix(back, base, front) * (0.30 + 0.30 * sheen) * (0.6 + 0.4 * abs(tw));
  col += face * inside;
  // 邊緣的亮線
  float rim = exp(-pow((abs(v) - 1.0) * hw * scale * uPx, 2.0) / 2.0);
  col += mix(base, SNOW, 0.35) * rim * 0.55 * (0.4 + 0.6 * abs(tw));

  // 光絲（細緻的紋理）。離絲帶太遠的像素貢獻趨近 0（< 0.0003），直接略過整個迴圈：
  // 畫面上大多數像素都在這裡省下 STRANDS 次 exp／sin。
  float sigma = max(0.75 * uPx, 0.7);
  if (abs(dy) < width * 2.6 + 48.0) {
    for (int j = 0; j < STRANDS; j++) {
      float s = (float(j) / float(STRANDS - 1)) * 2.0 - 1.0;
      float wob = sin(x * 0.03 + t * 1.1 + float(j) * 1.7) * 1.6;
      float off = width * tw * s * 0.92 + wob * edgeOn;
      float d = abs(q.y - (fy + off)) * norm * scale * uPx;
      float line = exp(-d * d / (sigma * sigma * 2.0)) + 0.02 / (d / uPx + 0.8);
      col += mix(base, LAV1, 0.3 * edgeOn) * line * 0.2;
    }
  }

  // 扭到側面的高光
  float fold = exp(-dc * dc / (90.0 * scale * scale)) * pow(edgeOn, 5.0);
  col += mix(LAV1, SNOW, 0.6) * fold * 1.1;

  col *= ext;
  // 寬泛的光暈（bloom 的替代）：用更寬的淡入淡出，避免出現垂直的光柱
  col += base * exp(-dc / (95.0 * scale)) * 0.26 * glowBoost * extWide;

  return col;
}

void main() {
  vec2 frag = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y); // CSS px，y 向下
  float scale = uMark.z / 512.0;
  vec2 origin = uMark.xy - vec2(256.0) * scale;
  float t = uTime;

  // 捲動時 A 往上漂、慢慢散開
  frag.y += uScroll * uRes.y * 0.18 * (1.0 - uMorph);

  vec2 q = (frag - origin) / scale;            // logo 座標
  vec2 mq = (uMouse - origin) / scale;

  // 流體般的漂移
  float n = fbm(q * 0.0065 + vec2(t * 0.06, -t * 0.045));
  float turb = 1.0 + uSpeed * 2.4;
  q.y += (n - 0.5) * 34.0 * turb;
  q.x += (fbm(q * 0.005 - t * 0.04) - 0.5) * 18.0 * turb;
  q.y += sin(q.x * 0.011 + t * 0.7) * 5.0;

  // 游標：把光帶吸過去
  vec2 dm = q - mq;
  float near = exp(-dot(dm, dm) / (2.0 * 70.0 * 70.0)) * uMouseOn;
  q.y += clamp(dm.y, -60.0, 60.0) * 0.45 * near;
  q.x += clamp(dm.x, -40.0, 40.0) * 0.2 * near;

  float distPx = length(frag - uMouse);
  float lit = 1.0 + 1.3 * exp(-distPx * distPx / (2.0 * 190.0 * 190.0)) * uMouseOn;

  // 背景
  vec2 uv = frag / uRes;
  float asp = uRes.x / uRes.y;
  vec3 col = NIGHT;
  col += VIOLET * 0.85 * exp(-length((uv - vec2(-0.05, 1.05)) * vec2(asp, 1.0)) * 1.5);
  col += ROYAL * 0.30 * exp(-length((uv - vec2(1.05, -0.05)) * vec2(asp, 1.0)) * 1.9);
  col += IRIS * 0.10 * exp(-length((frag - uMark.xy) / uMark.z) * 2.2);

  vec3 rib = vec3(0.0);
  rib += ribbon(q, scale, 0.0, t, -1.0, LAV, SNOW, 120.0, 262.0, -400.0, 330.0, 1.0);
  rib += ribbon(q, scale, 1.0, t, 1.0, IRIS, SKY, 270.0, 430.0, 262.0, 2000.0, 1.2);
  if (uMorph > 0.01) {
    rib += ribbon(q + vec2(0.0, 0.0), scale, 0.0, t * 1.2, 0.0, ROYAL, LAV1, -200.0, 700.0, -2000.0, 2000.0, 0.8) * uMorph;
  }
  // 光點（＝你）照亮附近的光帶；游標接手後，這道光跟著游標走
  vec2 dotPos = mix(uDot.xy, uMouse, uMouseOn);
  float dotR = mix(uDot.z, 12.0, uMouseOn);
  float dDot = length(frag - dotPos);
  lit += 0.8 * exp(-dDot / (dotR * 4.0)) * (1.0 - uMorph);
  rib *= lit;

  col += rib;

  // 光點的光暈（本體由 DOM 畫，保持銳利）
  col += LAV1 * 0.55 * exp(-dDot / (dotR * 1.3)) * (1.0 - uMorph);
  col += IRIS * 0.25 * exp(-dDot / (dotR * 4.5)) * (1.0 - uMorph);

  // 星塵：增加景深
  vec2 cell = floor(frag / 46.0);
  float h = hash(cell);
  vec2 sp = (cell + 0.5 + (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.8) * 46.0;
  float star = smoothstep(1.6, 0.0, length(frag - sp)) * step(0.93, h) * (0.5 + 0.5 * sin(t * (1.0 + h * 3.0) + h * 40.0));
  col += mix(LAV1, SKY, hash(cell + 1.3)) * star * 0.5;

  // 游標的淡紫光
  col += LAV * 0.07 * exp(-distPx * distPx / (2.0 * 240.0 * 240.0)) * uMouseOn;

  if (uBake > 0.5) {
    vec3 b = rib + LAV1 * 0.55 * exp(-dDot / (uDot.z * 1.3)) + IRIS * 0.25 * exp(-dDot / (uDot.z * 4.5));
    gl_FragColor = vec4(1.0 - exp(-b * 1.35), 1.0);
    return;
  }

  // 色調壓縮＋暗角＋顆粒
  col = 1.0 - exp(-col * 1.35);
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(asp * 0.8, 1.0)));
  col *= mix(0.72, 1.0, vig);
  col += (hash(frag + fract(t * 7.0) * 91.0) - 0.5) * 0.028;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createRibbon(
  canvas: HTMLCanvasElement,
  mark: Element,
  quality: 'high' | 'mid',
  dot: Element | null = null,
  bake = false,
) {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: bake,
    });
  } catch {
    return null;
  }
  // 這張全螢幕畫布是整頁最大的 GPU 成本（量測：約佔 Hero 85%）。光帶本身是柔和的光，
  // 內部解析度降到 0.8 CSS px 肉眼看不出差異，像素數卻比 1.5×DPR 少 3.5 倍。
  const dprCap = 1;
  const resScale = bake ? 1 : quality === 'high' ? 0.8 : 0.6;

  const uniforms = {
    uRes: { value: new Vector2() },
    uTime: { value: 0 },
    uMark: { value: new Vector3() },
    uMouse: { value: new Vector2(-9999, -9999) },
    uMouseOn: { value: 0 },
    uSpeed: { value: 0 },
    uScroll: { value: 0 },
    uMorph: { value: 0 },
    uPx: { value: 1 },
    uDot: { value: new Vector3(-999, -999, 1) },
    uBake: { value: bake ? 1 : 0 },
    uLaneY: { value: 300 },
  };
  const material = new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag.replace('__STRANDS__', quality === 'high' ? '9' : '5'),
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));

  const measure = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const px = Math.min(window.devicePixelRatio || 1, dprCap) * resScale;
    renderer.setPixelRatio(px);
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
    uniforms.uPx.value = px;
    const r = mark.getBoundingClientRect();
    uniforms.uMark.value.set(r.left + r.width / 2, r.top + r.height / 2, r.width);
    const d = dot?.getBoundingClientRect();
    if (d?.width) uniforms.uDot.value.set(d.left + d.width / 2, d.top + d.height / 2, d.width / 2);
  };
  measure();
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(measure);
  });

  // 平滑後的游標
  const m = { x: pointer.x, y: pointer.y, on: 0, speed: 0 };

  return {
    render(time: number) {
      m.x += (pointer.x - m.x) * 0.08;
      m.y += (pointer.y - m.y) * 0.08;
      m.on += ((pointer.active ? 1 : 0) - m.on) * 0.04;
      const sp = Math.min(1, Math.hypot(pointer.vx, pointer.vy) / 3000);
      m.speed += (sp - m.speed) * 0.06;
      pointer.vx *= 0.92;
      pointer.vy *= 0.92;
      uniforms.uTime.value = time;
      uniforms.uMouse.value.set(m.x, m.y);
      uniforms.uMouseOn.value = m.on;
      uniforms.uSpeed.value = m.speed;
      uniforms.uScroll.value = stageState.heroProgress;
      uniforms.uMorph.value = stageState.morph;
      // 賽道的 y：px → logo 座標
      const mk = uniforms.uMark.value;
      const sc = mk.z / 512;
      uniforms.uLaneY.value = (stageState.laneY - (mk.y - 256 * sc)) / sc;
      renderer.render(scene, camera);
    },
  };
}
