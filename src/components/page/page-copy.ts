// 內頁（/join、/credits）的文案：src/content/copy/<page>.<locale>.yaml；英文缺的欄位退回中文。
import { parse } from 'yaml';
import type { Copy, Locale } from '../../i18n/copy';

const files = import.meta.glob('../../content/copy/{join,credits}.{zh-tw,en}.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function merge(base: Copy, over: Copy): Copy {
  const out: Copy = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] ? merge(base[k], v) : v;
  }
  return out;
}

export function getPageCopy(page: 'join' | 'credits', locale: Locale): Copy {
  const read = (l: Locale) => {
    const raw = files[`../../content/copy/${page}.${l}.yaml`];
    return raw ? ((parse(raw) as Copy) ?? {}) : {};
  };
  const zh = read('zh-tw');
  return locale === 'en' ? merge(zh, read('en')) : zh;
}

/** 依語系加上 /en 前綴 */
export const localePath = (locale: Locale, path: string) =>
  locale === 'en' ? (path === '/' ? '/en/' : `/en${path}`) : path;
