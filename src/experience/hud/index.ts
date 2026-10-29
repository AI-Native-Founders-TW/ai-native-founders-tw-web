/**
 * Speedrun 計時器。
 * - 開場結束（anf:run-start）後開跑，mm:ss.mmm。
 * - 每個 [data-split] 章節第一次進入畫面中線時，記下抵達時間；上一個 split 的分段時間＝兩次抵達的差。
 * - anf:finish 停表並廣播 anf:run-time（detail: { ms, text }）；anf:replay 重置並重新開跑。
 */
import { onReady, onTick, RUN_EVENTS, resumeRun, ScrollTrigger, skipRun, whenRun } from '../engine';

export function fmt(ms: number) {
  const t = Math.max(0, Math.floor(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const r = t % 1000;
  return {
    mmss: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    ms: `.${String(r).padStart(3, '0')}`,
  };
}
const short = (ms: number) => {
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` : s.toFixed(1);
};

export function initHud() {
  const hud = document.getElementById('hud');
  if (!hud) return;
  const $ = <T extends Element>(s: string) => hud.querySelector<T>(s)!;
  const mmss = $<HTMLElement>('.hud__mmss');
  const msEl = $<HTMLElement>('.hud__ms');
  const nowId = $<HTMLElement>('.hud__now-id');
  const nowName = $<HTMLElement>('.hud__now-name');
  const nowSeg = $<HTMLElement>('.hud__now-seg');
  const live = $<HTMLElement>('[data-live]');
  const skipBtn = $<HTMLButtonElement>('[data-skip]');
  const skipLabel = $<HTMLElement>('.hud__skip-label');
  const rows = new Map(
    [...hud.querySelectorAll<HTMLElement>('.hud__splits li')].map((li) => [li.dataset.id!, li]),
  );
  const pips = new Map(
    [...hud.querySelectorAll<HTMLElement>('.hud__pips li')].map((li) => [li.dataset.id!, li]),
  );

  const skipped = sessionStorage.getItem('anf:skip-run') === '1';
  if (skipped) skipLabel.textContent = skipLabel.dataset.labelResume ?? skipLabel.textContent;
  skipBtn.addEventListener('click', () => (skipped ? resumeRun() : skipRun()));

  let state: 'idle' | 'running' | 'finished' = 'idle';
  let startAt = 0;
  let finalMs = 0;
  let current = '';
  let reach = new Map<string, number>();
  let lastText = '';

  const elapsed = () =>
    state === 'finished' ? finalMs : state === 'running' ? performance.now() - startAt : 0;

  const setState = (s: typeof state) => {
    state = s;
    hud.dataset.state = s;
  };

  const paint = () => {
    const e = elapsed();
    const f = fmt(e);
    const text = f.mmss + f.ms;
    if (text !== lastText) {
      lastText = text;
      mmss.textContent = f.mmss;
      msEl.textContent = f.ms;
    }
    if (current && reach.has(current)) {
      nowSeg.textContent = `+${short(e - reach.get(current)!)}`;
    }
  };

  const ids = [...rows.keys()];
  const renderSplits = () => {
    const sorted = ids.filter((id) => reach.has(id));
    for (const id of ids) {
      const li = rows.get(id)!;
      const pip = pips.get(id);
      const t = reach.get(id);
      const idx = sorted.indexOf(id);
      const next = idx >= 0 ? sorted[idx + 1] : undefined;
      let s = '';
      if (id === current && state !== 'finished') s = 'now';
      else if (t !== undefined) s = 'done';
      li.dataset.s = s;
      if (pip) pip.dataset.s = s;
      const tEl = li.querySelector('.t')!;
      const dEl = li.querySelector('.d')!;
      if (t === undefined) {
        tEl.textContent = '—';
        dEl.textContent = '';
      } else {
        const end =
          next !== undefined
            ? reach.get(next)!
            : state === 'finished' && id === current
              ? finalMs
              : undefined;
        tEl.textContent = `${fmt(t).mmss}${fmt(t).ms.slice(0, 2)}`;
        dEl.textContent = end !== undefined ? `+${short(end - t)}` : '';
      }
    }
  };

  const setCurrent = (id: string, name: string) => {
    if (state === 'idle') return;
    current = id;
    nowId.textContent = id;
    nowName.textContent = name;
    if (state === 'running' && !reach.has(id)) reach.set(id, elapsed());
    renderSplits();
  };

  const start = (sinceMs: number) => {
    reach = new Map();
    startAt = performance.now() - sinceMs;
    setState('running');
    // 開跑時，畫面上是哪一章就從哪一章算起
    const active = ScrollTrigger.getAll().find(
      (st) => st.vars.id?.startsWith('hud-') && st.isActive,
    );
    const first = active
      ? (active.trigger as HTMLElement)
      : document.querySelector<HTMLElement>('[data-split="01"]');
    if (first) setCurrent(first.dataset.split!, first.dataset.splitName ?? '');
    renderSplits();
  };

  onReady(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-split]')) {
      const id = el.dataset.split!;
      if (id === '00') continue;
      ScrollTrigger.create({
        id: `hud-${id}`,
        trigger: el,
        start: 'top 55%',
        end: 'bottom 55%',
        onToggle: (st) => st.isActive && setCurrent(id, el.dataset.splitName ?? ''),
      });
    }
    whenRun('run-start', (since) => start(since));
    onTick(paint);
    paint();
  });

  window.addEventListener(RUN_EVENTS.finish, () => {
    if (state !== 'running') return;
    finalMs = performance.now() - startAt;
    setState('finished');
    renderSplits();
    paint();
    const f = fmt(finalMs);
    const text = f.mmss + f.ms;
    window.__anf ??= {};
    Object.assign(window.__anf, { final: finalMs });
    live.textContent = `${hud.querySelector('.hud__stamp')?.textContent ?? ''} ${text}`;
    window.dispatchEvent(new CustomEvent(RUN_EVENTS.time, { detail: { ms: finalMs, text } }));
  });

  // 安靜段（章節 07）：HUD 退到背景
  window.addEventListener('anf:quiet', (e) => {
    hud.toggleAttribute('data-quiet', !!(e as CustomEvent<{ active: boolean }>).detail?.active);
  });

  window.addEventListener(RUN_EVENTS.replay, () => {
    live.textContent = '';
    current = '';
    start(0);
  });
}
