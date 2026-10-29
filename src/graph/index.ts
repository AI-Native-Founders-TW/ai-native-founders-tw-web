/**
 * 內容圖譜的公開介面（合約）。章節與頁面只從這裡取資料。
 *
 * 資料由 build-graph.ts 在建置時（Node）以 mono（pnpm sync:mono 或 MONO_PATH）、
 * src/content/credits.yml、git 紀錄與（有 GITHUB_TOKEN 時）GitHub API 產生，並在程序內快取。
 * 讀不到資料時退回 fixture.ts 並警告，建置不會失敗。
 *
 * 以下型別與 getGraph／getPeople／getCreditGroups 的簽名是合約，不要更動；需要更多資料請用 getFullGraph()。
 */
import type { FullGraph } from './build-graph';
import { fixture } from './fixture';

export type {
  ActionRecord,
  ContributionRecord,
  DocumentRecord,
  EventRecord,
  FullGraph,
  IntroRecord,
  RoleRecord,
} from './build-graph';
export type { PersonRecord } from './identity';

export type ContributionKind = 'code' | 'docs' | 'design' | 'copy' | 'info' | 'lead' | 'tool';

export interface Person {
  /** 主鍵：GitHub 帳號；沒有時用 slug（例如 `name:sun`） */
  id: string;
  github?: string;
  name: string;
  avatar?: string;
  /** 自介（Members/*.md）是否已合併進 mono main */
  hasIntro: boolean;
  about?: string;
  canHelp?: string[];
  wantHelp?: string[];
  /** 不是自介、而是組織紀錄中的分工（例如會議行動表），用於 AI-Native 示範 */
  roles?: { label: string; source: string }[];
}

export interface Contribution {
  person: string;
  kind: ContributionKind;
  target: 'website' | 'org' | 'community';
  label: string;
  count?: number;
}

export interface CreditGroup {
  key: 'website' | 'org' | 'community';
  title: string;
  people: { person: Person; labels: string[] }[];
}

export interface Graph {
  generatedAt: string;
  people: Person[];
  contributions: Contribution[];
}

function fromFixture(warnings: string[] = []): FullGraph {
  return {
    ...fixture,
    people: fixture.people.map((p) => ({ ...p, aliases: [p.name], kind: 'person' as const })),
    documents: [],
    intros: [],
    events: [],
    actions: [],
    sources: { mono: null, web: null, githubApi: false, fallback: true },
    warnings,
  };
}

let cached: { at: number; graph: Promise<FullGraph> } | undefined;
// dev server 下每 60 秒重建一次（pnpm sync:mono 之後不用重開）；建置時只建一次
const TTL = import.meta.env?.DEV ? 60_000 : Number.POSITIVE_INFINITY;

async function load(): Promise<FullGraph> {
  // 瀏覽器端（island 誤用時）不能跑 git／fs
  if (typeof window !== 'undefined') return fromFixture(['graph 只能在建置時使用']);
  try {
    const { buildGraph } = await import('./build-graph');
    const g = await buildGraph();
    if (!g.people.length) {
      console.warn('[graph] 沒有任何人員資料，退回 fixture');
      return fromFixture(g.warnings);
    }
    return g;
  } catch (e) {
    console.warn(`[graph] 建置失敗，退回 fixture：${(e as Error)?.stack ?? e}`);
    return fromFixture([String((e as Error)?.message ?? e)]);
  }
}

/** 完整圖譜（含文件、自介全文、活動、行動表、來源資訊）。 */
export function getFullGraph(): Promise<FullGraph> {
  if (!cached || Date.now() - cached.at > TTL) cached = { at: Date.now(), graph: load() };
  return cached.graph;
}

export async function getGraph(): Promise<Graph> {
  return getFullGraph();
}

export async function getPeople(): Promise<Person[]> {
  return (await getGraph()).people;
}

const KIND_ORDER: ContributionKind[] = ['lead', 'design', 'copy', 'code', 'info', 'docs', 'tool'];

export async function getCreditGroups(): Promise<CreditGroup[]> {
  const g = await getGraph();
  const byId = new Map(g.people.map((p) => [p.id, p]));
  const groups: CreditGroup[] = (['website', 'org', 'community'] as const).map((key) => ({
    key,
    title: key,
    people: [],
  }));
  const rank = new Map<string, number>();
  for (const c of g.contributions) {
    const group = groups.find((x) => x.key === c.target);
    const person = byId.get(c.person);
    if (!group || !person) continue;
    const k = `${c.target}:${person.id}`;
    rank.set(k, Math.min(rank.get(k) ?? 99, KIND_ORDER.indexOf(c.kind)));
    const entry = group.people.find((e) => e.person.id === person.id);
    if (entry) {
      if (!entry.labels.includes(c.label)) entry.labels.push(c.label);
    } else group.people.push({ person, labels: [c.label] });
  }
  // 依角色（Owner、Collab、設計、文案、程式…）排序，同層維持出現順序
  for (const group of groups) {
    group.people = group.people
      .map((e, i) => ({ e, i, r: rank.get(`${group.key}:${e.person.id}`) ?? 99 }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.e);
  }
  return groups;
}
