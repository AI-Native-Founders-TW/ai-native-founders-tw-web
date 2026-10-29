/**
 * Hero 動畫：開場揭幕時逐字升起；捲動時標題往上漂、淡出，交棒給下一章。
 */
import { gsap, onReady, ScrollTrigger, SplitText, whenRun } from '../../engine';

export function initHero() {
  const root = document.getElementById('ch-01');
  if (!root) return;
  const title = root.querySelector<HTMLElement>('.hero__title')!;
  const inner = root.querySelector<HTMLElement>('.hero__inner')!;
  const foot = root.querySelector<HTMLElement>('.hero__foot')!;

  const reducedNow =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    sessionStorage.getItem('anf:skip-run') === '1';
  const revealAt = window.__anf?.['boot-reveal'];
  // 已經揭幕（回訪、深連結、或 bundle 太晚到）就不重播，避免已畫出的字閃爍
  const late = revealAt !== undefined && performance.now() - revealAt > 120;

  if (!reducedNow && !late) {
    const fades = [...root.querySelectorAll<HTMLElement>('[data-hero="fade"]')];
    const ctas = [...root.querySelectorAll<HTMLElement>('[data-hero="cta"] > *')];
    gsap.set(fades, { opacity: 0, y: 16 });
    gsap.set(ctas, { opacity: 0, y: 22 });

    const segs = [...title.querySelectorAll<HTMLElement>('.hero__seg')];
    const split = SplitText.create(segs, { type: 'chars', charsClass: 'hero-char', mask: 'chars' });
    // 漸層段落：每個字記住自己在段落中的位置，拆開後漸層仍是連續的
    const paintAccent = () => {
      for (const seg of segs) {
        if (!seg.classList.contains('hero__seg--accent')) continue;
        const r = seg.getBoundingClientRect();
        seg.style.setProperty('--seg-w', `${r.width}px`);
        for (const c of seg.querySelectorAll<HTMLElement>('.hero-char')) {
          c.style.setProperty('--char-x', `${c.getBoundingClientRect().left - r.left}px`);
        }
      }
    };
    paintAccent();
    // 字型是非阻塞載入；換字型後重新對齊漸層
    document.fonts?.ready.then(paintAccent);
    gsap.set(split.chars, { yPercent: 118, rotate: 4, transformOrigin: '0% 100%' });

    whenRun('boot-reveal', () => {
      const [eyebrow, sub] = fades;
      const tl = gsap.timeline({
        defaults: { ease: 'expo.out' },
        onComplete: () => {
          split.revert();
          gsap.set([...fades, ...ctas], { clearProps: 'all' });
        },
      });
      tl.to(split.chars, { yPercent: 0, rotate: 0, duration: 1.3, stagger: { each: 0.032 } }, 0.08)
        .to(eyebrow, { opacity: 1, y: 0, duration: 1 }, 0)
        .to(sub, { opacity: 1, y: 0, duration: 1.1 }, 0.5)
        .to(ctas, { opacity: 1, y: 0, duration: 1.1, stagger: 0.08 }, 0.62)
        .to(fades.slice(2), { opacity: 1, y: 0, duration: 1 }, 0.9);
    });
  }

  onReady(({ reduced }) => {
    if (reduced) return;
    gsap
      .timeline({
        scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.6 },
        defaults: { ease: 'none' },
      })
      .to(inner, { y: () => -window.innerHeight * 0.14, opacity: 0, ease: 'power1.in' }, 0)
      .to(foot, { opacity: 0, duration: 0.25 }, 0);
    ScrollTrigger.refresh();
  });
}
