/**
 * 身分合併：把「Ray」「Ray貓」「Ray 貓」、git 作者、GitHub 帳號對到同一個 Person。
 * 規則來源是 src/content/credits.yml 的 people（別名、已知帳號）；對不到的就新建，不猜。
 */
import type { Person } from './index';

export interface PersonSeed {
  key: string;
  name: string;
  aliases?: string[];
  github?: string | null;
  /** git commit 用的 email（本人確認後才填），用來把 git 作者合併進來 */
  emails?: string[];
  kind?: 'person' | 'tool';
  url?: string;
}

export interface PersonRecord extends Person {
  aliases: string[];
  kind: 'person' | 'tool';
  url?: string;
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_.·・（）()「」"'`]/g, '');
}

function slug(s: string): string {
  const t = s
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
  return t || 'unknown';
}

export const avatarFor = (login: string) =>
  `https://github.com/${encodeURIComponent(login)}.png?size=160`;

export interface Hint {
  name?: string;
  aliases?: string[];
  github?: string;
  email?: string;
}

export class Identity {
  readonly people = new Map<string, PersonRecord>();
  private byKey = new Map<string, string>();
  private byName = new Map<string, string>();
  private byGithub = new Map<string, string>();
  private byEmail = new Map<string, string>();

  constructor(seeds: PersonSeed[] = []) {
    for (const s of seeds) {
      const github = s.github?.trim() || undefined;
      const kind = s.kind ?? 'person';
      const id = github ?? `${kind === 'tool' ? 'tool' : 'name'}:${s.key}`;
      const rec: PersonRecord = {
        id,
        name: s.name,
        github,
        avatar: github ? avatarFor(github) : undefined,
        hasIntro: false,
        aliases: [...new Set([s.name, ...(s.aliases ?? [])])],
        kind,
        url: s.url,
      };
      this.people.set(id, rec);
      this.byKey.set(s.key, id);
      for (const a of rec.aliases) this.byName.set(normalizeName(a), id);
      this.byName.set(normalizeName(s.key), id);
      if (github) this.byGithub.set(github.toLowerCase(), id);
      for (const e of s.emails ?? []) this.byEmail.set(e.trim().toLowerCase(), id);
    }
  }

  /** credits.yml 的 key → person id */
  idForKey(key: string): string | undefined {
    return this.byKey.get(key);
  }

  find(h: Hint): PersonRecord | undefined {
    const id =
      (h.github && this.byGithub.get(h.github.toLowerCase())) ||
      (h.email && this.byEmail.get(h.email.toLowerCase())) ||
      (h.name && this.byName.get(normalizeName(h.name))) ||
      h.aliases?.map((a) => this.byName.get(normalizeName(a))).find(Boolean);
    return id ? this.people.get(id) : undefined;
  }

  /** 找到就合併新資訊（GitHub 帳號、別名），找不到就新建 */
  resolve(h: Hint): PersonRecord {
    const found = this.find(h);
    if (found) {
      if (h.github && !found.github) this.attachGithub(found, h.github);
      for (const a of [h.name, ...(h.aliases ?? [])]) {
        if (!a) continue;
        if (!found.aliases.includes(a)) found.aliases.push(a);
        if (!this.byName.has(normalizeName(a))) this.byName.set(normalizeName(a), found.id);
      }
      if (h.email && !this.byEmail.has(h.email)) this.byEmail.set(h.email.toLowerCase(), found.id);
      return found;
    }
    const name = h.name?.trim() || h.github || 'Unknown';
    let id = h.github ?? `name:${slug(name)}`;
    for (let i = 2; this.people.has(id); i++) id = `name:${slug(name)}-${i}`;
    const rec: PersonRecord = {
      id,
      name,
      github: h.github,
      avatar: h.github ? avatarFor(h.github) : undefined,
      hasIntro: false,
      aliases: [...new Set([name, ...(h.aliases ?? [])])],
      kind: 'person',
    };
    this.people.set(id, rec);
    for (const a of rec.aliases)
      if (!this.byName.has(normalizeName(a))) this.byName.set(normalizeName(a), id);
    if (h.github) this.byGithub.set(h.github.toLowerCase(), id);
    if (h.email) this.byEmail.set(h.email.toLowerCase(), id);
    return rec;
  }

  /**
   * 補上 GitHub 帳號。為了不讓其他資料的引用失效，id 不改（仍是 `name:*`）；
   * 等 credits.yml 填入帳號後，下一次建置 id 自然會是帳號。
   */
  private attachGithub(rec: PersonRecord, github: string) {
    rec.github = github;
    rec.avatar ??= avatarFor(github);
    this.byGithub.set(github.toLowerCase(), rec.id);
  }
}
