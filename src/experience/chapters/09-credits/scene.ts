/**
 * 章節 09：Credits Roll。
 * - 捲動控制名單上滾（pin＋scrub），捲動距離＝名單長度，名單再長也撐得住。
 * - 停在這一段不動時，名單會自己慢慢播（像真的片尾）；滑過名字、聚焦、或按暫停鍵就停。
 * - 減少動態：不 pin，保留靜態清單。
 */
import { getState, gsap, onReady, onTick, ScrollTrigger, scrollToTarget } from '../../engine';

const SPEED = 52; // 自動播放：每秒捲動的像素
const IDLE_MS = 1400; // 使用者停手多久後開始自動播放

export function initCredits() {
  const root = document.getElementById('ch-09');
  const stage = root?.querySelector<HTMLElement>('[data-cr-stage]');
  const roll = root?.querySelector<HTMLElement>('[data-cr-roll]');
  const end = root?.querySelector<HTMLElement>('[data-cr-end]');
  const replay = root?.querySelector<HTMLButtonElement>('[data-cr-replay]');
  const pauseBtn = root?.querySelector<HTMLButtonElement>('[data-cr-pause]');
  const pauseLabel = root?.querySelector<HTMLElement>('[data-cr-pause-label]');
  if (!root || !stage || !roll || !end) return;

  replay?.addEventListener('click', () => {
    window.dispatchEvent(new Event('anf:replay'));
    scrollToTarget(0);
  });

  onReady(({ reduced, isTouch }) => {
    if (reduced) return;
    root.classList.add('is-rolling');

    // 終點：「Thanks for playing.」停在畫面正中央
    const finalY = () => -(end.offsetTop + end.offsetHeight / 2 - stage.clientHeight / 2);

    const tween = gsap.fromTo(roll, { y: 0 }, { y: finalY, ease: 'none', paused: true });
    const st = ScrollTrigger.create({
      trigger: stage,
      start: 'top top',
      end: () => `+=${Math.max(1, -finalY())}`,
      pin: true,
      scrub: 0.6,
      animation: tween,
      invalidateOnRefresh: true,
      onUpdate: (self) => pauseBtn?.classList.toggle('is-done', self.progress > 0.94),
    });

    // 片尾：最後一段讓光點與按鈕亮起
    const endParts = end.querySelectorAll(':scope > *');
    gsap.from(endParts, {
      opacity: 0,
      y: 30,
      stagger: 0.08,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: stage,
        start: () => st.end - window.innerHeight * 0.55,
        end: () => st.end - 4,
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    });

    // 名字經過畫面中央時稍微亮一點（輕量：只改 opacity）
    const entries = [...root.querySelectorAll<HTMLElement>('.cr-entry, .cr-group-title, .cr-next')];
    gsap.set(entries, { opacity: 0.45 });
    const io = new IntersectionObserver(
      (list) => {
        for (const e of list) {
          gsap.to(e.target, {
            opacity: e.isIntersecting ? 1 : 0.45,
            duration: 0.6,
            ease: 'power2.out',
          });
        }
      },
      { rootMargin: '-18% 0px -18% 0px' },
    );
    for (const el of entries) io.observe(el);

    /* ---------- 自動播放 ---------- */
    let userPaused = false;
    let hovering = false;
    let lastInput = performance.now();
    let stopTick: (() => void) | null = null;

    const markInput = () => {
      lastInput = performance.now();
    };
    for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown'] as const) {
      window.addEventListener(ev, markInput, { passive: true });
    }

    const setPaused = (p: boolean) => {
      userPaused = p;
      if (!pauseBtn) return;
      pauseBtn.setAttribute('aria-pressed', String(p));
      if (pauseLabel)
        pauseLabel.textContent = p ? (pauseBtn.dataset.play ?? '') : (pauseBtn.dataset.pause ?? '');
    };
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.addEventListener('click', () => setPaused(!userPaused));
    }

    // 桌機：滑過名字就停，方便閱讀或點進個人頁
    if (!isTouch) {
      roll.addEventListener('pointerover', (e) => {
        hovering = !!(e.target as HTMLElement).closest('.cr-entry, .cr-next, .cr-end');
      });
      roll.addEventListener('pointerleave', () => {
        hovering = false;
      });
    }
    roll.addEventListener('focusin', () => {
      hovering = true;
    });
    roll.addEventListener('focusout', () => {
      hovering = false;
    });

    const tick = (_t: number, dtMs: number) => {
      if (userPaused || hovering) return;
      if (performance.now() - lastInput < IDLE_MS) return;
      if (st.progress >= 0.999) return;
      const lenis = getState().lenis;
      const current = lenis ? lenis.scroll : window.scrollY;
      const next = Math.min(current + (SPEED * Math.min(dtMs, 50)) / 1000, st.end);
      if (lenis) lenis.scrollTo(next, { immediate: true, force: true });
      else window.scrollTo(0, next);
    };

    ScrollTrigger.create({
      trigger: stage,
      start: 'top top',
      end: () => st.end,
      onToggle: (self) => {
        if (self.isActive && !stopTick) {
          lastInput = performance.now();
          stopTick = onTick(tick);
        } else if (!self.isActive && stopTick) {
          stopTick();
          stopTick = null;
        }
      },
    });

    window.addEventListener('anf:replay', () => setPaused(false));
  });
}
