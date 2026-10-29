/**
 * 體驗引擎：全站共用的捲動、動畫時鐘與品質分級。
 *
 * 章節的使用方式（在 Chapter.astro 的 <script> 中）：
 *
 *   import { onReady, gsap, ScrollTrigger } from '../../engine';
 *   onReady(({ quality, reduced }) => {
 *     if (reduced) return;            // 減少動態：保留靜態 HTML
 *     gsap.timeline({ scrollTrigger: { trigger: '#ch-02', scrub: true, pin: true } })...
 *   });
 *
 * 規則：
 * - 全站只有一個 rAF 迴圈（gsap.ticker）；需要每幀更新請用 onTick()，不要自己開 requestAnimationFrame。
 * - Lenis 與 ScrollTrigger 已同步；不要另外建立 Lenis。
 * - 品質分級：high / mid / low；reduced = 使用者要求減少動態，或按了「跳過 run」。
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

export { gsap, ScrollTrigger, SplitText };

export type Quality = 'high' | 'mid' | 'low';
export interface EngineState {
  quality: Quality;
  reduced: boolean;
  lenis: Lenis | null;
  isTouch: boolean;
}

const state: EngineState = { quality: 'mid', reduced: false, lenis: null, isTouch: false };
let ready: Promise<EngineState> | null = null;

function heuristicQuality(): Quality {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores >= 8 && mem >= 8 && !window.matchMedia('(pointer: coarse)').matches) return 'high';
  return cores >= 4 ? 'mid' : 'low';
}

async function detectQuality(): Promise<Quality> {
  const override = new URLSearchParams(location.search).get('quality');
  if (override === 'high' || override === 'mid' || override === 'low') return override;
  const cached = sessionStorage.getItem('anf:quality');
  if (cached === 'high' || cached === 'mid' || cached === 'low') return cached;
  const detect = (async (): Promise<Quality> => {
    const { getGPUTier } = await import('detect-gpu');
    const { tier, isMobile } = await getGPUTier({ benchmarksURL: undefined });
    if (tier >= 3 && !isMobile) return 'high';
    if (tier >= 2) return 'mid';
    return 'low';
  })().catch(heuristicQuality);
  // 偵測需要下載 benchmark；網路慢時不要卡住整個體驗
  const timeout = new Promise<Quality>((r) => setTimeout(() => r(heuristicQuality()), 1400));
  const q = await Promise.race([detect, timeout]);
  sessionStorage.setItem('anf:quality', q);
  return q;
}

function init(): Promise<EngineState> {
  if (ready) return ready;
  ready = (async () => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.reduced = mq.matches || sessionStorage.getItem('anf:skip-run') === '1';
    state.isTouch = window.matchMedia('(pointer: coarse)').matches;
    state.quality = await detectQuality();
    document.documentElement.dataset.quality = state.quality;
    document.documentElement.dataset.motion = state.reduced ? 'reduced' : 'full';

    if (!state.reduced) {
      const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      state.lenis = lenis;
    }
    // 頁內錨點：平滑捲動，並把焦點交給目標（鍵盤與螢幕報讀器才會跟著走）
    document.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const id = a.getAttribute('href') ?? '';
      const el = id.length > 1 ? document.getElementById(decodeURIComponent(id.slice(1))) : null;
      if (!el) return;
      e.preventDefault();
      scrollToTarget(el);
      history.replaceState(null, '', id);
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    });
    // 字型載入後版面會變，重新計算所有 ScrollTrigger
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    return state;
  })();
  return ready;
}

/**
 * 共用的游標狀態（光點、舞台、磁吸都讀這裡；不要各自監聽 pointermove）。
 * x/y：視窗座標（px）；nx/ny：-1..1；vx/vy：每秒速度（px，已平滑）；active：是否已移動過。
 */
export const pointer = { x: 0, y: 0, nx: 0, ny: 0, vx: 0, vy: 0, active: false };
if (typeof window !== 'undefined') {
  pointer.x = window.innerWidth * 0.5;
  pointer.y = window.innerHeight * 0.5;
  let lastT = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      const dt = Math.max(1, e.timeStamp - lastT);
      lastT = e.timeStamp;
      const vx = ((e.clientX - pointer.x) / dt) * 1000;
      const vy = ((e.clientY - pointer.y) / dt) * 1000;
      pointer.vx += (vx - pointer.vx) * 0.25;
      pointer.vy += (vy - pointer.vy) * 0.25;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      pointer.active = true;
    },
    { passive: true },
  );
}

/** 引擎就緒後執行章節初始化。 */
export function onReady(fn: (s: EngineState) => void | Promise<void>) {
  init().then((s) => fn(s));
}

/** 每幀回呼（秒、增量毫秒）。回傳取消函式。 */
export function onTick(fn: (time: number, deltaMs: number) => void) {
  gsap.ticker.add(fn);
  return () => gsap.ticker.remove(fn);
}

/** 平滑捲動到某個元素或位置。 */
export function scrollToTarget(target: string | HTMLElement | number) {
  if (state.lenis) state.lenis.scrollTo(target as never, { duration: 1.6 });
  else if (typeof target === 'number') window.scrollTo({ top: target });
  else (typeof target === 'string' ? document.querySelector(target) : target)?.scrollIntoView();
}

/** 「跳過 run」：關閉動態、捲到終點線。 */
export function skipRun() {
  sessionStorage.setItem('anf:skip-run', '1');
  location.hash = '#ch-08';
  location.reload();
}

/** 從「跳過 run」恢復完整動態。 */
export function resumeRun() {
  sessionStorage.removeItem('anf:skip-run');
  sessionStorage.removeItem('anf:booted');
  location.hash = '';
  location.reload();
}

/** 全站事件名稱（window 事件）。 */
export const RUN_EVENTS = {
  /** 開場揭幕（Hero 開始進場） */
  reveal: 'anf:boot-reveal',
  /** 計時器開跑 */
  start: 'anf:run-start',
  /** 抵達終點線：停表 */
  finish: 'anf:finish',
  /** 再跑一次：重置 */
  replay: 'anf:replay',
  /** HUD 停表後廣播最終時間（CustomEvent<{ ms: number; text: string }>） */
  time: 'anf:run-time',
} as const;

type BootFlag = 'boot-reveal' | 'run-start';
declare global {
  interface Window {
    __anf?: Partial<Record<BootFlag, number>> & { skipped?: boolean };
  }
}

/**
 * 開場階段：'boot-reveal'（Hero 開始進場）或 'run-start'（計時開跑）。
 * 若該階段已經發生（例如回訪者略過開場），立即呼叫；fn 會收到「距離該階段已過的毫秒數」。
 */
export function whenRun(flag: BootFlag, fn: (sinceMs: number) => void) {
  const at = window.__anf?.[flag];
  if (at !== undefined) {
    fn(performance.now() - at);
    return;
  }
  window.addEventListener(`anf:${flag}`, () => fn(0), { once: true });
}

export function getState() {
  return state;
}
