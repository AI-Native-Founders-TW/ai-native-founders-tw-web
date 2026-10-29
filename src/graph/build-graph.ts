/**
 * 建置時（Node）產生內容圖譜。純 TypeScript，不依賴 Astro。
 *
 * 來源：
 *   mono（.cache/mono 或 MONO_PATH）：Members 自介、文件的資訊貢獻者、會議行動表、git 作者
 *   本 repo：git 作者、src/content/credits.yml、src/content/events/*.yaml
 *   GitHub API：只有設定 GITHUB_TOKEN 時，才用來把 git 作者 email 對到帳號
 *
 * 任何一個來源讀不到都只警告；全部失敗時由 index.ts 退回 fixture。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { links } from '../config/links';
import { Identity, type PersonRecord, type PersonSeed } from './identity';
import type { Contribution, ContributionKind, Graph } from './index';
import { type ActionItem, parseActionTable } from './parse/actions';
import { extractContributorSection, parseContributorsFile } from './parse/contributors';
import { type Author, aggregateAuthors, GIT_LOG_FORMAT, parseGitLog } from './parse/git';
import { type ParsedIntro, parseIntro } from './parse/intro';
import { firstH1, normalizeNewlines, stripFrontMatter } from './parse/markdown';

export const MONO_REPO = 'AI-Native-Founders-TW/ai-native-founders-tw-mono';

export interface ContributionRecord extends Contribution {
  labelEn?: string;
  /** 出處：會議行動編號、文件路徑、repo 名稱… */
  source?: string;
  /** 最近一次（ISO） */
  date?: string;
}

export interface DocumentRecord {
  path: string;
  title: string;
  layer: 'problem' | 'principle' | 'mechanism' | 'feature' | 'spec' | 'guide';
  url: string;
  /** person id */
  contributors: string[];
  body: string;
}

export interface IntroRecord extends Omit<ParsedIntro, 'warnings' | 'body' | 'github' | 'name'> {
  person: string;
  file: string;
  url: string;
  body: string;
}

export interface EventRecord {
  id: string;
  status: 'ongoing' | 'upcoming' | 'past';
  title: { 'zh-tw': string; en?: string };
  summary?: { 'zh-tw': string; en?: string };
  where?: { 'zh-tw': string; en?: string };
  region?: string;
  url?: string;
  startsAt?: string;
  endsAt?: string;
  listedAt?: string;
  source?: string;
}

export interface ActionRecord extends ActionItem {
  log: string;
  url: string;
  /** owners 對應的 person id */
  people: { person: string; role: 'owner' | 'collab' }[];
}

export interface RoleRecord {
  label: string;
  source: string;
  detail?: string;
  collab?: boolean;
}

export interface FullGraph extends Graph {
  people: PersonRecord[];
  contributions: ContributionRecord[];
  documents: DocumentRecord[];
  intros: IntroRecord[];
  events: EventRecord[];
  actions: ActionRecord[];
  sources: {
    mono: { path: string; commit: string; date: string } | null;
    web: { commit: string } | null;
    githubApi: boolean;
    fallback: boolean;
  };
  warnings: string[];
}

export interface BuildOptions {
  webRoot?: string;
  monoPath?: string;
  githubToken?: string;
  /** 寫出 .cache/graph.json 方便除錯（預設 true） */
  writeCache?: boolean;
  log?: (msg: string) => void;
}

const monoBlob = (path: string) =>
  `https://github.com/${MONO_REPO}/blob/main/${path.split('/').map(encodeURIComponent).join('/')}`;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
}

function walk(dir: string, filter: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out.sort();
}

const GENERIC_H1 = /^(problem|principle|specs?|note|機制|功能)$/i;

function layerOf(path: string): DocumentRecord['layer'] {
  const b = basename(path);
  if (b.startsWith('[Problem]')) return 'problem';
  if (b.startsWith('[Principle]')) return 'principle';
  if (b.startsWith('[機制]')) return 'mechanism';
  if (b.startsWith('[功能]')) return 'feature';
  if (path.startsWith('Members/')) return 'guide';
  return 'spec';
}

function stemTitle(path: string) {
  return basename(path, '.md').replace(/^\[[^\]]+\]/, '');
}

