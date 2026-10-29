/**
 * 極小的 Markdown 工具：只處理本專案需要的結構（標題分段、清單、表格、佔位文字）。
 * 不引入 Markdown parser：mono 的內容格式自由，這裡刻意寬鬆。
 */

export interface Section {
  level: number;
  title: string;
  /** 標題下、到下一個「同級或更高」標題前的全文（含子標題） */
  body: string;
  /** 標題下、到下一個任意標題前的文字（不含子標題） */
  ownText: string;
}

const FENCE = /^\s*(```|~~~)/;

/** 移除 HTML 註解；保留程式碼區塊外的內容行號不變 */
export function stripComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '');
}

/** 去掉 YAML front matter */
export function stripFrontMatter(md: string): string {
  return md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function normalizeNewlines(md: string): string {
  return md.replace(/\r\n?/g, '\n');
}

/** 依 ATX 標題（# ～ ######）切段；程式碼區塊內的 # 不算標題 */
export function splitSections(md: string): Section[] {
  const lines = normalizeNewlines(md).split('\n');
  const heads: { level: number; title: string; line: number }[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: i });
  });
  return heads.map((h, idx) => {
    const nextAny = heads[idx + 1]?.line ?? lines.length;
    const nextSame = heads.slice(idx + 1).find((x) => x.level <= h.level)?.line ?? lines.length;
    return {
      level: h.level,
      title: h.title,
      body: lines
        .slice(h.line + 1, nextSame)
        .join('\n')
        .trim(),
      ownText: lines
        .slice(h.line + 1, nextAny)
        .join('\n')
        .trim(),
    };
  });
}

/** 範本中的 `<...>` 佔位文字（整段都是佔位）視為未填 */
export function isPlaceholder(text: string): boolean {
  const t = text.trim();
  return (
    t.length === 0 || /^<[^<>]*>$/.test(t) || /^[（(]?(選填|optional|todo|tbd|待補)[)）]?$/i.test(t)
  );
}

/** 移除整段是佔位文字的段落與行內 `<...>`（行內佔位以空字串取代） */
export function stripPlaceholders(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => !isPlaceholder(p))
    .map((p) => p.replace(/<(?!https?:)[^<>\n]{2,}>/g, '').trim())
    .filter(Boolean)
    .join('\n\n');
}

const BULLET = /^\s*(?:[-*+•]|\d+[.)、])\s+/;

/**
 * 把一段文字拆成條列：有清單就取清單項目（縮排的續行併入上一項），否則以空行分段。
 */
export function toItems(text: string): string[] {
  const clean = stripPlaceholders(text);
  if (!clean) return [];
  const lines = clean.split('\n');
  if (lines.some((l) => BULLET.test(l))) {
    const items: string[] = [];
    for (const line of lines) {
      if (BULLET.test(line)) items.push(line.replace(BULLET, '').trim());
      else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
      else if (line.trim()) items.push(line.trim());
    }
    return items.map(cleanInline).filter(Boolean);
  }
  return clean
    .split(/\n{2,}/)
    .map((p) => cleanInline(p.replace(/\n/g, ' ')))
    .filter(Boolean);
}

/** 去掉粗體／斜體／行內程式碼標記，連結保留文字與網址 */
export function cleanInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把一段 Markdown 轉成純文字段落（保留換段） */
export function toPlain(text: string): string {
  return stripPlaceholders(text)
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => cleanInline(l.replace(BULLET, '· ')))
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

export interface Table {
  header: string[];
  rows: string[][];
}

/** 找出所有 GFM 表格 */
export function parseTables(md: string): Table[] {
  const lines = normalizeNewlines(md).split('\n');
  const tables: Table[] = [];
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (!/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const header = cells(lines[i]);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(cells(lines[j]));
    tables.push({ header, rows });
    i = j;
  }
  return tables;
}

/** 第一個 H1 的文字 */
export function firstH1(md: string): string | undefined {
  return splitSections(md).find((s) => s.level === 1)?.title;
}
