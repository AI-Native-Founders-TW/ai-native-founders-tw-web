/**
 * 章節 06 互動：進入視窗時自動打出問題 → 思考中 → 逐筆列出結果；使用者也可以自己問。
 * 全部在瀏覽器內完成，不呼叫外部服務。計時只用 GSAP（引擎 ticker）。
 */
import { gsap, onReady, onTick, ScrollTrigger } from '../../engine';
import { type DemoPerson, match } from './match';
import {
  lineFound,
  lineKeywords,
  lineMore,
  lineReading,
  lineResult,
  lineThinking,
  lineUser,
  MAX_RESULTS,
  type TerminalCopy,
  transcript,
} from './render';

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function initAiNative() {
  const root = document.getElementById('ch-06');
  const raw = root?.querySelector('[data-ch06-data]')?.textContent;
  const log = root?.querySelector<HTMLOListElement>('[data-ch06-log]');
  const form = root?.querySelector<HTMLFormElement>('[data-ch06-form]');
  const input = root?.querySelector<HTMLInputElement>('#ch06-q');
  const status = root?.querySelector<HTMLElement>('[data-ch06-status]');
  const term = root?.querySelector<HTMLElement>('[data-ch06-term]');
  if (!root || !raw || !log || !form || !input || !term) return;
  // 給非同步函式用的已確認參照
  const logEl: HTMLOListElement = log;
  const termEl: HTMLElement = term;
  const data = JSON.parse(raw) as { people: DemoPerson[]; t: TerminalCopy; prompt: string };
  const { people, t } = data;

  onReady(({ reduced }) => {
    let runId = 0;

    const wait = (s: number) =>
      new Promise<void>((resolve) => {
        if (reduced) resolve();
        else gsap.delayedCall(s, resolve);
      });

    const toBottom = () => {
      log.scrollTo({ top: log.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
    };

    function append(html: string, animate = true) {
      log?.insertAdjacentHTML('beforeend', html);
      const el = log?.lastElementChild as HTMLElement | null;
      if (el && animate && !reduced)
        gsap.from(el, { opacity: 0, y: 8, duration: 0.45, ease: 'power3.out' });
      toBottom();
      return el;
    }

    function announce(n: number, names: string[]) {
      if (!status) return;
      const head = n ? t.found.replace('{n}', String(n)) : t.none;
      status.textContent = n ? `${head}：${names.join('、')}` : head;
    }

    async function run(query: string, opts: { typed: boolean }) {
      const id = ++runId;
      const alive = () => id === runId;
      const result = match(query, people);
      const names = result.matches.slice(0, MAX_RESULTS).map((m) => m.person.name);

      if (reduced) {
        logEl.innerHTML = transcript(t, query, people.length, result.keys, result.matches);
        announce(result.matches.length, names);
        return;
      }

      logEl.innerHTML = '';
      termEl.classList.add('is-running');

      // 1. 問題：自動示範時一個字一個字打出來
      const user = append(lineUser(opts.typed ? '' : query), !opts.typed);
      if (opts.typed && user) {
        const q = user.querySelector('.ln-q');
        const caret = document.createElement('span');
        caret.className = 'ln-caret';
        user.append(caret);
        const chars = Array.from(query);
        for (let i = 0; i < chars.length; i++) {
          if (!alive()) return;
          if (q) q.textContent += chars[i];
          // 人的節奏：空白與標點停久一點
          await wait(/[\s，？?]/.test(chars[i]) ? 0.14 : 0.045 + Math.random() * 0.05);
        }
        await wait(0.35);
        caret.remove();
      }
      if (!alive()) return;

      // 2. 讀取、拆關鍵字
      await wait(0.2);
      if (!alive()) return;
      append(lineReading(t, people.length));
      await wait(0.35);
      if (!alive()) return;
      append(lineKeywords(t, result.keys));

      // 3. 思考中
      await wait(0.25);
      if (!alive()) return;
      const think = append(lineThinking(t));
      const spin = think?.querySelector('.ln-spin');
      let f = 0;
      let acc = 0;
      const stop = onTick((_time, dt) => {
        acc += dt;
        if (acc > 80) {
          acc = 0;
          f = (f + 1) % SPIN.length;
          if (spin) spin.textContent = SPIN[f];
        }
      });
      await wait(opts.typed ? 1.1 : 0.7);
      stop();
      if (!alive()) return;
      think?.remove();

      // 4. 結果
      append(lineFound(t, result.matches.length));
      const shown = result.matches.slice(0, MAX_RESULTS);
      for (const m of shown) {
        await wait(0.14);
        if (!alive()) return;
        const el = append(lineResult(t, m), false);
        if (el) {
          gsap.from(el, { opacity: 0, x: -14, duration: 0.55, ease: 'expo.out' });
          const marks = el.querySelectorAll('mark');
          if (marks.length)
            gsap.from(marks, {
              backgroundSize: '0% 100%',
              duration: 0.6,
              delay: 0.2,
              ease: 'power2.out',
            });
        }
      }
      if (result.matches.length > MAX_RESULTS)
        append(lineMore(result.matches.length - MAX_RESULTS));
      termEl.classList.remove('is-running');
      announce(result.matches.length, names);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) {
        input.focus();
        return;
      }
      run(q, { typed: false });
    });

    for (const chip of root.querySelectorAll<HTMLButtonElement>('.ch06-chip')) {
      chip.addEventListener('click', () => {
        const q = chip.dataset.q ?? '';
        input.value = '';
        run(q, { typed: true });
      });
    }

    if (reduced) return;

    // 靜態版先藏起來，進入視窗時重新播放一次
    gsap.set(log, { opacity: 0 });
    // 不用 once：once 會在其他 trigger 初次 refresh 時自我刪除，打亂 GSAP 的內部陣列
    let entered = false;
    ScrollTrigger.create({
      trigger: term,
      start: 'top 72%',
      onEnter: () => {
        if (entered) return;
        entered = true;
        gsap.set(log, { opacity: 1 });
        run(data.prompt, { typed: true });
      },
    });

    // 進場：左側文字與三個重點
    const points = root.querySelectorAll('[data-ch06-point]');
    gsap.from(points, {
      opacity: 0,
      x: -16,
      duration: 0.8,
      ease: 'expo.out',
      stagger: 0.1,
      scrollTrigger: {
        trigger: points[0] ?? root,
        start: 'top 85%',
        toggleActions: 'play none none none',
      },
    });
    gsap.from(term, {
      opacity: 0,
      y: 40,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: term, start: 'top 90%', toggleActions: 'play none none none' },
    });
  });
}