interface CreditsConfig {
  people?: PersonSeed[];
  website?: {
    roles?: {
      label: string;
      labelEn?: string;
      kind?: ContributionKind;
      people?: string[];
      source?: string;
    }[];
  };
}

/** GitHub API：以 commit sha 查作者帳號（只在有 token 時呼叫；結果快取） */
async function lookupLogins(
  repo: string,
  authors: Author[],
  token: string,
  cacheFile: string,
  warn: (m: string) => void,
): Promise<void> {
  let cache: Record<string, { login: string | null }> = {};
  try {
    if (existsSync(cacheFile)) cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {}
  let dirty = false;
  for (const a of authors) {
    if (a.login) continue;
    const key = a.email || a.name;
    if (key in cache) {
      a.login = cache[key].login ?? undefined;
      continue;
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/commits/${a.sampleSha}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { author?: { login?: string } | null };
      a.login = json.author?.login ?? undefined;
      cache[key] = { login: a.login ?? null };
      dirty = true;
    } catch (e) {
      warn(`GitHub API 查詢 ${a.name} 失敗：${(e as Error).message}`);
      break;
    }
  }
  if (dirty) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    } catch {}
  }
}

function githubSlugFromRemote(cwd: string): string | undefined {
  try {
    const url = git(cwd, ['remote', 'get-url', 'origin']).trim();
    return /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url)?.[1];
  } catch {
    return undefined;
  }
}

