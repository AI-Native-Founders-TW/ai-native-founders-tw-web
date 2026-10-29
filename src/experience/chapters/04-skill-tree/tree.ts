/**
 * 章節 04「流派技能樹」的捲動點亮與互動。
 *
 * 節奏（p = 章節進度 0–1）：
 *   起  p 0.00–0.10  鏡頭拉近在中心「你」，所有路徑都是暗的
 *   承  p 0.10–0.80  路徑一條條點亮（像點天賦），三個分支依序；鏡頭慢慢拉遠看到整棵樹
 *                   每點亮一個流派節點，就自動展開它的流派卡
 *   停  p 0.80–1.00  整棵樹亮起、內圈閉合；使用者可以自由滑過／聚焦／點擊流派節點
 */
import { type EngineState, onTick, ScrollTrigger } from '../../engine';
import { buildTree } from './layout';

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : Math.min(v, b));
const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
const outCubic = (t: number) => 1 - (1 - t) ** 3;

const LIGHT = [0.1, 0.8] as const;

export function initSkillTree(root: HTMLElement, s: EngineState) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.st-build'));
  const cards = new Map(
    Array.from(root.querySelectorAll<HTMLElement>('.st-card')).map(
      (c) => [c.dataset.build!, c] as const,
    ),
  );
  const nodeEls = new Map(
    Array.from(root.querySelectorAll<SVGGElement>('.st-n')).map((g) => [g.dataset.id!, g] as const),
  );

  // ── 互動（減少動態時也可用，但靜態版的卡片本來就全部顯示，所以只在動態版啟用） ──
  if (s.reduced) return;
  root.classList.add('is-live');

  let selected: string | null = null;
  let selectedBy: 'auto' | 'user' | null = null;
  let lastUser = 0;

  function select(id: string | null, by: 'auto' | 'user') {
    if (by === 'user') lastUser = performance.now();
    if (id === selected) {
      if (by === 'user') selectedBy = 'user';
      return;
    }
    selected = id;
    selectedBy = id ? by : null;
    for (const [bid, card] of cards) card.classList.toggle('is-open', bid === id);
    root.classList.toggle('has-card', !!id);
    for (const b of buttons) b.setAttribute('aria-expanded', String(b.dataset.build === id));
    for (const g of nodeEls.values()) {
      if (g.dataset.build) g.classList.toggle('is-selected', g.dataset.build === id);
    }
  }

  for (const b of buttons) {
    const id = b.dataset.build!;
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') select(id, 'user');
    });
    b.addEventListener('focus', () => select(id, 'user'));
    b.addEventListener('click', () => select(id, 'user'));
  }
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected) {
      const btn = buttons.find((b) => b.dataset.build === selected);
      select(null, 'user');
      btn?.focus({ preventScroll: true });
    }
  });
  // 點擊樹以外的地方關閉（卡片內點擊不關）
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!selected || t.closest('.st-build, .st-card')) return;
    if (root.contains(t) && selectedBy === 'user') select(null, 'user');
  });

  // ── 點亮資料（與伺服器端相同的確定性版面） ──
  const branchBuild = [0, 1, 2].map(
    (i) => buttons.find((b) => b.dataset.branch === String(i))?.dataset.build,
  );
  const tree = buildTree(branchBuild);
  const glow = Array.from(root.querySelectorAll<SVGPathElement>('.st-edges-glow path'));
  const lit = Array.from(root.querySelectorAll<SVGPathElement>('.st-edges-lit path'));
  const incoming = new Map<string, number>();
  tree.edges.forEach((e, i) => {
    const prev = incoming.get(e.to);
    if (prev === undefined || tree.edges[prev].t1 > e.t1) incoming.set(e.to, i);
  });
  const lastF = new Float32Array(tree.edges.length).fill(-1);
  const nodeOn = new Map<string, boolean>();

  const zoom = root.querySelector<HTMLElement>('.st-zoom')!;
  const bg = root.querySelector<SVGGElement>('.st-bg')!;
  const count = root.querySelector<HTMLElement>('.st-count')!;
  const branchLabels = Array.from(root.querySelectorAll<HTMLElement>('.st-branch'));
  const phrases = Array.from(root.querySelectorAll<HTMLElement>('.st-ph-in'));
  const textBits = Array.from(
    root.querySelectorAll<HTMLElement>('.st-kicker, .st-body, .st-status, .st-hint, .st-cta'),
  );
  const total = tree.nodes.length;

  const trigger = root.querySelector<HTMLElement>('.st-col-tree')!;
  const main = ScrollTrigger.create({ trigger, start: 'top top', end: 'bottom bottom' });
  const entry = ScrollTrigger.create({ trigger: root, start: 'top 85%', end: 'top 15%' });
  let active = false;
  const io = new IntersectionObserver(([e]) => (active = e.isIntersecting), {
    rootMargin: '10% 0px',
  });
  io.observe(root);

  let mx = 0;
  let my = 0;
  let smx = 0;
  let smy = 0;
  if (!s.isTouch) {
    window.addEventListener(
      'pointermove',
      (e) => {
        mx = (e.clientX / window.innerWidth) * 2 - 1;
        my = (e.clientY / window.innerHeight) * 2 - 1;
      },
      { passive: true },
    );
  }

  let prog = 0;
  let lastCount = -1;
  onTick((time, dt) => {
    if (!active) return;
    const k = 1 - Math.exp(-(dt / 1000) * 8);
    prog += (main.progress - prog) * k;
    if (Math.abs(main.progress - prog) < 0.0001) prog = main.progress;
    smx += (mx - smx) * 0.05;
    smy += (my - smy) * 0.05;
    render(prog, time);
  });

  function render(p: number, time: number) {
    const L = range(p, LIGHT[0], LIGHT[1]);

    // 鏡頭：從中心拉遠
    const z = 1 + 0.38 * (1 - outCubic(range(p, 0.0, 0.45)));
    zoom.style.transform = `scale(${z.toFixed(4)})`;
    bg.style.transform = `translate(${(-smx * 14).toFixed(1)}px,${(-smy * 14).toFixed(1)}px)`;

    // 文字進場
    const e = entry.progress;
    phrases.forEach((el, i) => {
      const a = outCubic(range(e, 0.1 + i * 0.12, 0.6 + i * 0.12));
      el.style.transform = `translate3d(0,${((1 - a) * 110).toFixed(1)}%,0)`;
    });
    textBits.forEach((el, i) => {
      const a = outCubic(range(e, 0.25 + i * 0.08, 0.7 + i * 0.08));
      el.style.opacity = a.toFixed(3);
      el.style.transform = `translate3d(0,${((1 - a) * 14).toFixed(1)}px,0)`;
    });

    // 路徑
    tree.edges.forEach((edge, i) => {
      const f = range(L, edge.t0, edge.t1);
      const q = Math.round(f * 500) / 500;
      if (q === lastF[i]) return;
      lastF[i] = q;
      const off = (1 - q).toFixed(3);
      lit[i].style.strokeDashoffset = off;
      glow[i].style.strokeDashoffset = off;
    });

    // 節點
    let on = 0;
    for (const n of tree.nodes) {
      const ei = incoming.get(n.id);
      const isOn = n.id === 'root' ? p > 0.02 : ei !== undefined && lastF[ei] >= 0.98;
      if (isOn) on++;
      if (nodeOn.get(n.id) === isOn) continue;
      nodeOn.set(n.id, isOn);
      const g = nodeEls.get(n.id);
      if (!g) continue;
      g.classList.toggle('on', isOn);
      if (isOn && n.kind !== 'small') {
        g.querySelector('.st-halo')?.animate(
          [
            { transform: 'scale(0.3)', opacity: 0 },
            { transform: 'scale(1.35)', opacity: 1, offset: 0.4 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 700, easing: 'cubic-bezier(0.22,1,0.36,1)' },
        );
      }
      // 分支名稱、流派名稱
      if (n.kind === 'notable' && n.id.endsWith('-gate'))
        branchLabels[n.branch]?.classList.toggle('is-on', isOn);
      if (n.kind === 'build' && n.buildId) {
        const btn = buttons.find((b) => b.dataset.build === n.buildId);
        btn?.classList.toggle('is-on', isOn);
        // 點亮時自動展開；使用者剛操作過就不搶
        const userRecently = performance.now() - lastUser < 4000 && selectedBy === 'user';
        if (isOn && !userRecently) select(n.buildId, 'auto');
        if (!isOn && selected === n.buildId && selectedBy === 'auto') select(null, 'auto');
      }
    }
    if (on !== lastCount) {
      count.textContent = String(on).padStart(2, '0');
      lastCount = on;
    }
    void time;
    void total;
  }

  ScrollTrigger.refresh();
}
