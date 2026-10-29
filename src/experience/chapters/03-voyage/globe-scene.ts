/**
 * 章節 03 的程式版本（沒有 Seedance 影格時使用）：深夜的地球弧面 → 大圓航線 → 破曉。
 * 只在章節接近時以 dynamic import 載入（Three.js 不進首屏）。
 *
 * 畫面組成（由遠到近）：
 *   天空殼（光線與地球最近距離 → 大氣光暈；太陽方向 → 破曉）、星空、地球核心（菲涅耳霧）、
 *   陸地點陣＋海面粒子（閃爍）、航線光弧（已飛／未飛）、檢查點光圈與光柱、彗星光點與尾跡。
 */
import * as THREE from 'three';
import {
  air,
  CHECKPOINT_T,
  cross,
  ground,
  isLand,
  norm,
  SFO,
  scale,
  TPE,
  tangent,
  toVec,
  type V3,
} from './geo';

export interface GlobeOptions {
  quality: 'high' | 'mid' | 'low';
  mobile: boolean;
}

export interface FrameState {
  /** 章節進度 0–1 */
  p: number;
  /** 彗星在航線上的位置 0–1 */
  head: number;
  /** 破曉程度 0–1 */
  dawn: number;
  /** 游標（-1–1） */
  mx: number;
  my: number;
}

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : Math.min(v, b));
const v3 = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);

