/**
 * 舞台控制器：決定要用 CSS 光帶還是 WebGL 光帶，並依捲動調整舞台的強度。
 *
 * 舞台在 Hero（章節 01）最亮，捲離 Hero 後淡出；到終點線（章節 08）再亮起，
 * 光帶從 A 字攤平成賽道（uMorph），前後呼應。
 */
import { gsap, onReady, onTick, type Quality, ScrollTrigger, whenRun } from '../engine';

export const stageState = {
  /** 0..1：捲動決定的強度 */
  intensity: 1,
  /** 0 = A 字，1 = 終點線的賽道 */
  morph: 0,
  /** Hero 的捲動進度 0..1 */
  heroProgress: 0,
  /** 終點線賽道在畫面上的 y（px）；光帶攤平後就沿著它跑 */
  laneY: 0,
};

function idle(timeout = 1200) {
  return new Promise<void>((r) => {
    const ric = (
      window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }
    ).requestIdleCallback;
    if (ric) ric(() => r(), { timeout });
    else setTimeout(r, 200);
  });
}

export function initStage() {
  const root = document.getElementById('stage');
  if (!root) return;
  const canvas = root.querySelector<HTMLCanvasElement>('.stage__gl')!;
  const mark = root.querySelector<HTMLElement>('.stage__mark')!;

  onReady(async ({ quality, reduced }) => {
    let hero = 1;
    let finish = 0;
    let finishOut = 0;
    // 07「我們不做什麼」是安靜段：舞台壓暗，強化節奏反差
    const quiet = { v: 1 };
    const apply = () => {
      stageState.intensity = Math.max(hero, finish * (1 - finishOut)) * quiet.v;
      root.style.setProperty('--stage-o', String(Math.max(0.0, Math.min(1, stageState.intensity))));
      // 終點線不需要 Logo 的 A 與光點（光點已經在賽道上）
      root.style.setProperty('--art-o', String(1 - stageState.morph));
    };
    const ch1 = document.getElementById('ch-01');
    const ch8 = document.getElementById('ch-08');
    if (ch1) {
      ScrollTrigger.create({
        trigger: ch1,
        start: 'top top',
        end: 'bottom top',
        onUpdate: (st) => {
          stageState.heroProgress = st.progress;
          hero = 1 - smooth(st.progress, 0.15, 0.95);
          apply();
        },
      });
    }
    if (ch8) {
      ScrollTrigger.create({
        trigger: ch8,
        start: 'top bottom',
        end: 'top 20%',
        onUpdate: (st) => {
          finish = smooth(st.progress, 0, 1) * 0.7;
          stageState.morph = smooth(st.progress, 0.2, 1);
          apply();
        },
      });
      // 離開終點線之後淡出，把舞台交給 Credits
      ScrollTrigger.create({
        trigger: ch8,
        start: 'bottom 70%',
        end: 'bottom 10%',
        onUpdate: (st) => {
          finishOut = smooth(st.progress, 0, 1);
          apply();
        },
      });
    }
    apply();
    window.addEventListener('anf:quiet', (e) => {
      const active = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
      gsap.to(quiet, {
        v: active ? 0.15 : 1,
        duration: reduced ? 0 : 1.2,
        ease: 'power2.inOut',
        onUpdate: apply,
      });
    });

    if (reduced || quality === 'low') return;
    // WebGL 在 Hero 開場完成、瀏覽器閒下來之後才載入，不搶 LCP
    await new Promise<void>((r) => whenRun('run-start', () => r()));
    await idle();
    try {
      const { createRibbon } = await import('./webgl');
      const ribbon = createRibbon(
        canvas,
        mark,
        quality as Exclude<Quality, 'low'>,
        root.querySelector('.stage__dot'),
      );
      if (!ribbon) return;
      ribbon.render(0);
      root.dataset.mode = 'gl';
      let elapsed = 0;
      const rail = document.querySelector<HTMLElement>('.fin__rail');
      const wide = window.matchMedia('(min-width: 900px)');
      onTick((_t, dt) => {
        elapsed += Math.min(dt, 50) / 1000;
        if (stageState.intensity <= 0.01) return;
        if (stageState.morph > 0) {
          const r = rail?.getBoundingClientRect();
          stageState.laneY = r && wide.matches ? r.top + r.height / 2 : window.innerHeight * 0.86;
        }
        ribbon.render(elapsed);
      });
    } catch (err) {
      console.warn('[stage] WebGL unavailable, staying on CSS ribbon', err);
    }
  });
}

function smooth(x: number, a: number, b: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
