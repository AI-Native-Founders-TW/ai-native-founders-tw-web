/**
 * 章節 02「一次就夠」的捲動編排。
 *
 * 節奏（T = 捲動進度，0–1；進場前為負值）：
 *   起  T -0.12–0.30  同一個問題被問了一百次：泡泡陸續冒出、錯落漂浮、帶景深與視差；計數器 ×001 → ×100
 *   承  T  0.27–0.56  開源筆記出現；每個泡泡沿弧線被吸進「同一題」的那一行，計數器倒數回 ×001
 *   轉  T  0.52–0.74  筆記發光（環形光、掃光、光暈），向外擴散成上百個光點
 *   停  T  0.66–1.00  筆記退到一側；「1 次交流 → N 位創業者」、標題與內文依序落定
 *
 * 所有東西都由同一個平滑後的進度驅動，所以可以任意往回捲。
 */
import { type EngineState, onTick, ScrollTrigger } from '../../engine';
import { rng } from './field';

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : Math.min(v, b));
const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const outCubic = (t: number) => 1 - (1 - t) ** 3;
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const outBack = (t: number) => {
  const c = 1.5;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

const T = {
  grow: [-0.1, 0.2],
  countUp: [-0.06, 0.3],
  cardIn: [0.26, 0.35],
  conv: [0.3, 0.46], // 每個泡泡的起點分布區間
  convDur: 0.09,
  glow: [0.52, 0.62],
  burst: 0.6,
  move: [0.66, 0.79],
  stat: [0.71, 0.83],
  copy: [0.79, 0.93],
} as const;

interface Bubble {
  el: HTMLElement;
  k: number;
  d: number;
  w: number;
  h: number;
  x: number;
  y: number;
  tilt: number;
  ph: number;
  sp: number;
  appear: number;
  conv: number;
  curve: number;
  visible: boolean;
}

interface Spark {
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  delay: number;
  dur: number;
  curve: number;
  size: number;
  z: number;
  hue: number;
  tw: number;
  link: number;
}

const DEPTH = [
  { s: 0.82, o: 0.4, para: 0.12, mouse: 6, z: 1 },
  { s: 0.94, o: 0.72, para: 0.24, mouse: 14, z: 2 },
  { s: 1, o: 1, para: 0.4, mouse: 26, z: 3 },
];

export function initCoffeeChat(root: HTMLElement, s: EngineState) {
  const wrap = root.querySelector<HTMLElement>('.cc-wrap')!;
  const stage = root.querySelector<HTMLElement>('.cc-stage')!;
  const canvas = root.querySelector<HTMLCanvasElement>('.cc-sparks')!;
  const note = root.querySelector<HTMLElement>('.cc-note')!;
  const ring = root.querySelector<HTMLElement>('.cc-note-ring')!;
  const sweep = root.querySelector<HTMLElement>('.cc-sweep')!;
  const halo = root.querySelector<HTMLElement>('.cc-halo')!;
  const counter = root.querySelector<HTMLElement>('.cc-counter')!;
  const counterN = root.querySelector<HTMLElement>('.cc-counter-n')!;
  const stat = root.querySelector<HTMLElement>('.cc-stat')!;
  const statParts = Array.from(stat.children).filter(
    (c) => !c.classList.contains('sr-only'),
  ) as HTMLElement[];
  const arrow = stat.querySelector<HTMLElement>('.cc-stat-arrow');
  const copy = root.querySelector<HTMLElement>('.cc-copy')!;
  const kicker = root.querySelector<HTMLElement>('.cc-kicker')!;
  const body = root.querySelector<HTMLElement>('.cc-body')!;
  const lines = Array.from(root.querySelectorAll<HTMLElement>('.cc-line'));
  const dupEls = lines.map((l) => l.querySelector<HTMLElement>('.cc-dup b'));
  const ctx = canvas.getContext('2d')!;

  root.classList.add('is-live');
  const low = s.quality === 'low';

  const all: Bubble[] = Array.from(root.querySelectorAll<HTMLElement>('.cc-bubble')).map(
    (el, i) => ({
      el,
      k: Number(el.dataset.k),
      d: el.classList.contains('d0') ? 0 : el.classList.contains('d1') ? 1 : 2,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
      tilt: 0,
      ph: i * 1.7,
      sp: 0,
      appear: 0,
      conv: 0,
      curve: 0,
      visible: true,
    }),
  );
  for (const b of all) b.el.style.zIndex = String(DEPTH[b.d].z);

  let W = 0;
  let H = 0;
  let mobile = false;
  let bubbles: Bubble[] = [];
  let sparks: Spark[] = [];
  let lineTargets: { x: number; y: number; s: number }[] = [];
  let lineTotals: number[] = [];
  let card = { w: 0, h: 0 };
  let statSize = { w: 0, h: 0 };
  let dpr = 1;
  let glowSprite: HTMLCanvasElement | null = null;

  function layout() {
    W = stage.clientWidth;
    H = stage.clientHeight;
    mobile = W < 768;
    dpr = Math.min(window.devicePixelRatio || 1, low ? 1 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    bubbles = all.filter((b) => getComputedStyle(b.el).display !== 'none');
    for (const b of all) b.visible = bubbles.includes(b);
    for (const b of bubbles) {
      b.w = b.el.offsetWidth;
      b.h = b.el.offsetHeight;
    }

    // 錯落的格點 → 每格隨機抖動，避免擠成一團
    const r = rng(7 + bubbles.length);
    const n = bubbles.length;
    const cols = Math.max(3, Math.round(Math.sqrt((n * W) / H) * (mobile ? 0.8 : 1)));
    const rows = Math.ceil(n / cols);
    const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => r() - 0.5);
    const top = mobile ? 0.14 : 0.08;
    bubbles.forEach((b, i) => {
      const c = cells[i];
      const cx = (c % cols) + 0.5 + (r() - 0.5) * 0.8;
      const cy = Math.floor(c / cols) + 0.5 + (r() - 0.5) * 0.7;
      // 下方多留一點，因為捲動時會往上漂
      b.x = mix(-0.04, 1.04, cx / cols) * W;
      b.y = mix(top, 1.18, cy / rows) * H;
      b.tilt = (r() - 0.5) * 7;
      b.sp = 0.35 + r() * 0.45;
      b.curve = (r() - 0.5) * 0.9;
    });
    // 出現順序：隨機；收攏順序：離中心近的先
    const order = [...bubbles].sort(() => r() - 0.5);
    order.forEach((b, i) => {
      b.appear = mix(T.grow[0], T.grow[1], (i / n) ** 1.15);
    });
    const byDist = [...bubbles].sort(
      (a, b) => Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2),
    );
    byDist.forEach((b, i) => {
      b.conv = mix(T.conv[0], T.conv[1], i / Math.max(1, n - 1)) + (r() - 0.5) * 0.02;
    });

    // 筆記卡大小與每一行的位置（以未變形的版面計算）
    card = { w: note.offsetWidth, h: note.offsetHeight };
    const inner = note.firstElementChild?.nextElementSibling as HTMLElement;
    lineTargets = lines.map((li) => {
      const q = li.querySelector<HTMLElement>('.cc-line-q')!;
      return {
        x: inner.offsetLeft + q.offsetLeft + Math.min(q.offsetWidth, 260) / 2,
        y: inner.offsetTop + li.offsetTop + li.offsetHeight / 2,
        s: q.offsetHeight / 30,
      };
    });
    lineTotals = lines.map((_, k) => bubbles.filter((b) => b.k === k).length);
    statSize = { w: stat.offsetWidth, h: stat.offsetHeight };

    // 光點：在畫面中分散（簡化版的 Poisson disk）
    const count = low ? 90 : mobile ? 150 : s.quality === 'high' ? 260 : 200;
    const minD = Math.sqrt((W * H) / count) * 0.62;
    const pr = rng(99);
    sparks = [];
    let guard = 0;
    while (sparks.length < count && guard++ < count * 40) {
      const tx = mix(0.02, 0.98, pr()) * W;
      const ty = mix(0.04, 0.97, pr()) * H;
      if (
        sparks.some(
          (p) =>
            Math.abs(p.tx - tx) < minD &&
            Math.abs(p.ty - ty) < minD &&
            Math.hypot(p.tx - tx, p.ty - ty) < minD,
        )
      )
        continue;
      const dist = Math.hypot(tx - W / 2, ty - H / 2) / Math.hypot(W / 2, H / 2);
      sparks.push({
        ox: (pr() - 0.5) * 0.8,
        oy: (pr() - 0.5) * 0.8,
        tx,
        ty,
        delay: dist * 0.05 + pr() * 0.03,
        dur: 0.07 + pr() * 0.05,
        curve: (pr() - 0.5) * 0.5,
        size: 0.8 + pr() ** 3 * 2.4,
        z: 0.3 + pr() * 0.7,
        hue: pr(),
        tw: pr() * Math.PI * 2,
        link: -1,
      });
    }
    // 每個光點連到最近的一個鄰居（星座線）
    sparks.forEach((p, i) => {
      let best = -1;
      let bd = minD * 1.9;
      sparks.forEach((q, j) => {
        if (j === i) return;
        const dd = Math.hypot(p.tx - q.tx, p.ty - q.ty);
        if (dd < bd) {
          bd = dd;
          best = j;
        }
      });
      p.link = best > i ? best : -1;
    });
    glowSprite = makeGlow();
  }

  function makeGlow() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(222,235,255,0.85)');
    grd.addColorStop(0.45, 'rgba(110,170,255,0.22)');
    grd.addColorStop(1, 'rgba(77,71,254,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  const titleLines = Array.from(root.querySelectorAll<HTMLElement>('.cc-ph-in'));
  document.fonts.ready.then(() => layout());

  // ── 捲動 ──
  let target = -0.12;
  let prog = -0.12;
  let active = false;
  const main = ScrollTrigger.create({ trigger: wrap, start: 'top top', end: 'bottom bottom' });
  const entry = ScrollTrigger.create({ trigger: wrap, start: 'top bottom', end: 'top top' });
  const io = new IntersectionObserver(([e]) => (active = e.isIntersecting), {
    rootMargin: '10% 0px',
  });
  io.observe(wrap);

  // 游標視差
  let mx = 0;
  let my = 0;
  let smx = 0;
  let smy = 0;
  if (!s.isTouch) {
    window.addEventListener(
      'pointermove',
      (e) => {
        mx = (e.clientX / window.innerWidth) * 2 - 1;
        my = (e.clientY / window.innerHeight) * 2 - 1;
      },
      { passive: true },
    );
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  layout();
  ScrollTrigger.refresh();

  let lastCount = '';
  const lastDup: number[] = [];
  let bubblesGone = false;
  let canvasClear = true;

  onTick((time, dt) => {
    if (!active) return;
    target = main.progress > 0 ? main.progress : (entry.progress - 1) * 0.12;
    const k = 1 - Math.exp(-(dt / 1000) * 9);
    prog += (target - prog) * k;
    if (Math.abs(target - prog) < 0.00005) prog = target;
    smx += (mx - smx) * 0.06;
    smy += (my - smy) * 0.06;
    render(prog, time);
  });

  function cardPose(t: number) {
    const cIn = outCubic(range(t, T.cardIn[0], T.cardIn[1]));
    const mv = inOut(range(t, T.move[0], T.move[1]));
    const cx0 = W / 2;
    const cy0 = mobile ? H * 0.46 : H / 2;
    const sc1 = mobile ? 0.62 : Math.min(0.92, (H * 0.62) / card.h);
    const cx1 = mobile ? W / 2 : W * 0.73;
    const cy1 = mobile ? 70 + (card.h * sc1) / 2 : H * 0.42;
    return {
      x: mix(cx0, cx1, mv),
      y: mix(cy0, cy1, mv) + (1 - cIn) * 40,
      s: mix(mix(0.9, 1, cIn), sc1, mv),
      o: cIn,
      mv,
      sc1,
    };
  }

  function render(t: number, time: number) {
    const pose = cardPose(t);

    // ── 泡泡 ──
    const arrived = new Array(lines.length).fill(0);
    const flash = new Array(lines.length).fill(0);
    if (t < 0.62 || !bubblesGone) {
      bubblesGone = t >= 0.62;
      for (const b of bubbles) {
        const dp = DEPTH[b.d];
        const ap = range(t, b.appear, b.appear + 0.025);
        const cp = range(t, b.conv, b.conv + T.convDur);
        const ce = inOut(cp);
        // 漂浮位置：慢速飄移 + 捲動視差 + 游標視差
        const tt = time * b.sp;
        const para = Math.min(t, b.conv) * dp.para * H;
        const fx = b.x + Math.sin(tt + b.ph) * (6 + b.d * 6) - smx * dp.mouse;
        const fy =
          b.y + Math.cos(tt * 0.8 + b.ph * 1.3) * (4 + b.d * 4) - para - smy * dp.mouse * 0.6;
        const lt = lineTargets[b.k];
        const tx = pose.x - card.w / 2 + (lt?.x ?? card.w / 2);
        const ty = pose.y - card.h / 2 + (lt?.y ?? card.h / 2);
        // 弧線：沿垂直方向偏移
        const dx = tx - fx;
        const dy = ty - fy;
        const arc = Math.sin(Math.PI * ce) * b.curve;
        const x = mix(fx, tx, ce) - dy * arc;
        const y = mix(fy, ty, ce) + dx * arc;
        const scale = mix(dp.s * mix(0.6, 1, outBack(ap)), (lt?.s ?? 0.6) * 0.95, ce);
        const op = dp.o * ap * (1 - range(cp, 0.62, 1));
        const rot = b.tilt * (1 - ce) + Math.sin(tt * 0.7 + b.ph) * 1.2 * (1 - ce);
        if (op <= 0.001) {
          if (b.el.style.opacity !== '0') b.el.style.opacity = '0';
        } else {
          b.el.style.opacity = op.toFixed(3);
          b.el.style.transform = `translate3d(${(x - b.w / 2).toFixed(1)}px,${(y - b.h / 2).toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        }
        if (cp >= 0.9) arrived[b.k]++;
        const endT = b.conv + T.convDur;
        flash[b.k] = Math.max(flash[b.k], 1 - Math.abs(t - endT) / 0.03);
      }
    } else {
      for (let i = 0; i < lines.length; i++) arrived[i] = lineTotals[i];
    }

    // ── 計數器：×001 → ×100 → 收攏後倒數回 ×001 ──
    const up = range(t, T.countUp[0], T.countUp[1]);
    const totalArrived = arrived.reduce((a, b) => a + b, 0);
    const convFrac = bubbles.length ? totalArrived / bubbles.length : 0;
    const n = Math.max(1, Math.round(1 + 99 * up ** 1.4 - 99 * convFrac));
    const label = String(n).padStart(3, '0');
    if (label !== lastCount) {
      counterN.textContent = label;
      lastCount = label;
    }
    counter.style.opacity = String(range(t, -0.1, -0.02) * (1 - range(t, 0.56, 0.64)));

    // ── 筆記卡 ──
    note.style.opacity = pose.o.toFixed(3);
    note.style.transform = `translate3d(${(pose.x - card.w / 2).toFixed(1)}px,${(pose.y - card.h / 2).toFixed(1)}px,0) scale(${pose.s.toFixed(4)})`;
    lines.forEach((li, i) => {
      const a = lineTotals[i] ? arrived[i] / lineTotals[i] : 1;
      const f = clamp(flash[i]) * (t < 0.6 ? 1 : 0);
      li.style.opacity = (0.16 + 0.84 * a).toFixed(3);
      li.style.backgroundColor = f > 0 ? `rgb(25 172 254 / ${(f * 0.14).toFixed(3)})` : '';
      const dup = dupEls[i];
      if (dup && lastDup[i] !== arrived[i]) {
        dup.textContent = String(arrived[i]);
        (dup.parentElement as HTMLElement).style.opacity = arrived[i] > 0 ? '0.9' : '0';
        lastDup[i] = arrived[i];
      }
    });

    // ── 發光 ──
    const g = range(t, T.glow[0], T.glow[1]);
    ring.style.opacity = (smooth(g) * (1 - 0.55 * range(t, 0.7, 0.85))).toFixed(3);
    ring.style.setProperty('--cc-angle', `${(t * 900 + time * 40) % 360}deg`);
    const sw = range(t, 0.53, 0.61);
    sweep.style.opacity = sw > 0 && sw < 1 ? '1' : '0';
    sweep.style.transform = `translateX(${mix(-60, 60, inOut(sw))}%)`;
    const burstP = range(t, T.burst - 0.01, T.burst + 0.05);
    const haloS = mix(0.15, 1, outCubic(g)) + burstP * 0.35;
    const haloO = smooth(g) * (1 - 0.6 * range(t, 0.64, 0.8)) + 0.05 * Math.sin(time * 2) * g;
    halo.style.opacity = clamp(haloO).toFixed(3);
    halo.style.transform = `translate3d(${pose.x.toFixed(1)}px,${pose.y.toFixed(1)}px,0) scale(${haloS.toFixed(3)})`;
    note.style.boxShadow =
      g > 0
        ? `0 40px 80px -30px rgb(0 0 0 / 0.85), 0 0 ${(80 * g).toFixed(0)}px ${(4 * g).toFixed(0)}px rgb(25 172 254 / ${(0.35 * g * (1 - 0.5 * range(t, 0.7, 0.85))).toFixed(3)})`
        : '';

    // ── 光點 ──
    drawSparks(t, time, pose);

    // ── 1 次交流 → N 位創業者 ──
    const statX = mobile ? (W - statSize.w) / 2 : pose.x - statSize.w / 2;
    const statY = mobile
      ? pose.y + (card.h * pose.s) / 2 + 22
      : Math.min(H - statSize.h - 40, pose.y + (card.h * pose.s) / 2 + 36);
    stat.style.transform = `translate3d(${statX.toFixed(1)}px,${statY.toFixed(1)}px,0)`;
    statParts.forEach((el, i) => {
      const a = range(t, T.stat[0] + i * 0.016, T.stat[0] + i * 0.016 + 0.04);
      el.style.opacity = a.toFixed(3);
      el.style.transform = `translateY(${((1 - outCubic(a)) * 18).toFixed(1)}px)`;
    });
    if (arrow)
      arrow.style.setProperty(
        '--draw',
        String(1 - inOut(range(t, T.stat[0] + 0.03, T.stat[0] + 0.07))),
      );

    // ── 標題與內文落定 ──
    const cp = range(t, T.copy[0], T.copy[1]);
    copy.style.setProperty('--scrim', range(t, 0.74, 0.84).toFixed(3));
    kicker.style.opacity = range(cp, 0, 0.25).toFixed(3);
    kicker.style.transform = `translateY(${((1 - range(cp, 0, 0.25)) * 10).toFixed(1)}px)`;
    titleLines.forEach((el, i) => {
      const a = outCubic(range(cp, 0.08 + i * 0.1, 0.48 + i * 0.1));
      el.style.transform = `translate3d(0,${((1 - a) * 110).toFixed(1)}%,0)`;
    });
    const ba = outCubic(range(cp, 0.45, 0.85));
    body.style.opacity = ba.toFixed(3);
    body.style.transform = `translate3d(0,${((1 - ba) * 16).toFixed(1)}px,0)`;
  }

  function drawSparks(t: number, time: number, pose: ReturnType<typeof cardPose>) {
    if (t < T.burst - 0.005) {
      if (!canvasClear) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvasClear = true;
      }
      return;
    }
    canvasClear = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    // 擴散的起點：筆記卡發光的位置（擴散時卡片還在中央）
    const origin = cardPose(T.burst);
    const ow = card.w * origin.s;
    const oh = card.h * origin.s;
    const settle = range(t, 0.75, 0.9);
    const pos: { x: number; y: number; f: number }[] = new Array(sparks.length);
    const maxR = Math.hypot(W, H);
    const waveR = ((time * 260) % (maxR * 1.3)) - 60;

    // 擴散瞬間的光束
    for (let i = 0; i < sparks.length; i++) {
      const p = sparks[i];
      const f = range(t, T.burst + p.delay, T.burst + p.delay + p.dur);
      const e = outCubic(f);
      const ox = origin.x + p.ox * ow;
      const oy = origin.y + p.oy * oh;
      const dx = p.tx - ox;
      const dy = p.ty - oy;
      const arc = Math.sin(Math.PI * e) * p.curve;
      const px = mix(ox, p.tx, e) - dy * arc - smx * 14 * p.z * settle;
      const py =
        mix(oy, p.ty, e) +
        dx * arc -
        smy * 10 * p.z * settle +
        Math.sin(time * 0.6 + p.tw) * 3 * p.z * settle;
      pos[i] = { x: px, y: py, f };
    }

    // 從筆記射出的細線（擴散中）
    const beam = range(t, T.burst, T.burst + 0.03) * (1 - range(t, T.burst + 0.06, T.burst + 0.14));
    if (beam > 0) {
      ctx.lineWidth = 1;
      for (let i = 0; i < sparks.length; i += 2) {
        const q = pos[i];
        if (q.f <= 0 || q.f >= 1) continue;
        ctx.strokeStyle = `rgba(143,216,255,${(0.1 * beam * (1 - q.f)).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(pose.x, pose.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }

    // 星座線（落定後）
    if (settle > 0) {
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = `rgba(184,192,224,${(0.12 * settle).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < sparks.length; i++) {
        const j = sparks[i].link;
        if (j < 0) continue;
        ctx.moveTo(pos[i].x, pos[i].y);
        ctx.lineTo(pos[j].x, pos[j].y);
      }
      ctx.stroke();
    }

    // 分享線：筆記持續把內容傳給一部分光點（一條條細線＋沿線移動的光點）
    if (settle > 0) {
      ctx.lineWidth = 0.8;
      for (let i = 0; i < sparks.length; i += 7) {
        const q = pos[i];
        const p = sparks[i];
        const mx2 = (pose.x + q.x) / 2 + (q.y - pose.y) * 0.18;
        const my2 = (pose.y + q.y) / 2 - (q.x - pose.x) * 0.18;
        ctx.strokeStyle = `rgba(143,216,255,${(0.07 * settle).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(pose.x, pose.y);
        ctx.quadraticCurveTo(mx2, my2, q.x, q.y);
        ctx.stroke();
        const u = (time * 0.22 + p.tw / 6.283) % 1;
        const bx = (1 - u) * (1 - u) * pose.x + 2 * (1 - u) * u * mx2 + u * u * q.x;
        const by = (1 - u) * (1 - u) * pose.y + 2 * (1 - u) * u * my2 + u * u * q.y;
        ctx.globalAlpha = settle * Math.sin(Math.PI * u) * 0.9;
        ctx.fillStyle = '#decffe';
        ctx.beginPath();
        ctx.arc(bx, by, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    for (let i = 0; i < sparks.length; i++) {
      const p = sparks[i];
      const q = pos[i];
      if (q.f <= 0) continue;
      const tw = 0.65 + 0.35 * Math.sin(time * (1.2 + p.z) + p.tw);
      const landed = q.f >= 1;
      // 「分享波」：從筆記一圈圈往外傳的亮度波，代表一次分享持續被傳下去
      const dist = Math.hypot(q.x - pose.x, q.y - pose.y);
      const wd = dist - waveR;
      const wave = landed ? Math.exp(-(wd * wd) / 3200) * settle : 0;
      const a = Math.min(
        1,
        (landed ? tw * mix(1, 0.7, settle) + wave * 0.9 : 1) * mix(0.55, 1, p.z),
      );
      // 尾跡
      if (!landed) {
        const back = outCubic(Math.max(0, q.f - 0.12));
        const ox = origin.x + p.ox * ow;
        const oy = origin.y + p.oy * oh;
        ctx.strokeStyle = `rgba(143,216,255,${(0.45 * a).toFixed(3)})`;
        ctx.lineWidth = p.size * 0.9;
        ctx.beginPath();
        ctx.moveTo(mix(ox, p.tx, back), mix(oy, p.ty, back));
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      const r = p.size * (landed ? 1 + wave * 0.8 : 1.4) * (1 + 0.4 * (1 - q.f));
      if (glowSprite) {
        ctx.globalAlpha = a * 0.55;
        const gs = r * 7;
        ctx.drawImage(glowSprite, q.x - gs / 2, q.y - gs / 2, gs, gs);
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = p.hue < 0.45 ? '#cfeaff' : p.hue < 0.8 ? '#decffe' : '#8fd8ff';
      ctx.beginPath();
      ctx.arc(q.x, q.y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
