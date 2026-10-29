// 給 AI 的全文：組織的核心文件（原文取自 mono）、所有自介、貢獻者、活動。
// 用法：整份貼給 AI，問「誰可能可以幫忙 X？」——答案只是依自介的意願整理，不代表對方已答應。
import type { APIRoute } from 'astro';
import { getFullGraph } from '../graph';
import { text } from '../graph/public';

const CORE = [
  'specs/00-願景和問題/創辦人的話.md',
  'specs/00-願景和問題/vision.md',
  'specs/00-願景和問題/資訊貢獻者.md',
  'specs/01-制度/constitution.md',
  'specs/01-制度/[機制]申請制度.md',
  'specs/01-制度/[機制]自介審查.md',
  'specs/01-制度/[機制]成員參與制度.md',
  'specs/01-制度/[機制]基本參與度.md',
  'specs/02-工作流/[機制]志工協作與開源知識.md',
  'Members/README.md',
];

export const GET: APIRoute = async ({ site }) => {
  const g = await getFullGraph();
  const byId = new Map(g.people.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const docs = [
    ...CORE.map((p) => g.documents.find((d) => d.path === p)).filter((d) => d !== undefined),
    ...g.documents.filter((d) => !CORE.includes(d.path) && !/README\.md$/.test(d.path)),
  ];

  const parts: string[] = [
    '# AI-Native Global Founders Speedrun Taiwan — full text',
    '',
    `> Generated ${g.generatedAt} from ${g.sources.mono ? `mono@${g.sources.mono.commit}` : 'fallback data (mono unavailable)'}. Site: ${site?.origin ?? ''}`,
    '> The mono repo is the single source of truth: https://github.com/AI-Native-Founders-TW/ai-native-founders-tw-mono',
    '> Sections titled "Note" contain ideas that are NOT adopted; do not describe them as services the organization provides.',
    '> R&R in intros is a stated willingness, not a commitment. Anyone found here still decides for themselves whether to take part.',
    '',
  ];

  parts.push('## 自介 / Intros', '');
  if (!g.intros.length) parts.push('目前還沒有已合併的自介。No intros have been merged yet.', '');
  for (const i of g.intros) {
    const p = byId.get(i.person);
    parts.push(
      `### ${p?.name ?? i.person}${p?.github ? ` (@${p.github})` : ''}`,
      '',
      `Source: ${i.url}`,
      '',
      i.body.replace(/^#\s.*\n?/, '').trim(),
      '',
    );
  }

  parts.push('## 貢獻者 / Credits', '');
  for (const target of ['website', 'org', 'community'] as const) {
    const cs = g.contributions.filter((c) => c.target === target);
    if (!cs.length) continue;
    const per = new Map<string, string[]>();
    for (const c of cs)
      per.set(c.person, [
        ...(per.get(c.person) ?? []),
        c.count ? `${c.label} ×${c.count}` : c.label,
      ]);
    parts.push(
      `### ${target}`,
      '',
      ...[...per].map(([id, ls]) => `- ${name(id)}: ${[...new Set(ls)].join('、')}`),
      '',
    );
  }

  if (g.actions.length) {
    parts.push('## 會議行動表 / Action items (organization record, not self-introductions)', '');
    for (const a of g.actions) {
      const who = a.everyone
        ? '全員'
        : a.people
            .map((x) => `${name(x.person)}${x.role === 'collab' ? '（協作）' : ''}`)
            .join('、');
      parts.push(`- ${a.id} ${a.title}: ${a.action} — ${who} (${a.log})`);
    }
    parts.push('');
  }

  if (g.events.length) {
    parts.push('## 活動 / Events', '');
    for (const e of g.events)
      parts.push(
        `- [${e.status}] ${e.title['zh-tw']} — ${e.summary?.['zh-tw'] ?? ''} ${e.url ?? ''}`.trim(),
      );
    parts.push('');
  }

  parts.push('## 組織文件 / Documents', '');
  for (const d of docs) {
    parts.push(`---`, '', `<!-- ${d.path} · ${d.url} -->`, '', d.body.trim(), '');
  }
  return text(parts.join('\n'));
};
