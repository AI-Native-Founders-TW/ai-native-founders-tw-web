// 章節 02 的確定性資料：伺服器端（Astro）與瀏覽器共用，確保每次畫面都一樣。

/** 可重現的亂數（mulberry32）。 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BubbleSeed {
  /** 對應 copy.coffeeChat.bubbles 的索引 */
  k: number;
  /** 景深：0 遠、1 中、2 近 */
  d: 0 | 1 | 2;
  /** 是否為「自己發出的」藍色泡泡 */
  me: boolean;
  /** 頭像色相變化 0–1 */
  g: number;
  initial: string;
  time: string;
  /** 手機上隱藏 */
  extra: boolean;
}

export const BUBBLE_COUNT = 42;
export const MOBILE_BUBBLES = 26;

const INITIALS = 'ABCDEFGHJKLMNPRSTWYZ';

export function buildField(questionCount: number): BubbleSeed[] {
  const r = rng(20261024);
  return Array.from({ length: BUBBLE_COUNT }, (_, i) => {
    // 前 questionCount 個每題各一，其餘重複；遠景最多
    const k = i < questionCount ? i : Math.floor(r() * questionCount);
    const dr = r();
    const d = (i < questionCount ? (dr < 0.5 ? 2 : 1) : dr < 0.42 ? 0 : dr < 0.78 ? 1 : 2) as
      | 0
      | 1
      | 2;
    const h = 9 + Math.floor(r() * 10);
    const m = Math.floor(r() * 60);
    return {
      k,
      d,
      me: r() < 0.22,
      g: Math.round(r() * 100) / 100,
      initial: INITIALS[Math.floor(r() * INITIALS.length)],
      time: `${h}:${String(m).padStart(2, '0')}`,
      extra: i >= MOBILE_BUBBLES,
    };
  });
}

/** 「1 次交流 → N 位創業者」拆成 [1, 次交流, N, 位創業者]；格式不符時回傳 null。 */
export function splitStat(text: string): [string, string, string, string] | null {
  const [left, right] = text.split('→').map((s) => s.trim());
  if (!left || !right) return null;
  // 開頭的數字或英文字母當作大字
  const a = /^([\dA-Za-z,+]+)\s*(.+)$/u.exec(left);
  const b = /^([\dA-Za-z,+]+)\s*(.+)$/u.exec(right);
  return a && b ? [a[1], a[2], b[1], b[2]] : null;
}

/** 把中文標題切成「片語」（在全形標點後斷開），讓換行落在語意上，也方便逐段動畫。 */
export function phrases(text: string): string[] {
  return text.match(/[^，。、；：！？,.!?]+[，。、；：！？,.!?]*/gu) ?? [text];
}
