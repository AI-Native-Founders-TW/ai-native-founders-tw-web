/**
 * 章節 03「出海」的捲動編排與畫面來源切換。
 *
 * 節奏（p = 章節進度 0–1）：
 *   起  p 0.00–0.14  台北深夜。大標「從台北，到舊金山。」；鏡頭貼著地表，光點在台北待命
 *   承  p 0.14–0.50  起飛、拉高到太平洋上空俯瞰整條航線；經過檢查點 1、2
 *   轉  p 0.50–0.86  下降、天色由深藍轉為破曉；經過檢查點 3、4
 *   停  p 0.86–1.00  抵達舊金山，天藍與淡紫；「不承諾引薦」的註腳落定
 */
import { type EngineState, onTick, ScrollTrigger, scrollToTarget } from '../../engine';
import type { FrameSequence } from './frame-sequence';
import { air, CHECKPOINT_T, formatLatLon, ground, ROUTE_KM, type V3 } from './geo';
import type { Globe } from './globe-scene';
import { svgScene } from './svg-scene';

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : Math.min(v, b));
const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const outCubic = (t: number) => 1 - (1 - t) ** 3;
const sineInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

const FLY = [0.14, 0.86] as const;
export const headAt = (p: number) => sineInOut(range(p, FLY[0], FLY[1]));
const pAtHead = (h: number) => FLY[0] + ((FLY[1] - FLY[0]) * Math.acos(1 - 2 * clamp(h))) / Math.PI;
const dawnAt = (p: number) => smooth(range(p, 0.5, 0.93));

type Mode = 'webgl' | 'frames' | 'svg';

