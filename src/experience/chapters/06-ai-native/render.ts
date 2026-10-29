/**
 * 終端機輸出的 HTML 產生器：建置時產生靜態版（沒有 JS、減少動態時也看得到完整示範），
 * 瀏覽器裡用同一套函式逐行播放。
 */
import { type DemoPerson, type FieldKey, highlight, type Match } from './match';

export interface TerminalCopy {
  reading: string;
  count: string;
  keywords: string;
  thinking: string;
  found: string;
  none: string;
  fields: Record<FieldKey, string>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fill = (tpl: string, n: number) => tpl.replace('{n}', String(n));

export const MAX_RESULTS = 5;

export function lineUser(query: string) {
  return `<li class="ln ln-user"><span class="ln-sig" aria-hidden="true">›</span><span class="ln-q">${esc(query)}</span></li>`;
}

export function lineReading(t: TerminalCopy, total: number) {
  return `<li class="ln ln-sys"><span class="ln-sig" aria-hidden="true">◇</span><span>${esc(t.reading)}</span><span class="ln-dim">${esc(fill(t.count, total))}</span></li>`;
}

export function lineKeywords(t: TerminalCopy, keys: string[]) {
  const shown = keys
    .slice(0, 4)
    .map((k) => `<code class="ln-key">${esc(k)}</code>`)
    .join('');
  const more = keys.length > 4 ? `<span class="ln-dim">+${keys.length - 4}</span>` : '';
  return `<li class="ln ln-sys"><span class="ln-sig" aria-hidden="true">◇</span><span>${esc(t.keywords)}</span><span class="ln-keys">${shown || '<span class="ln-dim">—</span>'}${more}</span></li>`;
}

export function lineThinking(t: TerminalCopy) {
  return `<li class="ln ln-think" data-thinking><span class="ln-sig ln-spin" aria-hidden="true">⠋</span><span>${esc(t.thinking)}</span><span class="ln-bar" aria-hidden="true"><span></span></span></li>`;
}

export function lineFound(t: TerminalCopy, n: number) {
  if (!n)
    return `<li class="ln ln-none"><span class="ln-sig" aria-hidden="true">○</span><span>${esc(t.none)}</span></li>`;
  return `<li class="ln ln-ok"><span class="ln-sig" aria-hidden="true">◆</span><span>${esc(fill(t.found, n))}</span></li>`;
}

function initials(name: string) {
  const ch = Array.from(name.trim())[0] ?? '?';
  return esc(ch.toUpperCase());
}

export function avatarHtml(p: Pick<DemoPerson, 'name' | 'avatar'>, cls = 'res-av') {
  if (p.avatar)
    return `<span class="${cls}"><img src="${esc(p.avatar)}" alt="" width="44" height="44" loading="lazy" decoding="async" /></span>`;
  return `<span class="${cls} is-initial" aria-hidden="true">${initials(p.name)}</span>`;
}

export function lineResult(t: TerminalCopy, m: Match) {
  const p = m.person;
  const hits = m.hits
    .slice(0, 3)
    .map(
      (h) =>
        `<li><span class="res-field res-field--${h.field}">${esc(t.fields[h.field])}${h.source ? `<span class="res-src"> · ${esc(h.source)}</span>` : ''}</span><span class="res-text">${highlight(h.text, h.ranges)}</span></li>`,
    )
    .join('');
  const handle = p.github ? `<span class="res-handle">@${esc(p.github)}</span>` : '';
  const name = p.github
    ? `<a class="res-name" href="https://github.com/${encodeURIComponent(p.github)}" rel="noopener">${esc(p.name)}</a>`
    : `<span class="res-name">${esc(p.name)}</span>`;
  return `<li class="ln ln-res"><div class="res">${avatarHtml(p)}<div class="res-main"><p class="res-head">${name}${handle}</p><ul class="res-hits">${hits}</ul></div></div></li>`;
}

export function lineMore(n: number) {
  return `<li class="ln ln-sys"><span class="ln-sig" aria-hidden="true">…</span><span class="ln-dim">+${n}</span></li>`;
}

/** 完整的靜態輸出（不含思考中）。 */
export function transcript(
  t: TerminalCopy,
  query: string,
  total: number,
  keys: string[],
  matches: Match[],
) {
  const shown = matches.slice(0, MAX_RESULTS);
  return [
    lineUser(query),
    lineReading(t, total),
    lineKeywords(t, keys),
    lineFound(t, matches.length),
    ...shown.map((m) => lineResult(t, m)),
    ...(matches.length > MAX_RESULTS ? [lineMore(matches.length - MAX_RESULTS)] : []),
  ].join('');
}