export async function buildGraph(opts: BuildOptions = {}): Promise<FullGraph> {
  const webRoot = resolve(opts.webRoot ?? process.cwd());
  const monoPath = resolve(
    opts.monoPath ?? process.env.MONO_PATH ?? join(webRoot, '.cache', 'mono'),
  );
  const token = opts.githubToken ?? process.env.GITHUB_TOKEN;
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    (opts.log ?? ((x: string) => console.warn(`[graph] ${x}`)))(m);
  };

  // ── credits.yml ──────────────────────────────────────────────────────────
  let config: CreditsConfig = {};
  const creditsFile = join(webRoot, 'src', 'content', 'credits.yml');
  try {
    config = (parseYaml(readFileSync(creditsFile, 'utf8')) as CreditsConfig) ?? {};
  } catch (e) {
    warn(`讀不到 credits.yml：${(e as Error).message}`);
  }
  const id = new Identity((config.people ?? []).filter((p) => p?.key && p?.name));
  const contributions: ContributionRecord[] = [];
  const add = (c: ContributionRecord) => contributions.push(c);

  for (const role of config.website?.roles ?? []) {
    for (const key of role.people ?? []) {
      const pid = id.idForKey(key) ?? id.resolve({ name: key }).id;
      add({
        person: pid,
        kind: role.kind ?? 'design',
        target: 'website',
        label: role.label,
        labelEn: role.labelEn,
        source: role.source,
      });
    }
  }

  // ── 本 repo 的 git 作者 → website ─────────────────────────────────────────
  let webCommit: string | null = null;
  try {
    const authors = aggregateAuthors(
      parseGitLog(git(webRoot, ['log', `--format=${GIT_LOG_FORMAT}`])),
    );
    webCommit = git(webRoot, ['rev-parse', '--short', 'HEAD']).trim();
    const slug = githubSlugFromRemote(webRoot);
    if (token && slug)
      await lookupLogins(
        slug,
        authors,
        token,
        join(webRoot, '.cache', 'github-authors.json'),
        warn,
      );
    for (const a of authors) {
      const p = id.resolve({ name: a.name, github: a.login, email: a.email });
      add({
        person: p.id,
        kind: 'code',
        target: 'website',
        label: 'Code',
        labelEn: 'Code',
        count: a.count,
        date: a.last,
        source: 'web',
      });
    }
  } catch (e) {
    warn(`讀不到本 repo 的 git 紀錄：${(e as Error).message}`);
  }

  // ── mono ────────────────────────────────────────────────────────────────
  const documents: DocumentRecord[] = [];
  const intros: IntroRecord[] = [];
  const actions: ActionRecord[] = [];
  const roles = new Map<string, RoleRecord[]>();
  let monoInfo: FullGraph['sources']['mono'] = null;

  if (!existsSync(join(monoPath, 'specs'))) {
    warn(
      `找不到 mono（${monoPath}）。請執行 pnpm sync:mono 或設定 MONO_PATH；組織與社群資料將是空的`,
    );
  } else {
    const rel = (p: string) => relative(monoPath, p).split('\\').join('/');
    const read = (p: string) => normalizeNewlines(readFileSync(p, 'utf8'));

    try {
      const [commit, date] = git(monoPath, ['log', '-1', '--format=%h%x1f%cI'])
        .trim()
        .split('\x1f');
      monoInfo = { path: monoPath, commit, date };
    } catch {
      monoInfo = { path: monoPath, commit: 'unknown', date: '' };
    }

    // 文件與標題（README 表格與「資訊貢獻者.md」中的連結文字優先，例如 vision.md →「願景」）
    const docFiles = [...walk(join(monoPath, 'specs'), (p) => p.endsWith('.md'))];
    const membersGuide = join(monoPath, 'Members', 'README.md');
    if (existsSync(membersGuide)) docFiles.push(membersGuide);
    const linkTitles = new Map<string, string>();
    for (const f of docFiles.filter((p) => /readme\.md$/i.test(p))) {
      for (const m of read(f).matchAll(/\[([^\]]+)\]\(([^)#\s]+\.md)\)/g)) {
        const target = posix.normalize(posix.join(posix.dirname(rel(f)), decodeURIComponent(m[2])));
        if (!linkTitles.has(target)) linkTitles.set(target, m[1].trim());
      }
    }
    const byPath = new Map<string, DocumentRecord>();
    for (const f of docFiles) {
      const path = rel(f);
      const body = stripFrontMatter(read(f));
      const h1 = firstH1(body);
      const title = linkTitles.get(path) ?? (h1 && !GENERIC_H1.test(h1) ? h1 : stemTitle(path));
      const doc: DocumentRecord = {
        path,
        title,
        layer: layerOf(path),
        url: monoBlob(path),
        contributors: [],
        body,
      };
      documents.push(doc);
      byPath.set(path, doc);
    }

    // 資訊貢獻者 → org
    const credit = (doc: DocumentRecord, names: { name: string; aliases: string[] }[]) => {
      for (const n of names) {
        const p = id.resolve({ name: n.name, aliases: n.aliases });
        if (doc.contributors.includes(p.id)) continue;
        doc.contributors.push(p.id);
        add({ person: p.id, kind: 'info', target: 'org', label: doc.title, source: doc.path });
      }
    };
    for (const doc of documents) {
      if (/(^|\/)資訊貢獻者\.md$/.test(doc.path)) {
        const parsed = parseContributorsFile(doc.body);
        const targets = parsed.targets
          .map((t) => byPath.get(posix.normalize(posix.join(posix.dirname(doc.path), t))))
          .filter((d): d is DocumentRecord => Boolean(d));
        if (!parsed.names.length) warn(`${doc.path}：找不到名單`);
        if (!targets.length) warn(`${doc.path}：找不到署名的目標文件，掛在本檔`);
        for (const t of targets.length ? targets : [doc]) credit(t, parsed.names);
        continue;
      }
      const names = extractContributorSection(doc.body);
      if (names === null) continue;
      if (!names.length) warn(`${doc.path}：「資訊貢獻者」段落沒有可辨識的名單`);
      credit(doc, names);
    }

    // 會議行動表 → Person.roles
    for (const f of walk(join(monoPath, 'logs'), (p) =>
      /會議記錄.*\.md$|meeting.*\.md$/i.test(basename(p)),
    )) {
      const log = rel(f);
      for (const item of parseActionTable(read(f))) {
        const people = item.owners.map((o) => ({
          person: id.resolve({ name: o.name }).id,
          role: o.role,
        }));
        actions.push({ ...item, log, url: monoBlob(log), people });
        for (const { person, role } of people) {
          const list = roles.get(person) ?? [];
          list.push({
            label: role === 'collab' ? `${item.title}（協作）` : item.title,
            source: item.id,
            detail: item.action,
            collab: role === 'collab' || undefined,
          });
          roles.set(person, list);
        }
      }
    }

    // Members 自介
    const memberFiles = walk(
      join(monoPath, 'Members'),
      (p) => p.endsWith('.md') && !/^(readme|template|_)/i.test(basename(p)),
    );
    for (const f of memberFiles) {
      const file = rel(f);
      let parsed: ParsedIntro;
      try {
        parsed = parseIntro(read(f), file);
      } catch (e) {
        warn(`${file}：解析失敗（${(e as Error).message}），略過`);
        continue;
      }
      for (const w of parsed.warnings) warn(w);
      const p = id.resolve({ name: parsed.name ?? basename(f, '.md'), github: parsed.github });
      p.hasIntro = true;
      p.about = parsed.about;
      p.canHelp = parsed.canHelp.length ? parsed.canHelp : undefined;
      p.wantHelp = parsed.wantHelp.length ? parsed.wantHelp : undefined;
      const { warnings: _w, github: _g, name: _n, ...fields } = parsed;
      intros.push({ ...fields, person: p.id, file, url: monoBlob(file) });
      add({
        person: p.id,
        kind: 'docs',
        target: 'community',
        label: '自介',
        labelEn: 'Intro',
        source: file,
      });
    }

    // mono 的 git 作者 → community
    try {
      const authors = aggregateAuthors(
        parseGitLog(git(monoPath, ['log', `--format=${GIT_LOG_FORMAT}`])),
      );
      if (token)
        await lookupLogins(
          MONO_REPO,
          authors,
          token,
          join(webRoot, '.cache', 'github-authors.json'),
          warn,
        );
      for (const a of authors) {
        const p = id.resolve({ name: a.name, github: a.login, email: a.email });
        add({
          person: p.id,
          kind: 'docs',
          target: 'community',
          label: 'mono commits',
          labelEn: 'Commits to mono',
          count: a.count,
          date: a.last,
          source: 'mono',
        });
      }
    } catch (e) {
      warn(`讀不到 mono 的 git 紀錄：${(e as Error).message}`);
    }
  }

  // ── 活動 ────────────────────────────────────────────────────────────────
  const events: EventRecord[] = [];
  const eventsDir = join(webRoot, 'src', 'content', 'events');
  for (const f of walk(eventsDir, (p) => /\.ya?ml$/.test(p))) {
    try {
      const e = parseYaml(readFileSync(f, 'utf8')) as EventRecord & { link?: string };
      if (!e?.id || !e?.title?.['zh-tw']) throw new Error('缺少 id 或 title.zh-tw');
      const link =
        e.link && (e.link in links ? (links as Record<string, unknown>)[e.link] : e.link);
      const { link: _l, ...rest } = e;
      events.push({
        ...rest,
        status: e.status ?? 'ongoing',
        listedAt: e.listedAt ? String(e.listedAt).slice(0, 10) : undefined,
        url: typeof link === 'string' ? link : undefined,
      });
    } catch (err) {
      warn(`${relative(webRoot, f)}：${(err as Error).message}`);
    }
  }
  const statusOrder = { ongoing: 0, upcoming: 1, past: 2 } as const;
  events.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      (b.listedAt ?? '').localeCompare(a.listedAt ?? ''),
  );

  // ── 組裝 ────────────────────────────────────────────────────────────────
  const people = [...id.people.values()];
  for (const p of people) {
    const r = roles.get(p.id);
    if (r?.length) p.roles = r;
  }
  // 只保留有出現在任何地方的人（credits.yml 列了但沒有任何貢獻的不輸出）
  const used = new Set([...contributions.map((c) => c.person), ...roles.keys()]);
  const graph: FullGraph = {
    generatedAt: new Date().toISOString(),
    people: people.filter((p) => used.has(p.id) || p.hasIntro),
    contributions,
    documents,
    intros,
    events,
    actions,
    sources: {
      mono: monoInfo,
      web: webCommit ? { commit: webCommit } : null,
      githubApi: Boolean(token),
      fallback: false,
    },
    warnings,
  };

  if (opts.writeCache !== false) {
    try {
      const out = join(webRoot, '.cache', 'graph.json');
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        JSON.stringify(
          { ...graph, documents: graph.documents.map(({ body: _b, ...d }) => d) },
          null,
          2,
        ),
      );
    } catch {}
  }
  return graph;
}