export function initVoyage(root: HTMLElement, s: EngineState) {
  const wrap = root.querySelector<HTMLElement>('.vy-wrap')!;
  const stage = root.querySelector<HTMLElement>('.vy-stage')!;
  const visual = root.querySelector<HTMLElement>('.vy-visual')!;
  const canvas = root.querySelector<HTMLCanvasElement>('.vy-canvas')!;
  const intro = root.querySelector<HTMLElement>('.vy-intro')!;
  const kicker = root.querySelector<HTMLElement>('.vy-kicker')!;
  const phrases = Array.from(root.querySelectorAll<HTMLElement>('.vy-ph-in'));
  const od = root.querySelector<HTMLElement>('.vy-od')!;
  const body = root.querySelector<HTMLElement>('.vy-body')!;
  const cps = Array.from(root.querySelectorAll<HTMLElement>('.vy-cp'));
  const data = root.querySelector<HTMLElement>('.vy-data')!;
  const posEl = root.querySelector<HTMLElement>('.vy-pos')!;
  const flownEl = root.querySelector<HTMLElement>('.vy-flown')!;
  const remainEl = root.querySelector<HTMLElement>('.vy-remain')!;
  const rail = root.querySelector<HTMLElement>('.vy-rail')!;
  const railCps = Array.from(root.querySelectorAll<HTMLButtonElement>('.vy-rail-cp'));
  const dest = root.querySelector<HTMLElement>('.vy-dest')!;
  const foot = root.querySelector<HTMLElement>('.vy-foot')!;
  const tags = new Map(
    Array.from(root.querySelectorAll<HTMLElement>('.vy-tag')).map(
      (el) => [el.dataset.tag!, el] as const,
    ),
  );

  root.classList.add('is-live');
  let mode: Mode = s.quality === 'low' ? 'svg' : 'webgl';
  root.dataset.mode = mode;
  const mobile = () => window.innerWidth < 768;

  let globe: Globe | null = null;
  let frames: FrameSequence | null = null;
  let W = 0;
  let H = 0;

  // ── 畫面來源 ──
  const manifestUrl = root.dataset.manifest;
  const setup = async () => {
    if (manifestUrl && s.quality !== 'low') {
      const { loadManifest, FrameSequence } = await import('./frame-sequence');
      const m = await loadManifest(manifestUrl);
      if (m) {
        frames = new FrameSequence(canvas, manifestUrl, m, mobile());
        frames.resize(W, H);
        frames.warm();
        mode = 'frames';
        root.dataset.mode = mode;
        return;
      }
    }
    if (mode === 'webgl') {
      try {
        const { createGlobe } = await import('./globe-scene');
        const g = createGlobe(canvas, { quality: s.quality, mobile: mobile() });
        g.resize(W, H);
        // 點陣分段產生、shader 先行編譯，都完成才交給 render；進章節時不會頓一下
        await g.ready;
        globe = g;
      } catch (err) {
        console.warn('[voyage] WebGL 無法使用，改用 SVG 版', err);
        mode = 'svg';
        root.dataset.mode = mode;
      }
    }
  };
  // 章節接近（前 1.5 個視窗）才載入 Three.js／影格
  let setupStarted = false;
  const near = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting && !setupStarted) {
        setupStarted = true;
        setup().then(() => render(prog, performance.now() / 1000));
      }
    },
    { rootMargin: '150% 0px' },
  );
  near.observe(wrap);
  // 進入畫面附近才載高解析度影格
  const nearer = new IntersectionObserver(([e]) => e.isIntersecting && frames?.loadHiRes(), {
    rootMargin: '40% 0px',
  });
  nearer.observe(wrap);

  // ── SVG 版的元素 ──
  const svg = root.querySelector<SVGSVGElement>('.vy-svg')!;
  const svgEls = {
    stars: svg.querySelector<SVGGElement>('.vy-svg-stars')!,
    dawn: svg.querySelector<SVGEllipseElement>('.vy-svg-dawn')!,
    circles: Array.from(
      svg.querySelectorAll<SVGCircleElement>(
        '.vy-svg-earth, .vy-svg-dots, .vy-svg-shade, .vy-svg-limb',
      ),
    ),
    paths: Array.from(
      svg.querySelectorAll<SVGPathElement>('.vy-svg-plan, .vy-svg-glow, .vy-svg-route'),
    ),
    cps: Array.from(svg.querySelectorAll<SVGGElement>('.vy-svg-cp')),
    pulses: Array.from(svg.querySelectorAll<SVGCircleElement>('.vy-svg-cp-pulse')),
    cities: Array.from(svg.querySelectorAll<SVGGElement>('.vy-svg-city')),
    head: svg.querySelector<SVGGElement>('.vy-svg-head')!,
  };
  let scene2d = svgScene(1600, 900);
  function layoutSvg() {
    scene2d = svgScene(Math.max(1, W), Math.max(1, H));
    const S = scene2d;
    svg.setAttribute('viewBox', `0 0 ${S.w} ${S.h}`);
    for (const c of svgEls.circles) {
      c.setAttribute('cx', String(S.earth.cx));
      c.setAttribute('cy', String(S.earth.cy));
      c.setAttribute('r', String(S.earth.r));
    }
    for (const p of svgEls.paths) p.setAttribute('d', S.d);
    svgEls.dawn.setAttribute('cx', String(S.dawn.x));
    svgEls.dawn.setAttribute('cy', String(S.dawn.y));
    svgEls.dawn.setAttribute('rx', String(S.w * 0.6));
    svgEls.dawn.setAttribute('ry', String(S.h * 0.55));
    CHECKPOINT_T.forEach((t, i) => {
      const p = S.at(t);
      svgEls.cps[i]?.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    });
    svgEls.cities[0]?.setAttribute(
      'transform',
      `translate(${S.tpe.x.toFixed(1)} ${S.tpe.y.toFixed(1)})`,
    );
    svgEls.cities[1]?.setAttribute(
      'transform',
      `translate(${S.sfo.x.toFixed(1)} ${S.sfo.y.toFixed(1)})`,
    );
    svgEls.stars.innerHTML = S.stars
      .map(
        (st) =>
          `<circle cx="${st.x.toFixed(1)}" cy="${st.y.toFixed(1)}" r="${st.r.toFixed(2)}" opacity="${st.o.toFixed(2)}"/>`,
      )
      .join('');
  }

  function layout() {
    W = visual.clientWidth;
    H = visual.clientHeight;
    layoutSvg();
    globe?.resize(W, H);
    frames?.resize(W, H);
    tagSize.clear();
  }
  const tagSize = new Map<string, { w: number; h: number }>();
  const ro = new ResizeObserver(() => {
    layout();
    render(prog, performance.now() / 1000);
  });
  ro.observe(stage);
  layout();

  // ── 捲動 ──
  const main = ScrollTrigger.create({ trigger: wrap, start: 'top top', end: 'bottom bottom' });
  const entry = ScrollTrigger.create({ trigger: wrap, start: 'top bottom', end: 'top top' });
  let active = false;
  const io = new IntersectionObserver(([e]) => (active = e.isIntersecting), {
    rootMargin: '5% 0px',
  });
  io.observe(wrap);
  ScrollTrigger.refresh();

  railCps.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const p = pAtHead(CHECKPOINT_T[i] + 0.02);
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      scrollToTarget(top + p * (wrap.offsetHeight - window.innerHeight));
    });
  });

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

  let prog = 0;
  let entryP = 0;
  onTick((time, dt) => {
    if (!active) return;
    const k = 1 - Math.exp(-(dt / 1000) * 7);
    prog += (main.progress - prog) * k;
    if (Math.abs(main.progress - prog) < 0.00003) prog = main.progress;
    entryP = entry.progress;
    smx += (mx - smx) * 0.04;
    smy += (my - smy) * 0.04;
    render(prog, time);
  });

  const total = Math.round(ROUTE_KM);
  const fmt = (n: number) => n.toLocaleString('en-US');
  let lastPos = '';
  let lastFlown = -1;

  function placeTag(key: string, x: number, y: number, o: number) {
    const el = tags.get(key);
    if (!el) return;
    let sz = tagSize.get(key);
    if (!sz) {
      sz = { w: el.offsetWidth, h: el.offsetHeight };
      tagSize.set(key, sz);
    }
    if (o <= 0.001) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translate3d(${(x - sz.w / 2).toFixed(1)}px,${(y - sz.h - 26).toFixed(1)}px,0)`;
  }

  function render(p: number, time: number) {
    const head = headAt(p);
    const dawn = dawnAt(p);
    stage.style.setProperty('--dawn', dawn.toFixed(3));
    stage.style.setProperty('--head', head.toFixed(4));

    // ── 畫面 ──
    if (mode === 'webgl' && globe) {
      globe.render({ p, head, dawn, mx: smx, my: smy }, time);
    } else if (mode === 'frames' && frames) {
      frames.setProgress(range(p, 0.02, 0.96));
    } else if (mode === 'svg') {
      renderSvg(head, time);
    }

    // ── 投影標籤 ──
    if (mode === 'webgl' && globe) {
      const proj = globe.project;
      const t = proj(scale1(ground(0)));
      placeTag('tpe', t.x, t.y, t.visible ? 1 - range(p, 0.18, 0.26) : 0);
      const f = proj(scale1(ground(1)));
      placeTag(
        'sfo',
        f.x,
        f.y,
        f.visible ? range(head, 0.88, 0.96) * (1 - range(p, 0.9, 0.95)) : 0,
      );
      CHECKPOINT_T.forEach((ct, i) => {
        const q = proj(air(ct));
        const o = range(head, ct - 0.1, ct - 0.04) * (1 - range(head, ct + 0.05, ct + 0.1));
        placeTag(`cp${i}`, q.x, q.y, q.visible ? o : 0);
      });
    } else if (mode === 'svg') {
      const S = scene2d;
      placeTag('tpe', S.tpe.x, S.tpe.y, 1 - range(p, 0.2, 0.28));
      placeTag('sfo', S.sfo.x, S.sfo.y, range(head, 0.85, 0.95) * (1 - range(p, 0.9, 0.95)));
      CHECKPOINT_T.forEach((ct, i) => {
        const q = S.at(ct);
        const o = range(head, ct - 0.08, ct - 0.03) * (1 - range(head, ct + 0.05, ct + 0.1));
        placeTag(`cp${i}`, q.x, q.y, o);
      });
    } else {
      for (const key of tags.keys()) placeTag(key, 0, 0, 0);
    }

    // ── 起：大標 ──
    const e = entryP;
    const out = range(p, 0.07, 0.14);
    intro.style.opacity = (1 - out).toFixed(3);
    intro.style.filter = out > 0 ? `blur(${(out * 8).toFixed(1)}px)` : '';
    kicker.style.opacity = range(e, 0.55, 0.9).toFixed(3);
    phrases.forEach((el, i) => {
      const a = outCubic(
        range(e, 0.45 + i * 0.12, 0.95 + i * 0.12) + range(p, 0, 0.02 + i * 0.02) * (i > 0 ? 1 : 0),
      );
      el.style.transform = `translate3d(0,${((1 - a) * 110 - out * 30).toFixed(1)}%,0)`;
    });
    od.style.opacity = (range(e, 0.8, 1) * 0.999 + range(p, 0, 0.02) * 0.001).toFixed(3);
    od.style.transform = `translateY(${((1 - range(e, 0.8, 1)) * 12).toFixed(1)}px)`;

    // ── 承：內文 ──
    const bIn = range(p, 0.13, 0.17);
    const bOut = range(p, 0.27, 0.31);
    body.style.opacity = (bIn * (1 - bOut)).toFixed(3);
    body.style.transform = `translate3d(0,${((1 - outCubic(bIn)) * 20 - bOut * 16).toFixed(1)}px,0)`;

    // ── 檢查點卡 ──
    cps.forEach((el, i) => {
      const ct = CHECKPOINT_T[i];
      const a = outCubic(range(head, ct - 0.05, ct - 0.01));
      const b = range(head, ct + 0.11, ct + 0.15);
      const o = a * (1 - b);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate3d(${(-b * 24).toFixed(1)}px,${((1 - a) * 28).toFixed(1)}px,0)`;
      el.style.visibility = o > 0.001 ? 'visible' : 'hidden';
    });
    railCps.forEach((btn, i) => {
      const ct = CHECKPOINT_T[i];
      btn.classList.toggle('is-passed', head >= ct - 0.005);
      btn.classList.toggle('is-current', head >= ct - 0.04 && head < ct + 0.15);
    });

    // ── 飛行資料 ──
    const dIn = range(p, 0.12, 0.16) * (1 - range(p, 0.86, 0.9));
    data.style.opacity = dIn.toFixed(3);
    rail.style.opacity = range(p, 0.12, 0.16).toFixed(3);
    const pos = formatLatLon(ground(head));
    if (pos !== lastPos) {
      posEl.textContent = pos;
      lastPos = pos;
    }
    const flown = Math.round((total * head) / 10) * 10;
    if (flown !== lastFlown) {
      flownEl.textContent = fmt(flown);
      remainEl.textContent = fmt(Math.max(0, total - flown));
      lastFlown = flown;
    }

    // ── 停：抵達 ──
    const aIn = outCubic(range(p, 0.87, 0.92));
    dest.style.opacity = aIn.toFixed(3);
    dest.style.transform = `translate3d(0,${((1 - aIn) * 30).toFixed(1)}px,0)`;
    const fIn = outCubic(range(p, 0.91, 0.96));
    foot.style.opacity = fIn.toFixed(3);
    foot.style.transform = `translate3d(0,${((1 - fIn) * 16).toFixed(1)}px,0)`;
  }

  function renderSvg(head: number, time: number) {
    const S = scene2d;
    stage.style.setProperty('--route-off', (1 - head).toFixed(4));
    const h = S.at(head);
    svgEls.head.setAttribute(
      'transform',
      `translate(${h.x.toFixed(1)} ${h.y.toFixed(1)}) scale(${(1 + 0.08 * Math.sin(time * 4)).toFixed(3)})`,
    );
    CHECKPOINT_T.forEach((ct, i) => {
      const pp = range(head, ct, ct + 0.08);
      const pulse = svgEls.pulses[i];
      if (!pulse) return;
      pulse.setAttribute('r', String(10 + pp * 40));
      pulse.style.opacity = pp > 0 && pp < 1 ? String((1 - pp) * 0.8) : '0';
      svgEls.cps[i].style.opacity = String(mix(0.45, 1, range(head, ct - 0.02, ct)));
    });
  }
}

const scale1 = (v: V3): V3 => [v[0] * 1.002, v[1] * 1.002, v[2] * 1.002];
