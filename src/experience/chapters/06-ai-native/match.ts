/**
 * AI-Native 示範的比對器：純關鍵字，在建置時（產生靜態版）與瀏覽器裡（互動版）共用。
 * 不呼叫任何外部 AI。只比對本人公開的 roles、canHelp、wantHelp。
 */

export type FieldKey = 'roles' | 'canHelp' | 'wantHelp';

export interface DemoPerson {
  id: string;
  name: string;
  github?: string;
  avatar?: string;
  hasIntro: boolean;
  roles: { label: string; source: string }[];
  canHelp: string[];
  wantHelp: string[];
}

export interface Hit {
  field: FieldKey;
  text: string;
  source?: string;
  /** 命中的區段（在 text 中的起訖位置），用來加上高亮 */
  ranges: [number, number][];
}

export interface Match {
  person: DemoPerson;
  score: number;
  hits: Hit[];
}

const WEIGHT: Record<FieldKey, number> = { roles: 3, canHelp: 3, wantHelp: 2 };

// 問句裡的功能詞（不是要找的「事」）
const ZH_STOP = [
  '有沒有人',
  '有誰',
  '誰能',
  '誰會',
  '誰可以',
  '誰想',
  '誰',
  '可以',
  '能夠',
  '幫忙',
  '幫我',
  '幫',
  '一起',
  '我們',
  '我',
  '你',
  '想要',
  '想',
  '需要',
  '要',
  '做',
  '寫',
  '會',
  '能',
  '的',
  '嗎',
  '呢',
  '吧',
  '請問',
  '一下',
  '一個',
  '找',
  '人',
  '有',
  '和',
  '跟',
  '或',
  '與',
  '在',
  '是',
];
const EN_STOP = new Set(
  'who can could would will help me my i we us a an the to for with do make build need want someone anyone is are of and or on in please'.split(
    ' ',
  ),
);

// 同義詞：讓「網站」也找得到寫 landing page 的人
const SYNONYMS: string[][] = [
  ['landing page', 'landing', '官網', '網站', '到達頁', 'website', 'web'],
  ['設計', 'design', 'ui', 'ux', 'uiux', 'ui/ux', '視覺', '介面'],
  ['logo', '標誌', '品牌', 'brand'],
  ['文案', 'copy', 'copywriting', '寫作', '內容'],
  ['前端', 'frontend', 'front-end'],
  ['後端', 'backend', 'back-end'],
  ['程式', '開發', 'code', 'coding', 'engineer', '工程'],
  ['行銷', 'marketing', '社群經營', 'growth'],
  ['募資', 'fundraising', 'funding', '投資'],
  ['活動', 'event', 'events'],
  ['ai', 'llm', 'agent'],
];

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

/** 把問句拆成關鍵字（含片語與同義詞），回傳 [關鍵字, 是否為使用者原字]。 */
export function keywords(query: string): string[] {
  const q = norm(query).replace(/[？?！!。，,、；;：:「」『』"'()（）]/g, ' ');
  const out = new Set<string>();

  // 英文：單字與相鄰兩字的片語
  const words = (q.match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []).filter((w) => !EN_STOP.has(w));
  for (const w of words) if (w.length >= 2) out.add(w);
  for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]} ${words[i + 1]}`);

  // 中文：去掉功能詞後剩下的片段；長片段再補上雙字詞
  let zh = q.replace(/[a-z0-9+#.-]+/g, ' ');
  for (const s of ZH_STOP) zh = zh.split(s).join(' ');
  for (const run of zh.split(/\s+/).filter(Boolean)) {
    const chars = Array.from(run);
    if (chars.length >= 2) out.add(run);
    if (chars.length > 2)
      for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1]);
  }

  // 使用者自己的字放前面（片語優先），同義詞接在後面
  const own = [...out].sort((a, b) => b.length - a.length);
  const all = new Set(own);
  for (const k of own) {
    for (const group of SYNONYMS) if (group.includes(k)) for (const g of group) all.add(g);
  }
  return [...all];
}

function findRanges(text: string, keys: string[]): [number, number][] {
  const t = norm(text);
  const ranges: [number, number][] = [];
  // 長的關鍵字先比對，避免「landing」搶走「landing page」
  for (const k of [...keys].sort((a, b) => b.length - a.length)) {
    let from = 0;
    while (from < t.length) {
      const i = t.indexOf(k, from);
      if (i === -1) break;
      // 英文關鍵字要對齊字的邊界，避免 "ui" 命中 "build"
      const ascii = /^[a-z0-9]/.test(k);
      const before = t[i - 1];
      const after = t[i + k.length];
      const okEdge =
        !ascii || ((!before || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after)));
      if (okEdge && !ranges.some(([a, b]) => i < b && i + k.length > a))
        ranges.push([i, i + k.length]);
      from = i + k.length;
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

export function match(query: string, people: DemoPerson[]): { keys: string[]; matches: Match[] } {
  const keys = keywords(query);
  if (!keys.length) return { keys, matches: [] };
  const matches: Match[] = [];
  for (const person of people) {
    const hits: Hit[] = [];
    let score = 0;
    const check = (field: FieldKey, text: string, source?: string) => {
      const ranges = findRanges(text, keys);
      if (!ranges.length) return;
      const covered = ranges.reduce((n, [a, b]) => n + (b - a), 0);
      score += WEIGHT[field] * (1 + covered / Math.max(text.length, 1));
      hits.push({ field, text, source, ranges });
    };
    for (const r of person.roles) check('roles', r.label, r.source);
    for (const t of person.canHelp) check('canHelp', t);
    for (const t of person.wantHelp) check('wantHelp', t);
    if (hits.length) matches.push({ person, score, hits });
  }
  matches.sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name));
  return { keys, matches };
}

/** 把命中區段包成 <mark>，其餘文字轉義。 */
export function highlight(text: string, ranges: [number, number][]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let out = '';
  let at = 0;
  for (const [a, b] of ranges) {
    out += `${esc(text.slice(at, a))}<mark>${esc(text.slice(a, b))}</mark>`;
    at = b;
  }
  return out + esc(text.slice(at));
}
