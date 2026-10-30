/**
 * 章節 06 的捲動控制：讀文字段落的實際位置、換算故事時間 T，驅動 WebGL 場景與文字。
 *
 * - 文字留在一般文件流裡（sticky），捲動本身就是位置變化；這裡只補透明度與層次。
 *   所以關掉 WebGL、字型晚到、視窗改變時，文字仍然在正確的位置。
 * - 畫面只取決於 T：反向捲動、停在中途都不需要另外處理。
 * - 只用引擎的 ticker，章節離開畫面就停止；走遠之後釋放 GPU 資源，回來再重建。
 */
import { getState, onReady, onTick, pointer, ScrollTrigger } from '../../engine';
import {
  anchorsOf,
  BEATS,
  type BeatSpan,
  clamp,
  type Layout,
  layoutOf,
  mix,
  range,
  smooth,
  stateAt,
  storyTime,
} from './story';
import type { World } from './world';

/** 短到放不下文字與畫面的視窗（手機橫向）改用靜態版 */
const MIN_LIVE_HEIGHT = 520;

interface Fx {
  el: HTMLElement;
  /** 進場時序：越大越晚 */
  order: number;
  last: string;
  lastO: number;
}

interface Beat {
  id: string;
  el: HTMLElement;
  fx: Fx[];
  a: number;
  b: number;
}

interface Tag {
  el: HTMLElement;
  floor: number;
  group: 'floor' | 'label';
  key: 'hub' | number;
  lastX: number;
  lastY: number;
  lastO: number;
  lastA: boolean;
}

const lerpDamp = (dt: number, rate: number) => 1 - Math.exp(-(dt / 1000) * rate);

