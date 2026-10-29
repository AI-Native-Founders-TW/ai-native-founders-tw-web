/**
 * 寬鬆解析 Members/*.md 自介。
 *
 * 範本（mono Members/README.md）的欄位：我是誰（含 GitHub、聯絡方式）、為什麼想加入、想要獲得什麼、
 * 想分享什麼、我的 R&R（可以幫什麼忙、想要幫什麼忙）。格式可自由調整，所以：
 * - 依標題「關鍵字」對應欄位，不依順序或層級；也接受「**可以幫什麼忙**：…」這種行內標籤。
 * - 抽不到任何欄位時，整篇放進 about，只發警告。
 * - 範本的 `<...>` 佔位視為未填。
 */
import {
  cleanInline,
  normalizeNewlines,
  splitSections,
  stripComments,
  stripFrontMatter,
  stripPlaceholders,
  toItems,
  toPlain,
} from './markdown';

export type IntroField = 'about' | 'why' | 'seek' | 'share' | 'canHelp' | 'wantHelp' | 'rnr';

export interface ParsedIntro {
  name?: string;
  github?: string;
  about?: string;
  why?: string;
  seek?: string;
  share?: string;
  canHelp: string[];
  wantHelp: string[];
  /** R&R 沒有分「可以／想要」時的原文（不猜是哪一種） */
  rnr?: string;
  /** 本人在自介中公開的網址 */
  links: string[];
  /** 是否抽到至少一個欄位；false 表示只能整篇顯示 */
  structured: boolean;
  /** 去掉註解與 front matter 的原文 */
  body: string;
  warnings: string[];
}

// 順序重要：R&R 標題同時含「可以幫」「想要幫」，要先判斷；「想要幫」要早於「可以幫」與「想要獲得」
const FIELD_PATTERNS: [IntroField, RegExp][] = [
  ['rnr', /r\s*&\s*r|r\s*and\s*r|role\s*(and|&)\s*responsibilit/i],
  [
    'wantHelp',
    /想要?幫|想協助|想參與|願意參與|want(ed)?\s+to\s+help|would\s+like\s+to\s+help|want\s+to\s+contribute/i,
  ],
  [
    'canHelp',
    /可以幫|能幫|可以協助|能協助|可提供|can\s+help|i\s+can\s+offer|how\s+i\s+can\s+help/i,
  ],
  [
    'seek',
    /想要?獲得|想得到|想學|想認識|期待|looking\s+for|hope\s+to\s+(get|learn)|what\s+i\s+want/i,
  ],
  ['share', /想要?分享|可以分享|分享什麼|want\s+to\s+share|can\s+share|share/i],
  ['why', /為什麼|為何|動機|why/i],
  ['about', /我是誰|關於我|自我介紹|簡介|^介紹|about|who\s+am\s+i|introduction|bio/i],
];

export function classifyHeading(title: string): IntroField | undefined {
  const t = cleanInline(title);
  return FIELD_PATTERNS.find(([, re]) => re.test(t))?.[0];
}

const GITHUB_LINE =
  /^\s*[-*]?\s*(?:\*\*)?github(?:\s*(?:帳號|account|id|handle))?(?:\*\*)?\s*[:：]\s*(.*)$/im;
const CONTACT_LINE =
  /^\s*[-*]?\s*(?:\*\*)?(?:其他)?(?:聯絡方式|聯繫方式|作品連結|連結|contact|links?)[^:：\n]{0,20}(?:\*\*)?\s*[:：].*$/gim;
const URL = /https?:\/\/[^\s<>()（）\]]+[^\s<>()（）\].,，。;；]/g;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NOT_USERS = new Set([
  'ai-native-founders-tw',
  'orgs',
  'features',
  'about',
  'settings',
  'login',
]);

