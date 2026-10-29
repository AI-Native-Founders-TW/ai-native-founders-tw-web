/**
 * 對外輸出（/api/v1/*.json、llms.txt）的欄位白名單。
 * 原則：只輸出本人在自介 PR 中公開的內容，以及 mono／本 repo 已公開的紀錄；
 * 不輸出 email、內部快取路徑或 credits.yml 中的備註。
 */
import type { FullGraph, IntroRecord } from './build-graph';
import type { PersonRecord } from './identity';

export const API_VERSION = 1;

export function json(data: unknown): Response {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function text(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function meta(g: FullGraph, site?: URL) {
  return {
    version: API_VERSION,
    generatedAt: g.generatedAt,
    site: site?.origin,
    source: {
      mono: g.sources.mono
        ? {
            repo: 'https://github.com/AI-Native-Founders-TW/ai-native-founders-tw-mono',
            commit: g.sources.mono.commit,
          }
        : null,
      fallback: g.sources.fallback || undefined,
    },
  };
}

/** people.json：有自介者，只放自介中本人寫的內容 */
export function publicIntro(p: PersonRecord, intro: IntroRecord) {
  return {
    id: p.id,
    name: p.name,
    github: p.github ?? null,
    avatar: p.avatar ?? null,
    about: intro.about ?? null,
    why: intro.why ?? null,
    seek: intro.seek ?? null,
    share: intro.share ?? null,
    canHelp: intro.canHelp,
    wantHelp: intro.wantHelp,
    rnr: intro.rnr ?? null,
    links: intro.links,
    structured: intro.structured,
    source: intro.url,
  };
}

/** contributions.json 的人員：名稱、帳號、頭像與組織紀錄中的分工（不含自介內容） */
export function publicPerson(p: PersonRecord) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    github: p.github ?? null,
    avatar: p.avatar ?? null,
    hasIntro: p.hasIntro,
    url: p.url ?? null,
    roles: p.roles ?? [],
  };
}