export function initAiNative() {
  const root = document.getElementById('ch-06');
  if (!root) return;
  const stage = root.querySelector<HTMLElement>('[data-ch06-stage]');
  const flow = root.querySelector<HTMLElement>('[data-ch06-flow]');
  let canvas = root.querySelector<HTMLCanvasElement>('[data-ch06-canvas]');
  if (!stage || !flow || !canvas) return;
  const stageEl = stage;
  const flowEl = flow;

  const beats: Beat[] = BEATS.map((id) => {
    const el = root.querySelector<HTMLElement>(`[data-beat="${id}"]`)!;
    const fx = Array.from(el.querySelectorAll<HTMLElement>('[data-fx]')).map((n, i) => ({
      el: n,
      order: Number(n.dataset.fx ?? i),
      last: '',
      lastO: -1,
    }));
    return { id, el, fx, a: 0, b: 0 };
  });
  const open = beats[0];
  const kicker = open.el.querySelector<HTMLElement>('[data-ch06-kicker]');
  const outcomes = Array.from(root.querySelectorAll<HTMLElement>('[data-ch06-outcome]'));
  const closeBeat = beats[beats.length - 1];
  const tags: Tag[] = Array.from(root.querySelectorAll<HTMLElement>('[data-ch06-tag]')).map(
    (el) => {
      const [group, floor, key] = (el.dataset.ch06Tag ?? '').split(':');
      return {
        el,
        floor: Number(floor),
        group: group as Tag['group'],
        key: key === 'hub' ? 'hub' : Number(key),
        lastX: 0,
        lastY: 0,
        lastO: -1,
        lastA: false,
      };
    },
  );

  onReady(({ quality, reduced }) => {
    const eligible = !reduced && quality !== 'low';
    const tall = window.matchMedia(`(min-height: ${MIN_LIVE_HEIGHT}px)`);
    let glFailed = false;
    let world: World | null = null;
    let building = false;
    let buildId = 0;
    let vh = 1;
    let vw = 1;
    let layout: Layout = 'side';
    let sectionTop = 0;
    let anchors: number[] = [0, 1];
    let T = -1;
    let inView = false;
    let isNear = false;
    let seenW = 0;
    let seenH = 0;
    /** 目前讀到章節的哪裡（0–1），以及視窗改變後要維持這個位置到什麼時候 */
    let ratio = 0;
    let inside = false;
    let holdUntil = 0;
    let copyTop = 0;
    let stopTick: (() => void) | null = null;
    const px = { x: 0, y: 0 };

    const isLive = () => root.dataset.mode === 'live';

    function measure() {
      const nextW = window.innerWidth;
      const nextH = window.innerHeight;
      // 旋轉或調整視窗：章節高度會變（手機橫向甚至變成靜態版），要留在同一段內容
      if (Math.abs(nextW - seenW) > 40 || Math.abs(nextH - seenH) > 120) {
        if (seenW && inside) holdUntil = performance.now() + 900;
      }
      seenW = nextW;
      seenH = nextH;
      vh = stageEl.offsetHeight || window.innerHeight;
      vw = stageEl.offsetWidth || window.innerWidth;
      layout = layoutOf(vw, vh);
      sectionTop = root!.getBoundingClientRect().top + window.scrollY;
      const flowTop = flowEl.offsetTop;
      const spans: BeatSpan[] = beats.map((b) => {
        const top = flowTop + b.el.offsetTop;
        b.a = top;
        b.b = top + b.el.offsetHeight - vh;
        return { a: b.a, b: b.b };
      });
      anchors = anchorsOf(spans);
      // 手機版文字在下方：最高的那段文字決定場景能用多少空間
      copyTop = vh;
      for (const b of beats) {
        const copy = b.el.querySelector<HTMLElement>('.ch06-copy');
        if (copy) copyTop = Math.min(copyTop, copy.offsetTop);
      }
      if (world) {
        world.resize(stageEl.clientWidth, stageEl.clientHeight, layout);
        fitWorld();
      }
      if (performance.now() < holdUntil) {
        const y = sectionTop + ratio * Math.max(root!.offsetHeight - vh, 1);
        getState().lenis?.scrollTo(y, { immediate: true, force: true });
        window.scrollTo(0, y);
      }
    }

    function fitWorld() {
      if (!world) return;
      if (layout === 'side') {
        world.frameTo(1, 0);
        return;
      }
      const free = Math.max(copyTop - HEADER_H, 120);
      const zoom = clamp((vh * STACK_FREE) / free, 1, 1.75);
      const dy = ((HEADER_H + copyTop) / 2 - vh * STACK_CENTER) / vh;
      world.frameTo(zoom, dy);
    }

    function clearFx() {
      for (const b of beats) {
        for (const f of b.fx) {
          f.el.style.removeProperty('opacity');
          f.el.style.removeProperty('transform');
          f.last = '';
          f.lastO = -1;
        }
      }
      kicker?.style.removeProperty('transform');
      for (const o of outcomes) {
        o.style.removeProperty('transform');
        o.style.removeProperty('opacity');
      }
    }

    function write(f: Fx, opacity: number, transform: string) {
      if (Math.abs(opacity - f.lastO) > 0.002) {
        f.el.style.opacity = opacity.toFixed(3);
        f.lastO = opacity;
      }
      if (transform !== f.last) {
        f.el.style.transform = transform;
        f.last = transform;
      }
    }

    /** 文字：進場依序浮現，離場先淡出；位置本身由捲動帶動。 */
    function paintText(y: number) {
      for (const b of beats) {
        // 離視窗太遠就不用算
        if (y < b.a - vh * 1.1 || y > b.b + vh * 1.1) continue;
        const enter = clamp(1 - (b.a - y) / vh);
        const leave = clamp((y - b.b) / vh);
        const isOpen = b === open;
        const hold = range(y, b.a, b.b);
        for (const f of b.fx) {
          let e: number;
          if (isOpen) {
            // 開場：先只有「為什麼是 AI-Native？」，主標與說明之後才展開
            const st =
              f.order === 0
                ? range(enter, 0.35, 0.95)
                : range(hold, 0.12 + f.order * 0.12, 0.28 + f.order * 0.12);
            e = smooth(st);
          } else {
            e = smooth(range(enter, 0.5 + f.order * 0.05, 0.92 + f.order * 0.025));
          }
          const out = 1 - smooth(range(leave, 0, 0.42));
          const dy = (1 - e) * 30;
          write(f, e * out, `translate3d(0, ${dy.toFixed(1)}px, 0)`);
        }
        if (isOpen && kicker) {
          // 問句從大字收成主標上方的小標：同一個元素，位置與尺度一起變
          const s = smooth(range(hold, 0.1, 0.27));
          const big = layout === 'side' ? 2.5 : 1.9;
          const scale = mix(big, 1, s);
          const parent = kicker.parentElement!;
          const top = kicker.offsetTop - parent.offsetTop;
          const shift = (parent.offsetHeight / 2 - top - kicker.offsetHeight / 2) * (1 - s);
          kicker.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        }
      }
    }

    /** 跟著場景走的標籤：層的名稱、圖上的小字，以及收尾的兩個結果。 */
    function paintTags() {
      if (!world) return;
      const st = stateAt(T);
      const w = world;
      const margin = 14;
      const maxY = layout === 'side' ? vh - 40 : copyTop - 18;
      const minX = layout === 'side' ? vw * 0.42 : margin;
      const placed: { x: number; y: number; hw: number; hh: number }[] = [];
      for (const t of tags) {
        let alpha = 0;
        let active = false;
        let x = 0;
        let y = 0;
        if (t.group === 'floor') {
          const f = st.focus[t.floor];
          const fade = smooth(range(f, 0.18, 0.4)) * (1 - smooth(range(T, 9.2, 10)));
          // 手機畫面窄，聚焦時層名已經在下方的文字裡，等三層回到完整構圖才標上
          const room = layout === 'side' ? smooth(range(T, 1.3, 1.9)) : smooth(range(T, 7.2, 7.8));
          alpha = fade * room * mix(0.5, 1, smooth(range(f, 0.42, 0.9)));
          active = T < 7.2 ? f > 0.8 : false;
          const q = w.pointOn(t.floor, FLOOR_ANCHOR[layout], 0.02, T);
          x = q.x + t.el.offsetWidth / 2 + (layout === 'side' ? 18 : -t.el.offsetWidth - 10);
          y = q.y - (layout === 'side' ? 8 : 0);
        } else {
          // 圖上的小字只在該層是焦點時出現
          const f = st.focus[t.floor];
          const shown = st.reveal[t.floor];
          alpha = smooth(range(f, 0.72, 0.95)) * smooth(range(shown, 0.18, 0.5));
          alpha *= 1 - smooth(range(T, 7.1, 7.6));
          // 矮螢幕上島比較小，中心的標籤會和文件標籤疊在一起
          if (t.key === 'hub' && layout === 'stack' && vh < 720) alpha = 0;
          const p = w.labelPoint(t.floor, t.key);
          const q = w.pointOn(t.floor, p, 0.14, T);
          x = q.x;
          y = q.y;
        }
        let visible = alpha > 0.01;
        if (visible) {
          const hw = t.el.offsetWidth / 2;
          x = clamp(x, Math.max(minX, margin) + hw, vw - margin - hw);
          y = clamp(y, 70, maxY);
          if (t.group === 'label') {
            // 小螢幕上島比較小：圖上的小字會互疊時，後面的先不顯示
            const hh = t.el.offsetHeight / 2;
            const hit = placed.some(
              (r) => Math.abs(r.x - x) < r.hw + hw + 4 && Math.abs(r.y - y) < r.hh + hh + 2,
            );
            if (hit) {
              alpha = 0;
              visible = false;
            } else placed.push({ x, y, hw, hh });
          }
        }
        if (visible) {
          if (Math.abs(x - t.lastX) > 0.2 || Math.abs(y - t.lastY) > 0.2) {
            t.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
            t.lastX = x;
            t.lastY = y;
          }
        }
        if (Math.abs(alpha - t.lastO) > 0.004) {
          t.el.style.opacity = alpha.toFixed(3);
          t.el.style.visibility = visible ? 'visible' : 'hidden';
          t.lastO = alpha;
        }
        if (active !== t.lastA) {
          t.el.classList.toggle('is-active', active);
          t.lastA = active;
        }
      }

      // 收尾：兩個結果分別貼在各自的畫面位置
      const y0 = window.scrollY - sectionTop;
      const frameTop = Math.max(0, closeBeat.a - y0);
      const seats = OUTCOME_SEAT[layout];
      outcomes.forEach((el, i) => {
        const s = seats[i];
        const o = smooth(range(T, s.from, s.from + 0.55));
        const leave = 1 - smooth(range(y0 - closeBeat.b, 0, vh * 0.35));
        const q = w.pointOn(s.floor, s.p, s.lift, T);
        const hw = el.offsetWidth / 2;
        const hh = el.offsetHeight / 2;
        const sx = clamp(q.x + s.dx * vw, margin + hw, vw - margin - hw);
        const floorY = layout === 'side' ? vh - 80 - hh : copyTop - 10 - hh;
        const sy = clamp(q.y + s.dy * vh, 74 + hh, Math.max(74 + hh, floorY));
        el.style.transform = `translate3d(${sx.toFixed(1)}px, ${(sy - frameTop).toFixed(1)}px, 0) translate(-50%, -50%) scale(${mix(0.96, 1, o).toFixed(3)})`;
        el.style.opacity = (o * leave).toFixed(3);
      });
    }

    function frame(time: number, dt: number) {
      const y = window.scrollY - sectionTop;
      const target = storyTime(y, anchors, vh);
      // 捲動已經被 Lenis 平滑過，這裡只做很短的跟隨，避免觸控時的抖動傳到鏡頭
      T += (target - T) * lerpDamp(dt, 16);
      if (Math.abs(target - T) < 0.0004) T = target;
      paintText(y);
      if (world) {
        px.x += ((pointer.active ? pointer.nx : 0) - px.x) * lerpDamp(dt, 3);
        px.y += ((pointer.active ? pointer.ny : 0) - px.y) * lerpDamp(dt, 3);
        world.render(T, time, px.x, px.y, dt);
        paintTags();
      }
    }

    function run(on: boolean) {
      if (on && !stopTick) {
        // 從畫面外回來（錨點、快速捲動）直接到位，不要從舊位置掃過整段故事
        T = storyTime(window.scrollY - sectionTop, anchors, vh);
        stopTick = onTick(frame);
      }
      if (!on && stopTick) {
        stopTick();
        stopTick = null;
      }
    }

    async function build() {
      if (world || building || glFailed || !canvas) return;
      building = true;
      const id = ++buildId;
      try {
        const { createWorld } = await import('./world');
        const w = createWorld(canvas, { quality: quality as 'high' | 'mid', layout });
        w.resize(stageEl.clientWidth, stageEl.clientHeight, layout);
        await w.ready;
        if (id !== buildId) {
          w.dispose();
          swapCanvas();
          return;
        }
        world = w;
        root!.dataset.gl = 'on';
        measure();
        fitWorld();
      } catch (err) {
        console.warn('[ai-native] WebGL 無法使用，改用靜態版', err);
        glFailed = true;
        update();
      } finally {
        building = false;
      }
    }

    /** 丟失 context 的 canvas 不能再用，換一個新的。 */
    function swapCanvas() {
      const next = canvas?.cloneNode(false) as HTMLCanvasElement | undefined;
      if (next && canvas) {
        canvas.replaceWith(next);
        canvas = next;
      }
    }

    function release() {
      buildId++;
      if (!world) return;
      world.dispose();
      world = null;
      delete root!.dataset.gl;
      swapCanvas();
    }

    function update() {
      const live = eligible && !glFailed && tall.matches;
      const next = live ? 'live' : 'static';
      const changed = root!.dataset.mode !== next;
      root!.dataset.mode = next;
      if (!live) {
        run(false);
        release();
        clearFx();
      }
      if (changed) ScrollTrigger.refresh();
      else measure();
      if (live) {
        // 手機由橫轉直時章節已在畫面內，不會再收到進入事件，要自己接回來
        if (isNear) build();
        run(inView);
      }
    }

    // 章節接近才建場景；走遠（三個視窗外）就釋放
    const near = new IntersectionObserver(
      ([e]) => {
        isNear = e.isIntersecting;
        if (isNear && isLive()) build();
      },
      { rootMargin: '150% 0px' },
    );
    near.observe(root!);
    const far = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) release();
      },
      { rootMargin: '300% 0px' },
    );
    far.observe(root!);

    ScrollTrigger.create({
      trigger: root,
      start: 'top bottom',
      end: 'bottom top',
      onRefresh: () => measure(),
      onUpdate: (self) => {
        // 版面正在變動時高度還沒量過，這時算出來的比例不可信
        const stale = window.innerWidth !== seenW || window.innerHeight !== seenH;
        if (stale || performance.now() < holdUntil) return;
        const span = Math.max(root!.offsetHeight - vh, 1);
        const y = self.scroll() - sectionTop;
        inside = y >= 0 && y <= span;
        ratio = clamp(y / span);
      },
      onToggle: (self) => {
        inView = self.isActive;
        run(inView && isLive());
      },
    });

    new ResizeObserver(() => {
      if (isLive()) measure();
    }).observe(stageEl);
    tall.addEventListener('change', update);

    update();
  });
}

/** 章節上方被頁首佔去的高度 */
const HEADER_H = 66;
/** 手機版場景的基準：可用高度佔視窗的比例、中心在視窗的位置（以 390×844 調好） */
const STACK_FREE = 0.42;
const STACK_CENTER = 0.3;

/** 層名貼在北端外側：鏡頭一直在東南方，北端不會被上下層擋住 */
const FLOOR_ANCHOR: Record<Layout, [number, number]> = {
  side: [0.3, -0.44],
  stack: [0.27, -0.3],
};

const OUTCOME_SEAT: Record<
  Layout,
  { floor: number; p: [number, number]; lift: number; dx: number; dy: number; from: number }[]
> = {
  side: [
    { floor: 2, p: [0.3, -0.38], lift: 1.2, dx: 0.04, dy: -0.1, from: 9.55 },
    { floor: 0, p: [-0.1, 0.46], lift: 0, dx: 0.0, dy: 0.08, from: 9.95 },
  ],
  stack: [
    { floor: 2, p: [0, -0.3], lift: 1.6, dx: 0.14, dy: -0.04, from: 9.55 },
    { floor: 0, p: [0, 0.3], lift: 0, dx: -0.14, dy: 0.06, from: 9.95 },
  ],
};
