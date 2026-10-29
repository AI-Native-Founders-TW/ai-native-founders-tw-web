/**
 * 章節 05 互動：標題逐字點亮、角色選擇（滑鼠／鍵盤／手機滑動）、打字機台詞、光點粒子。
 * 只用引擎的 ticker；離開視窗時粒子停止。
 */
import { gsap, onReady, onTick, ScrollTrigger, SplitText } from '../../engine';

const COLORS = ['#f6fbfc', '#decffe', '#ceabfd', '#8fd8ff', '#19acfe'];

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  c: string;
  drag: number;
}

export function initCharacter() {
  const root = document.getElementById('ch-05');
  if (!root) return;
  const cards = [...root.querySelectorAll<HTMLButtonElement>('.ch05-card')];
  const panels = [...root.querySelectorAll<HTMLElement>('.ch05-panel')];
  const roster = root.querySelector<HTMLElement>('[data-ch05-roster]');
  const select = root.querySelector<HTMLElement>('[data-ch05-select]');
  const canvas = root.querySelector<HTMLCanvasElement>('[data-ch05-sparks]');
  if (!roster || !select || !cards.length) return;

  // 有 JS：對話框只顯示目前的角色
  root.classList.add('is-ready');
  for (const p of panels) {
    const text = p.querySelector('.ch05-line-text');
    const full = p.querySelector('.ch05-line-full');
    if (text && full) text.textContent = full.textContent;
  }

  onReady(({ reduced, quality, isTouch }) => {
    const mobile = window.matchMedia('(max-width: 767px)');
    let current = 0;
    let typeTween: gsap.core.Tween | null = null;
    let introduced = reduced;

    /* ---------- 打字機 ---------- */
    function typeLine(panel: HTMLElement) {
      const full = panel.querySelector('.ch05-line-full')?.textContent ?? '';
      const text = panel.querySelector<HTMLElement>('.ch05-line-text');
      if (!text) return;
      typeTween?.kill();
      if (reduced) {
        text.textContent = full;
        root?.classList.remove('is-typing');
        return;
      }
      const chars = Array.from(full);
      const o = { n: 0 };
      text.textContent = '';
      root?.classList.add('is-typing');
      typeTween = gsap.to(o, {
        n: chars.length,
        duration: Math.min(2.4, chars.length * 0.034),
        ease: 'none',
        delay: 0.18,
        onUpdate() {
          text.textContent = chars.slice(0, Math.round(o.n)).join('');
        },
        onComplete() {
          root?.classList.remove('is-typing');
        },
      });
    }

    /* ---------- 粒子 ---------- */
    const sparks: Spark[] = [];
    const useSparks = !reduced && quality !== 'low' && !!canvas;
    const ctx = useSparks ? canvas?.getContext('2d') : null;
    let dpr = 1;
    let running = false;
    let stopTick: (() => void) | null = null;
    let emitAcc = 0;

    function sizeCanvas() {
      if (!canvas || !ctx) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    }
    if (ctx && canvas) {
      sizeCanvas();
      new ResizeObserver(sizeCanvas).observe(canvas);
    }

    function emblemCenter(): [number, number] | null {
      if (!canvas) return null;
      const em = cards[current]?.querySelector('.ch05-emblem');
      if (!em) return null;
      const a = em.getBoundingClientRect();
      const b = canvas.getBoundingClientRect();
      return [a.left + a.width / 2 - b.left, a.top + a.height / 2 - b.top];
    }

    function burst(power = 1) {
      if (!ctx) return;
      const c = emblemCenter();
      if (!c) return;
      const n = Math.round((isTouch ? 22 : 38) * power);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (70 + Math.random() * 240) * power;
        sparks.push({
          x: c[0] + Math.cos(a) * 18,
          y: c[1] + Math.sin(a) * 18,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - 30,
          life: 0,
          max: 0.6 + Math.random() * 0.8,
          r: 0.8 + Math.random() * 2.2,
          c: COLORS[(Math.random() * COLORS.length) | 0],
          drag: 2.6,
        });
      }
      start();
    }

    function ambient(dt: number) {
      const c = emblemCenter();
      if (!c) return;
      const em = cards[current]?.querySelector('.ch05-emblem') as HTMLElement | null;
      const w = (em?.clientWidth ?? 160) * 0.5;
      emitAcc += dt * (isTouch ? 9 : 16);
      while (emitAcc > 1) {
        emitAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const rr = w * (0.55 + Math.random() * 0.5);
        sparks.push({
          x: c[0] + Math.cos(a) * rr,
          y: c[1] + Math.sin(a) * rr * 0.9,
          vx: (Math.random() - 0.5) * 14,
          vy: -(16 + Math.random() * 36),
          life: 0,
          max: 1.6 + Math.random() * 1.6,
          r: 0.5 + Math.random() * 1.5,
          c: COLORS[(Math.random() * COLORS.length) | 0],
          drag: 0.2,
        });
      }
    }

    function frame(_t: number, deltaMs: number) {
      if (!ctx || !canvas) return;
      const dt = Math.min(deltaMs, 50) / 1000;
      if (running) ambient(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life += dt;
        if (p.life >= p.max) {
          sparks.splice(i, 1);
          continue;
        }
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const t = p.life / p.max;
        const alpha = t < 0.15 ? t / 0.15 : (1 - t) ** 1.4;
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        if (p.r > 1.6) {
          ctx.globalAlpha = alpha * 0.18;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!running && sparks.length === 0) {
        stopTick?.();
        stopTick = null;
      }
    }

    function start() {
      if (!ctx || stopTick) return;
      stopTick = onTick(frame);
    }

    /* ---------- 選取 ---------- */
    function centerCard(card: HTMLElement, smooth: boolean) {
      if (!roster) return;
      const left = card.offsetLeft - (roster.clientWidth - card.clientWidth) / 2;
      roster.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    }

    function choose(i: number, opts: { focus?: boolean; fromSnap?: boolean } = {}) {
      const n = cards.length;
      const next = ((i % n) + n) % n;
      const card = cards[next];
      if (opts.focus) card.focus({ preventScroll: true });
      if (mobile.matches && !opts.fromSnap) centerCard(card, true);

      if (next === current && introduced) {
        // 再按一次 = 確認：多一圈光
        burst(1.25);
        return;
      }
      current = next;
      if (reduced) {
        const backdrop = root?.querySelector<HTMLElement>('[data-ch05-backdrop]');
        if (backdrop) backdrop.textContent = card.dataset.id ?? '';
      }
      cards.forEach((c, k) => {
        c.setAttribute('aria-pressed', String(k === next));
      });
      panels.forEach((p, k) => {
        p.setAttribute('data-active', String(k === next));
      });
      root?.querySelectorAll('[data-ch05-dots] > span').forEach((d, k) => {
        d.setAttribute('data-active', String(k === next));
      });

      if (!reduced) {
        card.classList.remove('is-sweeping');
        void card.offsetWidth;
        card.classList.add('is-sweeping');
        const backdrop = root?.querySelector<HTMLElement>('[data-ch05-backdrop]');
        if (backdrop) {
          gsap.killTweensOf(backdrop);
          gsap
            .timeline()
            .to(backdrop, { xPercent: -6, opacity: 0, duration: 0.22, ease: 'power2.in' })
            .add(() => {
              backdrop.textContent = card.dataset.id ?? '';
            })
            .fromTo(
              backdrop,
              { xPercent: 6, opacity: 0 },
              { xPercent: 0, opacity: 1, duration: 0.7, ease: 'expo.out' },
            );
        }
        const plate = panels[next]?.querySelector('.ch05-plate');
        if (plate)
          gsap.fromTo(
            plate,
            { x: -18, opacity: 0 },
            { x: 0, opacity: 1, duration: 0.6, ease: 'expo.out' },
          );
        // 卡片展開到一半時，光從徽章炸開
        gsap.delayedCall(0.28, () => burst(1));
      }
      typeLine(panels[next]);
      introduced = true;
    }

    cards.forEach((card, i) => {
      card.addEventListener('click', () => choose(i));
    });

    roster.addEventListener('keydown', (e) => {
      const key = e.key;
      if (key === 'ArrowRight' || key === 'ArrowDown') {
        e.preventDefault();
        choose(current + 1, { focus: true });
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
        e.preventDefault();
        choose(current - 1, { focus: true });
      } else if (key === 'Home') {
        e.preventDefault();
        choose(0, { focus: true });
      } else if (key === 'End') {
        e.preventDefault();
        choose(cards.length - 1, { focus: true });
      }
    });

    // 手機：滑到哪張就選哪張
    let snapTimer = 0;
    roster.addEventListener(
      'scroll',
      () => {
        if (!mobile.matches) return;
        window.clearTimeout(snapTimer);
        snapTimer = window.setTimeout(() => {
          const mid = roster.scrollLeft + roster.clientWidth / 2;
          let best = 0;
          let bestD = Number.POSITIVE_INFINITY;
          cards.forEach((c, k) => {
            const d = Math.abs(c.offsetLeft + c.clientWidth / 2 - mid);
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          });
          if (best !== current) choose(best, { fromSnap: true });
        }, 110);
      },
      { passive: true },
    );

    /* ---------- 標題：全站最重要的一句話 ---------- */
    const title = root.querySelector<HTMLElement>('[data-ch05-title]');
    const body = root.querySelector<HTMLElement>('[data-ch05-body]');
    const hero = root.querySelector<HTMLElement>('.ch05-hero');
    const halo = root.querySelector<HTMLElement>('.ch05-halo');
    if (title) {
      const split = SplitText.create(title, { type: 'chars', charsClass: 'ch05-char' });
      title.classList.add('is-split');
      title.style.position = 'relative';
      const chars = split.chars as HTMLElement[];
      const last = chars[chars.length - 1];
      if (last && /[。.]/.test(last.textContent ?? '')) last.classList.add('is-dot');
      const layoutGradient = () => {
        const w = title.clientWidth;
        for (const ch of chars) {
          ch.style.setProperty('--ch05-w', `${w}px`);
          ch.style.setProperty('--ch05-x', `${-ch.offsetLeft}px`);
        }
      };
      layoutGradient();
      new ResizeObserver(layoutGradient).observe(title);

      if (!reduced && hero) {
        const tl = gsap.timeline({
          scrollTrigger: { trigger: hero, start: 'top 78%', end: 'top 8%', scrub: 0.8 },
        });
        tl.from(chars, {
          opacity: 0,
          yPercent: 38,
          filter: 'blur(16px)',
          duration: 0.5,
          ease: 'power3.out',
          stagger: 0.085,
        });
        if (last?.classList.contains('is-dot')) {
          tl.from(last, { scale: 0, duration: 0.35, ease: 'back.out(3)' }, '>-0.15');
        }
        if (body) tl.from(body, { opacity: 0, y: 24, duration: 0.45, ease: 'power2.out' }, '>-0.1');
        if (halo) {
          gsap.fromTo(
            halo,
            { opacity: 0.2, scale: 0.85 },
            {
              opacity: 1,
              scale: 1.05,
              ease: 'none',
              scrollTrigger: { trigger: hero, start: 'top bottom', end: 'bottom top', scrub: true },
            },
          );
        }
      }
    }

    /* ---------- 選擇畫面進場 ---------- */
    const dialog = root.querySelector<HTMLElement>('[data-ch05-dialog]');
    if (reduced) {
      typeLine(panels[0]);
    } else {
      gsap.set(cards, { opacity: 0, y: 70 });
      if (dialog) gsap.set(dialog, { opacity: 0, y: 30 });
      // 不用 once：once 會在其他 trigger 初次 refresh 時自我刪除，打亂 GSAP 的內部陣列
      let entered = false;
      ScrollTrigger.create({
        trigger: select,
        start: 'top 72%',
        onEnter: () => {
          if (entered) return;
          entered = true;
          gsap.to(cards, {
            opacity: 1,
            y: 0,
            duration: 1.1,
            ease: 'expo.out',
            stagger: 0.07,
          });
          if (dialog)
            gsap.to(dialog, {
              opacity: 1,
              y: 0,
              duration: 0.9,
              ease: 'expo.out',
              delay: 0.35,
              onStart: () => {
                introduced = true;
                typeLine(panels[current]);
                gsap.delayedCall(0.3, () => burst(1));
              },
            });
        },
      });
    }

    if (useSparks) {
      ScrollTrigger.create({
        trigger: select,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (self) => {
          running = self.isActive;
          if (running) start();
        },
      });
    }
  });
}
