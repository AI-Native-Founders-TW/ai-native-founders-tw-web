/**
 * 終點線：捲動推進光點，通過檢查點就點亮；衝線時停表（anf:finish），顯示成績。
 */
import { gsap, onReady, RUN_EVENTS, ScrollTrigger } from '../../engine';
import { fmt } from '../../hud/index';

export function initFinish() {
  const root = document.getElementById('ch-08');
  if (!root) return;
  const race = root.querySelector<HTMLElement>('[data-race]')!;
  const rail = root.querySelector<HTMLElement>('.fin__rail')!;
  const steps = [...root.querySelectorAll<HTMLElement>('.fin__step')];
  const resultEl = root.querySelector<HTMLElement>('[data-result]')!;

  let finished = false;
  let positions: number[] = [];
  let lastP = -1;

  const measure = () => {
    const vertical = !window.matchMedia('(min-width: 900px)').matches;
    const rr = rail.getBoundingClientRect();
    positions = steps.map((s) => {
      const c = s.querySelector('.fin__cp')!.getBoundingClientRect();
      return vertical
        ? (c.top + c.height / 2 - rr.top) / rr.height
        : (c.left + c.width / 2 - rr.left) / rr.width;
    });
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    root.dataset.finished = '';
    window.dispatchEvent(new Event(RUN_EVENTS.finish));
  };

  const update = (p: number, canFinish = true) => {
    if (Math.abs(p - lastP) < 0.0005 && !(canFinish && p >= 0.995 && !finished)) return;
    lastP = p;
    race.style.setProperty('--p', p.toFixed(4));
    steps.forEach((s, i) => {
      s.toggleAttribute('data-passed', p >= (positions[i] ?? 1) - 0.01);
    });
    if (canFinish && p >= 0.995) finish();
  };

  window.addEventListener(RUN_EVENTS.time, (e) => {
    const ms = (e as CustomEvent<{ ms: number }>).detail.ms;
    const o = { v: 0 };
    gsap.to(o, {
      v: ms,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.1,
      ease: 'expo.out',
      onUpdate: () => {
        const f = fmt(o.v);
        resultEl.textContent = f.mmss + f.ms;
      },
    });
  });

  window.addEventListener(RUN_EVENTS.replay, () => {
    finished = false;
    delete root.dataset.finished;
    resultEl.textContent = '00:00.000';
  });

  onReady(({ reduced }) => {
    measure();
    ScrollTrigger.addEventListener('refreshInit', measure);
    if (reduced) {
      update(1, false);
      // 不用 once: true（初始化時若已捲過，會在其他 ScrollTrigger 建立途中自我刪除）；finish() 本身只會觸發一次
      ScrollTrigger.create({ trigger: race, start: 'top 75%', onEnter: finish });
      return;
    }
    update(0);
    const proxy = { p: 0 };
    gsap.to(proxy, {
      p: 1,
      ease: 'none',
      onUpdate: () => update(proxy.p),
      scrollTrigger: {
        trigger: race,
        start: 'top 72%',
        end: () => (window.matchMedia('(min-width: 900px)').matches ? 'bottom 48%' : 'bottom 62%'),
        scrub: 0.7,
      },
    });
  });
}