// 鏡頭關鍵格：p → [高度, 後退, 前視, 側移, 視線高度]
const CAM: [number, number, number, number, number, number][] = [
  [0.0, 0.045, 0.2, 0.5, 0.02, 0.04],
  [0.12, 0.08, 0.26, 0.5, 0.05, 0.03],
  [0.3, 0.55, 0.62, 0.18, 0.3, 0.0],
  [0.5, 1.05, 0.62, 0.0, 0.08, 0.0],
  [0.7, 0.5, 0.5, 0.25, -0.18, 0.0],
  [0.86, 0.075, 0.22, 0.5, -0.06, 0.05],
  [1.0, 0.06, 0.2, 0.62, -0.02, 0.06],
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
function track(p: number, col: number) {
  const n = CAM.length;
  let i = 0;
  while (i < n - 2 && p > CAM[i + 1][0]) i++;
  const a = CAM[Math.max(0, i - 1)];
  const b = CAM[i];
  const c = CAM[i + 1];
  const d = CAM[Math.min(n - 1, i + 2)];
  const t = clamp((p - b[0]) / (c[0] - b[0]));
  return catmull(a[col], b[col], c[col], d[col], t);
}

export function createGlobe(canvas: HTMLCanvasElement, opt: GlobeOptions) {
  const high = opt.quality === 'high';
  const dpr = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // MSAA 只給非 Retina 螢幕；Retina 以 1.25×DPR 已經夠平滑，省下 4 倍取樣
    antialias: dpr < 1.5 && !opt.mobile,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x070a26, 1);
  // 場景以點與柔光為主，1.25 以上的 DPR 看不出差異（原本 1.75 時像素數多一倍）
  const maxDpr = high ? 1.25 : 1.1;
  renderer.setPixelRatio(Math.min(dpr, maxDpr));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opt.mobile ? 62 : 46, 1, 0.005, 200);

  const uniforms = {
    uTime: { value: 0 },
    uDawn: { value: 0 },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uCam: { value: new THREE.Vector3() },
    uPx: { value: renderer.getPixelRatio() },
    uHead: { value: 0 },
  };

  // ── 天空殼 ──
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCam; uniform vec3 uSun; uniform float uDawn;
        varying vec3 vW;
        void main(){
          vec3 dir = normalize(vW - uCam);
          // 視線離地球邊緣（地平線）的角度：近地與遠景都適用
          float rc = length(uCam);
          vec3 up = uCam / rc;
          float theta = acos(clamp(dot(dir, -up), -1.0, 1.0));
          float x = max(theta - asin(clamp(1.0 / rc, 0.0, 1.0)), 0.0);
          float limb = exp(-x * 28.0);
          float haze = exp(-x * 3.2);
          float sunAmt = max(dot(dir, uSun), 0.0);
          vec3 night = vec3(0.020, 0.030, 0.12);
          vec3 nightHaze = vec3(0.045, 0.075, 0.30);
          vec3 col = mix(night, nightHaze, haze);
          vec3 dawnTop = vec3(0.07, 0.16, 0.62);
          vec3 dawnLow = vec3(0.10, 0.60, 0.98);
          vec3 dawnCol = mix(dawnTop, dawnLow, pow(haze, 1.5));
          dawnCol = mix(dawnCol, vec3(0.87, 0.81, 0.996), pow(haze, 2.6) * (0.35 + 0.65 * pow(sunAmt, 3.0)));
          col = mix(col, dawnCol, uDawn);
          vec3 rimNight = vec3(0.14, 0.32, 1.0);
          vec3 rimDawn = vec3(0.80, 0.78, 1.0);
          col += mix(rimNight * 0.5, rimDawn * 0.55, uDawn) * limb * (0.8 + 0.8 * uDawn * pow(sunAmt, 2.0));
          float sd = uDawn * uDawn;
          col += vec3(1.0, 0.98, 1.0) * pow(sunAmt, 4000.0) * 1.4 * sd;
          col += vec3(0.95, 0.88, 1.0) * pow(sunAmt, 400.0) * 0.7 * sd;
          col += vec3(0.80, 0.76, 1.0) * pow(sunAmt, 40.0) * 0.45 * sd;
          col += vec3(0.10, 0.60, 1.0) * pow(sunAmt, 5.0) * 0.18 * uDawn;
          col = 1.0 - exp(-col * 1.25);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  sky.renderOrder = 0;
  scene.add(sky);

  // ── 星空 ──
  {
    const n = high ? 2200 : 1200;
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(th) * 40, u * 40, r * Math.sin(th) * 40], i * 3);
      rnd[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    const stars = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime; uniform float uPx; attribute float aRand; varying float vA;
          void main(){
            vec4 mv = modelViewMatrix * vec4(position,1.);
            vA = (0.35 + 0.65 * aRand) * (0.6 + 0.4 * sin(uTime * (0.6 + aRand * 2.0) + aRand * 50.0));
            gl_PointSize = (0.8 + aRand * aRand * 2.0) * uPx;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uDawn; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * (1.0 - uDawn * 0.92);
            gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0); }`,
      }),
    );
    stars.renderOrder = 1;
    scene.add(stars);
  }

  // ── 地球核心 ──
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.997, 128, 96),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCam; uniform vec3 uSun; uniform float uDawn;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 V = normalize(uCam - vW);
          float f = 1.0 - max(dot(V, vN), 0.0);
          float day = smoothstep(-0.25, 0.45, dot(vN, uSun)) * uDawn;
          vec3 base = mix(vec3(0.012, 0.018, 0.085), vec3(0.05, 0.12, 0.42), day);
          vec3 haze = mix(vec3(0.10, 0.22, 0.85), vec3(0.80, 0.74, 1.0), day);
          vec3 col = base + haze * pow(f, 4.0) * (0.5 + 0.5 * day);
          col = 1.0 - exp(-col * 1.25);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  core.renderOrder = 2;
  scene.add(core);

  // ── 陸地點陣＋海面粒子 ──
  // 十幾萬次 isLand 判定，同步跑會卡住主執行緒（量測到 750ms 的長任務，進章節前頓一下）。
  // 改成分段產生：每做約 6ms 就把控制權還給瀏覽器，全部做完才掛進場景。
  const buildDots = async () => {
    const step = high ? 0.55 : opt.mobile ? 0.8 : 0.7;
    const pos: number[] = [];
    const kind: number[] = [];
    const rnd: number[] = [];
    let slice = performance.now();
    for (let lat = -70; lat <= 80; lat += step) {
      const lonStep = step / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
      for (let lon = -180; lon < 180; lon += lonStep) {
        const land = isLand(lat, lon);
        if (!land && Math.random() > (high ? 0.32 : 0.22)) continue;
        const jl = (Math.random() - 0.5) * step * (land ? 0.35 : 1);
        const jo = (Math.random() - 0.5) * lonStep * (land ? 0.35 : 1);
        const v = toVec(lat + jl, lon + jo);
        const r = land ? 1.0005 : 1.0;
        pos.push(v[0] * r, v[1] * r, v[2] * r);
        kind.push(land ? 1 : 0);
        rnd.push(Math.random());
      }
      if (performance.now() - slice > 6) {
        await new Promise<void>((r) => setTimeout(r, 0));
        slice = performance.now();
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 1));
    const dots = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime; uniform float uDawn; uniform float uPx; uniform vec3 uSun; uniform vec3 uCam;
          attribute float aKind; attribute float aRand;
          varying vec3 vC; varying float vA;
          void main(){
            vec3 n = normalize(position);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float dist = -mv.z;
            vec3 V = normalize(uCam - position);
            float facing = dot(V, n);
            float day = smoothstep(-0.2, 0.4, dot(n, uSun)) * uDawn;
            float sh = 0.5 + 0.5 * sin(uTime * (0.9 + aRand) + aRand * 60.0 + position.x * 30.0 + position.z * 22.0);
            vec3 ocean = mix(vec3(0.07, 0.2, 0.75), vec3(0.3, 0.75, 1.0), sh * 0.5 + day * 0.4);
            vec3 land = mix(vec3(0.38, 0.36, 1.0), vec3(0.9, 0.86, 1.0), 0.25 + 0.75 * day);
            vC = mix(ocean, land, aKind);
            float a = aKind > 0.5 ? 0.9 : (0.10 + 0.55 * sh * sh * sh);
            a *= smoothstep(0.0, 0.22, facing);
            a *= 1.0 + day * 0.5;
            a *= smoothstep(0.004, 0.03, dist);
            vA = a;
            float size = aKind > 0.5 ? 2.4 : (1.2 + sh * 1.2);
            gl_PointSize = clamp(size * 0.012 / dist * 160.0, 0.8, 7.0) * uPx;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vC; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, d) * vA; gl_FragColor = vec4(vC * a, 1.0); }`,
      }),
    );
    dots.renderOrder = 3;
    scene.add(dots);
  };
  // 點陣產生完，再把所有 shader 先行編譯（並行編譯擴充），第一次 render 就不會同步編譯而掉幀
  const ready: Promise<void> = buildDots().then(() =>
    renderer.compileAsync(scene, camera).then(
      () => undefined,
      () => undefined,
    ),
  );

  // ── 航線光弧 ──
  const SEG = 600;
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 121 }, (_, i) => v3(air(i / 120))));
  const arcMat = (core: boolean) =>
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uCore: { value: core ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying float vU; varying float vD; void main(){ vU = uv.x; vec4 mv = modelViewMatrix * vec4(position,1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float uHead; uniform float uTime; uniform float uCore; uniform float uDawn;
        varying float vU; varying float vD;
        void main(){
          float nearFade = smoothstep(0.06, 0.4, vD);
          float done = step(vU, uHead);
          float tail = smoothstep(uHead - 0.3, uHead, vU);
          vec3 c = mix(vec3(0.30, 0.28, 1.0), vec3(0.56, 0.85, 1.0), tail);
          c = mix(c, vec3(0.87, 0.81, 0.996), uDawn * 0.5);
          float a = done * (0.28 + 0.72 * tail) * (uCore > 0.5 ? 1.0 : 0.22);
          float dash = step(0.6, fract(vU * 160.0 - uTime * 0.6));
          float ahead = (1.0 - done) * dash * (uCore > 0.5 ? 0.16 : 0.0);
          gl_FragColor = vec4((c * a + vec3(0.55, 0.65, 1.0) * ahead) * nearFade, 1.0);
        }`,
    });
  const arcCore = new THREE.Mesh(
    new THREE.TubeGeometry(curve, SEG, 0.0018, 6, false),
    arcMat(true),
  );
  const arcGlow = new THREE.Mesh(
    new THREE.TubeGeometry(curve, SEG, 0.005, 8, false),
    arcMat(false),
  );
  arcCore.renderOrder = 5;
  arcGlow.renderOrder = 4;
  scene.add(arcGlow, arcCore);

  // ── 光點貼圖 ──
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.12, 'rgba(230,240,255,0.9)');
    grd.addColorStop(0.35, 'rgba(120,190,255,0.28)');
    grd.addColorStop(1, 'rgba(77,71,254,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  })();
  const sprite = (size: number, color = 0xffffff) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    s.scale.setScalar(size);
    s.renderOrder = 6;
    return s;
  };

  // 城市光
  const tpe = toVec(TPE.lat, TPE.lon);
  const sfo = toVec(SFO.lat, SFO.lon);
  const tpeGlow = sprite(0.05, 0x8fd8ff);
  tpeGlow.position.copy(v3(scale(tpe, 1.002)));
  const sfoGlow = sprite(0.05, 0xdecffe);
  sfoGlow.position.copy(v3(scale(sfo, 1.002)));
  scene.add(tpeGlow, sfoGlow);

  // 檢查點：地面光圈＋光柱
  const ringGeo = new THREE.RingGeometry(0.85, 1, 64);
  const cps = CHECKPOINT_T.map((t) => {
    const g = ground(t);
    const a = air(t);
    const n = v3(g);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0x8fd8ff,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.copy(n.clone().multiplyScalar(1.001));
    ring.lookAt(n.clone().multiplyScalar(2));
    ring.scale.setScalar(0.012);
    ring.renderOrder = 6;
    const pulse = ring.clone();
    pulse.material = (ring.material as THREE.MeshBasicMaterial).clone();
    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      n.clone().multiplyScalar(1.001),
      v3(a),
    ]);
    const beam = new THREE.Line(
      beamGeo,
      new THREE.LineBasicMaterial({
        color: 0x8fd8ff,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const dot = sprite(0.018, 0xdecffe);
    dot.position.copy(v3(a));
    scene.add(ring, pulse, beam, dot);
    return { t, ring, pulse, beam, dot, air: v3(a) };
  });

  // 彗星
  const head = sprite(0.055, 0xffffff);
  const headCore = sprite(0.016, 0xffffff);
  scene.add(head, headCore);
  const TRAIL = high ? 220 : 120;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailSeed = Array.from({ length: TRAIL }, () => ({
    back: Math.random() ** 1.6 * 0.07,
    off: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5] as V3,
    r: Math.random(),
  }));
  const trailAlpha = new Float32Array(TRAIL);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('aA', new THREE.BufferAttribute(trailAlpha, 1));
  const trail = new THREE.Points(
    trailGeo,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uPx; attribute float aA; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vA = aA; gl_PointSize = clamp(0.02 / -mv.z * 120.0, 1.0, 5.0) * uPx; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(vec3(0.75, 0.88, 1.0) * a, 1.0); }`,
    }),
  );
  trail.renderOrder = 7;
  trail.frustumCulled = false;
  scene.add(trail);

  // 太陽：永遠放在鏡頭正前方的地平線附近，隨破曉從地平線下升起（取景穩定，不會跑出畫面）
  const sunV = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const upV = new THREE.Vector3();
  function placeSun(dawn: number) {
    const c = camera.position;
    const rc = c.length();
    upV.copy(c).divideScalar(rc);
    camera.getWorldDirection(fwd);
    fwd.addScaledVector(upV, -fwd.dot(upV)).normalize();
    const dip = Math.acos(Math.min(1, 1 / rc));
    const e = -0.3 + 0.335 * dawn;
    const ang = dip - e;
    sunV.copy(fwd).multiplyScalar(Math.cos(ang)).addScaledVector(upV, -Math.sin(ang)).normalize();
    // 讓太陽稍微偏右，構圖留給左側文字
    return sunV;
  }

  let W = 1;
  let H = 1;
  function resize(w: number, h: number) {
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 64 : 46;
    camera.updateProjectionMatrix();
  }

  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const ray = new THREE.Vector3();
  /** 鏡頭到某點之間是否被地球擋住 */
  function occluded(v: THREE.Vector3) {
    const cam = camera.position;
    ray.copy(v).sub(cam);
    const len = ray.length();
    ray.divideScalar(len);
    const b = cam.dot(ray);
    const c = cam.lengthSq() - 0.996 * 0.996;
    const disc = b * b - c;
    if (disc <= 0) return false;
    const t0 = -b - Math.sqrt(disc);
    return t0 > 0 && t0 < len - 0.003;
  }
  function render(f: FrameState, time: number) {
    uniforms.uTime.value = time;
    uniforms.uDawn.value = f.dawn;
    uniforms.uHead.value = f.head;

    // 鏡頭：跟著彗星
    const anchorT = clamp(f.head);
    const n = ground(anchorT);
    const T = tangent(anchorT);
    const Bn = norm(cross(n, T));
    const h = track(f.p, 1);
    const back = track(f.p, 2);
    const ahead = track(f.p, 3);
    const side = track(f.p, 4) + f.mx * 0.015;
    const lookAlt = track(f.p, 5) - f.my * 0.01;
    const cp: V3 = [
      n[0] * (1 + h) - T[0] * back + Bn[0] * side,
      n[1] * (1 + h) - T[1] * back + Bn[1] * side,
      n[2] * (1 + h) - T[2] * back + Bn[2] * side,
    ];
    // 確保鏡頭不會鑽進地表
    const cl = Math.hypot(cp[0], cp[1], cp[2]);
    const minR = 1 + Math.max(0.03, h * 0.6);
    const k = cl < minR ? minR / cl : 1;
    camera.position.set(cp[0] * k, cp[1] * k, cp[2] * k);
    camera.up.set(n[0], n[1], n[2]);
    look.set(
      n[0] * (1 + lookAlt) + T[0] * ahead,
      n[1] * (1 + lookAlt) + T[1] * ahead,
      n[2] * (1 + lookAlt) + T[2] * ahead,
    );
    camera.lookAt(look);
    uniforms.uCam.value.copy(camera.position);
    camera.updateMatrixWorld();
    uniforms.uSun.value.copy(placeSun(f.dawn));

    // 彗星
    const hp = v3(air(f.head));
    head.position.copy(hp);
    headCore.position.copy(hp);
    const pulse = 1 + 0.12 * Math.sin(time * 4);
    const distH = camera.position.distanceTo(hp);
    head.scale.setScalar(Math.min(0.08, distH * 0.09) * pulse);
    headCore.scale.setScalar(Math.min(0.02, distH * 0.022));
    for (let i = 0; i < TRAIL; i++) {
      const s = trailSeed[i];
      const tt = f.head - s.back;
      if (tt < 0) {
        trailAlpha[i] = 0;
        continue;
      }
      const a = air(tt);
      const spread = s.back * 0.25;
      trailPos[i * 3] = a[0] + s.off[0] * spread;
      trailPos[i * 3 + 1] = a[1] + s.off[1] * spread;
      trailPos[i * 3 + 2] = a[2] + s.off[2] * spread;
      trailAlpha[i] =
        (1 - s.back / 0.07) * (0.4 + 0.6 * s.r) * (0.75 + 0.25 * Math.sin(time * 6 + s.r * 40));
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.aA.needsUpdate = true;

    // 城市光
    const occ = (o: THREE.Object3D) => (occluded(o.position) ? 0 : 1);
    tpeGlow.scale.setScalar(
      Math.min(0.06, camera.position.distanceTo(tpeGlow.position) * 0.05) *
        (1 + 0.1 * Math.sin(time * 2)),
    );
    sfoGlow.scale.setScalar(
      Math.min(0.06, camera.position.distanceTo(sfoGlow.position) * 0.05) *
        (0.6 + 0.4 * clamp((f.head - 0.7) / 0.3)),
    );
    tpeGlow.material.opacity = occ(tpeGlow);
    sfoGlow.material.opacity = occ(sfoGlow);
    head.material.opacity = occ(head);
    headCore.material.opacity = occ(head);

    // 檢查點
    for (const c of cps) {
      const passed = clamp((f.head - c.t) / 0.04);
      const near = clamp(1 - Math.abs(f.head - c.t) / 0.12);
      (c.ring.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.5 * passed + 0.3 * near;
      (c.ring.material as THREE.MeshBasicMaterial).color.setHex(passed > 0.5 ? 0xdecffe : 0x8fd8ff);
      const pp = clamp((f.head - c.t) / 0.08);
      c.pulse.scale.setScalar(0.012 * (1 + pp * 5));
      (c.pulse.material as THREE.MeshBasicMaterial).opacity = pp > 0 && pp < 1 ? (1 - pp) * 0.6 : 0;
      (c.beam.material as THREE.LineBasicMaterial).opacity = 0.12 + 0.5 * near + 0.15 * passed;
      const dd = camera.position.distanceTo(c.air);
      c.dot.scale.setScalar(Math.min(0.03, dd * 0.03) * (0.6 + 0.8 * near));
      c.dot.material.opacity = occ(c.dot);
    }

    renderer.render(scene, camera);
  }

  /** 把航線上的點投影到螢幕（像素）；被地球擋住或在鏡頭後方時 visible = false。 */
  function project(v: V3) {
    tmp.set(v[0], v[1], v[2]);
    const hidden = occluded(tmp);
    tmp.project(camera);
    const visible = !hidden && tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, visible };
  }

  function dispose() {
    renderer.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    glowTex.dispose();
  }

  return { render, resize, project, dispose, ready, points: { tpe, sfo } };
}

export type Globe = ReturnType<typeof createGlobe>;
