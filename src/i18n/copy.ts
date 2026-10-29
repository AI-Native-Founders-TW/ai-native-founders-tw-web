import { parse } from 'yaml';
import zhRaw from '../content/copy/zh-tw.yaml?raw';

// en.yaml 缺少的欄位會退回 zh-tw
const enFiles = import.meta.glob('../content/copy/en.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const enRaw = Object.values(enFiles)[0] as string | undefined;

export type Locale = 'zh-tw' | 'en';
// biome-ignore lint/suspicious/noExplicitAny: 文案結構由 YAML 決定
export type Copy = Record<string, any>;

const zh = parse(zhRaw) as Copy;
const en = enRaw ? (parse(enRaw) as Copy) : {};

function merge(base: Copy, over: Copy): Copy {
  const out: Copy = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] ? merge(base[k], v) : v;
  }
  return out;
}

export function getCopy(locale: Locale = 'zh-tw'): Copy {
  return locale === 'en' ? merge(zh, en) : zh;
}

export function getLocale(currentLocale: string | undefined): Locale {
  return currentLocale === 'en' ? 'en' : 'zh-tw';
}

/** 依語言加上路徑前綴：localePath('en', '/join') → '/en/join' */
export function localePath(locale: Locale, path: string): string {
  return locale === 'en' ? `/en${path === '/' ? '/' : path}` : path;
}