/** 從一段文字取出 GitHub 帳號（`@foo`、`foo`、`https://github.com/foo`） */
export function extractGithub(value: string): string | undefined {
  const v = value.trim();
  if (!v || /^<[^>]*>$/.test(v)) return undefined;
  const url = /github\.com\/([A-Za-z0-9-]+)/i.exec(v);
  const raw = url
    ? url[1]
    : v
        .replace(/^@/, '')
        .replace(/[`*_]/g, '')
        .split(/[\s,，、（(]/)[0];
  if (!raw || !LOGIN.test(raw) || NOT_USERS.has(raw.toLowerCase())) return undefined;
  return raw;
}

/** 把「**標籤**：內容」形式的行內欄位轉成假標題，讓沒有用 ## 的自介也能被抽出 */
function promoteInlineLabels(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      const m = /^\s*(?:[-*]\s+)?(?:\*\*|__)?([^:：\n*_]{2,24}?)(?:\*\*|__)?\s*[:：]\s*(.*)$/.exec(
        line,
      );
      if (!m) return line;
      const field = classifyHeading(m[1]);
      if (!field || field === 'rnr') return line;
      return `### ${m[1].trim()}\n\n${m[2]}`;
    })
    .join('\n');
}

export function parseIntro(markdown: string, file = ''): ParsedIntro {
  const warnings: string[] = [];
  const body = normalizeNewlines(stripComments(stripFrontMatter(markdown))).trim();
  const out: ParsedIntro = {
    canHelp: [],
    wantHelp: [],
    links: [],
    structured: false,
    body,
    warnings,
  };
  if (!body) {
    warnings.push(`${file}: 自介是空的`);
    return out;
  }

  const sections = splitSections(promoteInlineLabels(body));
  const h1 = sections.find((s) => s.level === 1);
  const name = h1 && stripPlaceholders(cleanInline(h1.title));
  if (name) out.name = name;
  else warnings.push(`${file}: 找不到標題（# 名字），以檔名代替`);

  const gh = GITHUB_LINE.exec(body);
  if (gh) out.github = extractGithub(gh[1]);
  if (!out.github) {
    const any = /github\.com\/([A-Za-z0-9-]+)\/?(?=[\s)>]|$)/i.exec(body);
    if (any) out.github = extractGithub(any[0]);
  }

  out.links = [...new Set(body.match(URL) ?? [])].filter(
    (u) => !/github\.com\/AI-Native-Founders-TW/i.test(u) && !/docs\.github\.com/i.test(u),
  );

  const text: Partial<Record<IntroField, string>> = {};
  const append = (f: IntroField, t: string) => {
    if (!t.trim()) return;
    text[f] = text[f] ? `${text[f]}\n\n${t}` : t;
  };
  for (const s of sections) {
    if (s.level === 1) continue;
    const field = classifyHeading(s.title);
    if (!field) continue;
    // R&R 底下若有子標題，交給子標題處理；沒有子標題時保留為 rnr 原文
    append(field, s.ownText);
  }

  const strip = (t?: string) =>
    t
      ? toPlain(
          t
            .replace(GITHUB_LINE, '')
            .replace(CONTACT_LINE, '')
            .replace(/^R&R 必須在提交前寫清楚[^\n]*$/gm, ''),
        ) || undefined
      : undefined;

  out.about = strip(text.about);
  out.why = strip(text.why);
  out.seek = strip(text.seek);
  out.share = strip(text.share);
  out.canHelp = toItems(text.canHelp ?? '');
  out.wantHelp = toItems(text.wantHelp ?? '');

  // R&R 沒有分「可以／想要」：保留原文，不猜是哪一種
  const rnr = strip(text.rnr);
  if (rnr && !out.canHelp.length && !out.wantHelp.length) {
    warnings.push(`${file}: R&R 沒有分「可以幫什麼忙／想要幫什麼忙」，以原文顯示`);
    out.rnr = rnr;
  }

  out.structured = Boolean(
    out.about ||
      out.why ||
      out.seek ||
      out.share ||
      out.rnr ||
      out.canHelp.length ||
      out.wantHelp.length,
  );
  if (!out.structured) {
    warnings.push(`${file}: 對不到範本欄位，整篇顯示`);
    const firstH1Line = body.split('\n').findIndex((l) => /^#\s/.test(l));
    const rest =
      firstH1Line >= 0
        ? body
            .split('\n')
            .slice(firstH1Line + 1)
            .join('\n')
        : body;
    out.about = toPlain(rest) || undefined;
  }
  if (!out.github) warnings.push(`${file}: 找不到 GitHub 帳號`);
  if (!out.canHelp.length && !out.wantHelp.length && !out.rnr)
    warnings.push(`${file}: 沒有可辨識的 R&R`);
  return out;
}
