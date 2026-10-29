/**
 * 光點游標＋CTA 磁吸。
 * 任何元素加上 data-magnetic 就會被光點吸住（按鈕微微跟著游標移動，光暈包住按鈕）。
 */
import { getState, onReady, onTick, pointer } from '../engine';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ZONE = 28; // 進入按鈕外圍多少 px 就開始吸

export function initOrb() {
  const root = document.querySelector<HTMLElement>('.orb');
  if (!root) return;
  const html = document.documentElement;
  const core = root.querySelector<HTMLElement>('.orb__core')!;
  const halo = root.querySelector<HTMLElement>('.orb__halo')!;
  const ghost = root.querySelector<HTMLElement>('.orb__ghost')!;

  onReady(({ isTouch, reduced }) => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    // 觸控與減少動態：保留系統游標，不做自訂光點與磁吸
    if (isTouch || !fine || reduced) return;

    // 磁吸目標（只追蹤畫面內的）
    const visible = new Set<HTMLElement>();
    const offsets = new WeakMap<HTMLElement, { x: number; y: number }>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) visible.add(el);
        else visible.delete(el);
      }
    });
    const seen = new WeakSet<Element>();
    const refresh = () => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-magnetic]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        offsets.set(el, { x: 0, y: 0 });
        io.observe(el);
      }
    };
    refresh();
    setInterval(refresh, 1500);

    html.classList.add('orb-on');

    // 起點：舞台上 Logo 的那顆點
    const dot = document.querySelector('.stage__dot')?.getBoundingClientRect();
    const start =
      dot && dot.width > 0
        ? { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 }
        : { x: -100, y: -100 };
    const c = { ...start };
    const h = { ...start };
    const g = { ...start };
    let visibleAlpha = 0;
    let stuck: HTMLElement | null = null;

    const wake = () => {
      if (!html.classList.contains('orb-live')) html.classList.add('orb-live');
    };
    window.addEventListener('pointermove', wake, { passive: true });
    // 游標離開視窗：光點回到 Logo 上（舞台上的點重新亮起）
    document.documentElement.addEventListener('pointerleave', () => {
      visibleAlpha = 0;
      html.classList.remove('orb-live');
      pointer.active = false;
    });
    document.documentElement.addEventListener('pointerenter', () => (visibleAlpha = 1));

    const HOVER = 'a, button, [role="button"], label, summary, select';
    const TEXT = 'input, textarea, [contenteditable="true"]';
    document.addEventListener('pointerover', (e) => {
      const t = e.target as Element;
      html.classList.toggle('orb-hover', !!t.closest?.(HOVER));
      html.classList.toggle('orb-text', !!t.closest?.(TEXT));
    });
    window.addEventListener('pointerdown', () => html.classList.add('orb-press'));
    window.addEventListener('pointerup', () => html.classList.remove('orb-press'));

    const release = () => {
      if (!stuck) return;
      html.classList.remove('orb-stick');
      halo.style.width = halo.style.height = halo.style.margin = halo.style.borderRadius = '';
      stuck = null;
    };

    onTick(() => {
      if (!html.classList.contains('orb-live') || getState().reduced) return;
      const px = pointer.x;
      const py = pointer.y;

      // 找最近的磁吸目標
      let best: HTMLElement | null = null;
      let bestRect: DOMRect | null = null;
      let bestD = Infinity;
      for (const el of visible) {
        const o = offsets.get(el)!;
        const r = el.getBoundingClientRect();
        const left = r.left - o.x;
        const top = r.top - o.y;
        const dx = Math.max(left - px, 0, px - (left + r.width));
        const dy = Math.max(top - py, 0, py - (top + r.height));
        const d = Math.hypot(dx, dy);
        if (d < ZONE && d < bestD) {
          bestD = d;
          best = el;
          bestRect = new DOMRect(left, top, r.width, r.height);
        }
      }

      // 所有磁吸元素：被吸住的跟著游標，其他的回原位
      for (const el of visible) {
        const o = offsets.get(el)!;
        let tx = 0;
        let ty = 0;
        if (el === best && bestRect) {
          const cx = bestRect.left + bestRect.width / 2;
          const cy = bestRect.top + bestRect.height / 2;
          tx = Math.max(-14, Math.min(14, (px - cx) * 0.22));
          ty = Math.max(-10, Math.min(10, (py - cy) * 0.3));
        }
        const nx = lerp(o.x, tx, 0.18);
        const ny = lerp(o.y, ty, 0.18);
        if (Math.abs(nx - o.x) > 0.01 || Math.abs(ny - o.y) > 0.01 || nx !== 0) {
          o.x = Math.abs(nx) < 0.05 ? 0 : nx;
          o.y = Math.abs(ny) < 0.05 ? 0 : ny;
          el.style.translate = o.x || o.y ? `${o.x.toFixed(2)}px ${o.y.toFixed(2)}px` : '';
        }
      }

      c.x = lerp(c.x, px, 0.42);
      c.y = lerp(c.y, py, 0.42);
      g.x = lerp(g.x, px, 0.075);
      g.y = lerp(g.y, py, 0.075);

      if (best && bestRect) {
        if (stuck !== best) {
          stuck = best;
          html.classList.add('orb-stick');
          const pad = 8;
          const w = bestRect.width + pad * 2;
          const hh = bestRect.height + pad * 2;
          halo.style.width = `${w}px`;
          halo.style.height = `${hh}px`;
          halo.style.margin = `${-hh / 2}px 0 0 ${-w / 2}px`;
          const br = parseFloat(getComputedStyle(best).borderTopLeftRadius) || 12;
          halo.style.borderRadius = `${br + pad}px`;
        }
        const o = offsets.get(best)!;
        h.x = lerp(h.x, bestRect.left + bestRect.width / 2 + o.x * 1.2, 0.25);
        h.y = lerp(h.y, bestRect.top + bestRect.height / 2 + o.y * 1.2, 0.25);
      } else {
        release();
        h.x = lerp(h.x, px, 0.16);
        h.y = lerp(h.y, py, 0.16);
      }

      const a = String(visibleAlpha);
      root.style.opacity = a;
      core.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
      halo.style.transform = `translate3d(${h.x}px, ${h.y}px, 0)`;
      const sp = Math.min(1, Math.hypot(pointer.vx, pointer.vy) / 2500);
      ghost.style.transform = `translate3d(${g.x}px, ${g.y}px, 0) scale(${1 + sp * 0.6})`;
      ghost.style.opacity = String(0.15 + sp * 0.55);
    });
    visibleAlpha = 1;
  });
}
