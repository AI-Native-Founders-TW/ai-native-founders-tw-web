/**
 * 解析 mono 文件的「資訊貢獻者」：
 * - 各文件末尾的 `## 資訊貢獻者` 段落（憲法第 10 條）
 * - `specs/00-願景和問題/資訊貢獻者.md` 這種獨立檔（署名對象由檔內連結指出）
 */
import { cleanInline, normalizeNewlines, splitSections, stripComments } from './markdown';

export interface NameToken {
  name: string;
  /** 括號內的別名，例如「有平（Chris）」→ Chris */
  aliases: string[];
}

// 標題必須「就是」資訊貢獻者（避免誤認憲法「第 10 條（資訊貢獻者署名）」這類標題）
const HEADING =
  /^(?:資訊貢獻者|貢獻者|information\s+contributors?|contributors?)\s*(?:[（(][^）)]*[）)])?\s*$/i;

/** 「水球、有平（Chris）、Ray（Ray貓）。」→ NameToken[] */
export function parseNameList(text: string): NameToken[] {
  const flat = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*+•]|\d+[.)、])\s+/, '').trim())
    .filter(Boolean)
    .join('、');
  const tokens: NameToken[] = [];
  // 括號內不切（「Kun（ThisWeb、前端）」保持一個人）
  let depth = 0;
  let buf = '';
  const flush = () => {
    const t = cleanInline(buf)
      .replace(/[。．.!！]+$/, '')
      .trim();
    buf = '';
    if (!t) return;
    const m = /^(.+?)\s*[（(]([^）)]+)[）)]\s*$/.exec(t);
    const name = (m ? m[1] : t).trim();
    const aliases = m
      ? m[2]
          .split(/[、,，/／]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (name.length > 40 || /\s{2,}|[:：]/.test(name)) return; // 看起來是句子，不是名字
    tokens.push({ name, aliases });
  };
  for (const ch of flat) {
    if (ch === '（' || ch === '(') depth++;
    if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[、,，;；]/.test(ch)) flush();
    else buf += ch;
  }
  flush();
  return tokens;
}

/** 看起來像名單的段落：以頓號／逗號分隔、每段都短 */
function looksLikeNameList(paragraph: string): boolean {
  const p = paragraph.trim();
  if (!p || /^\[|^>|^#|\]\(/.test(p)) return false;
  const lines = p.split('\n');
  if (lines.every((l) => /^\s*[-*+•]\s+\S/.test(l))) return lines.every((l) => l.length <= 50);
  const parts = p.replace(/[。.]$/, '').split(/[、,，]/);
  return parts.length >= 2 && parts.every((x) => x.trim().length > 0 && x.trim().length <= 30);
}

/** 取出文件中「資訊貢獻者」段落的名單；沒有就回傳 null */
export function extractContributorSection(md: string): NameToken[] | null {
  const sections = splitSections(stripComments(md));
  const sec = [...sections]
    .reverse()
    .find((s) => s.level >= 2 && HEADING.test(cleanInline(s.title)));
  if (!sec) return null;
  const paras = sec.ownText.split(/\n{2,}/).filter(looksLikeNameList);
  if (!paras.length) return [];
  return paras.flatMap(parseNameList);
}

export interface ContributorsFile {
  /** 署名的目標文件（相對於該檔的路徑），例如 `vision.md` */
  targets: string[];
  names: NameToken[];
}

/** 解析獨立的「資訊貢獻者.md」 */
export function parseContributorsFile(md: string): ContributorsFile {
  const text = normalizeNewlines(stripComments(md));
  const body = text.replace(/^#\s+.*$/m, '');
  const targets = [...body.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)]
    .map((m) => decodeURIComponent(m[1]))
    .filter((p) => !p.startsWith('..'));
  const names = body
    .split(/\n{2,}/)
    .filter(looksLikeNameList)
    .flatMap(parseNameList);
  return { targets: [...new Set(targets)], names };
}
