// 給 AI 的站點摘要（https://llmstxt.org）。全文見 /llms-full.txt。
import type { APIRoute } from 'astro';
import { links } from '../config/links';
import { getFullGraph } from '../graph';
import { text } from '../graph/public';

export const GET: APIRoute = async ({ site }) => {
  const g = await getFullGraph();
  const abs = (p: string) => new URL(p, site).href;
  const doc = (path: string) => g.documents.find((d) => d.path === path);
  const docLine = (path: string, fallbackTitle: string, desc: string) =>
    `- [${doc(path)?.title ?? fallbackTitle}](${doc(path)?.url ?? links.mono}): ${desc}`;
  const withIntro = g.people.filter((p) => p.hasIntro);

  const out = [
    '# AI-Native Global Founders Speedrun Taiwan',
    '',
    '> 用一份筆記槓桿全台創業者的認知。A non-profit, open-source community of Taiwanese founders: we collect what experienced founders know, and turn one conversation into open notes.',
    '',
    'Key facts (the organization repo is the single source of truth):',
    '',
    '- Non-profit (constitution article 2). No paid placement and no promoting any company (article 7). Notes are non-commercial (article 9). Joining is free: the only step is a self-intro pull request.',
    '- The only way to join is to submit a self-introduction ("自介") as a pull request to `Members/` in the mono repo. Membership starts once the intro passes review. Background, track record and experience are not requirements (article 11).',
    '- Discord is where people talk; it is an invitation, not a requirement.',
    '- Who reviews intros and how long it takes has not been decided yet.',
    "- Intros list each person's R&R: what they can help with and what they want to help with. That is a stated willingness, not a commitment.",
    '- Ideas marked "Note" in the repo (matching, introductions, mentors, batches, etc.) are not adopted services.',
    '',
    '## Organization documents',
    '',
    docLine(
      'specs/00-願景和問題/創辦人的話.md',
      '創辦人的話',
      "Founder's letter (why this exists).",
    ),
    docLine('specs/00-願景和問題/vision.md', '願景', 'Vision and the problems we want to solve.'),
    docLine('specs/01-制度/constitution.md', '憲法', 'Constitution.'),
    docLine(
      'specs/01-制度/[機制]申請制度.md',
      '申請制度',
      'How to apply (intro PR) and how membership works.',
    ),
    docLine(
      'Members/README.md',
      '自我介紹與 PR 提交說明',
      'Intro template and step-by-step PR guide.',
    ),
    `- [GitHub repo](${links.mono}): specs, plans, meeting logs and member intros.`,
    '',
    '## Website',
    '',
    `- [Home](${abs('/')}) · [English](${abs('/en/')})`,
    `- [Join](${abs('/join')}): four steps, FAQ and an intro generator that opens a GitHub PR (nothing is sent anywhere else).`,
    `- [Credits](${abs('/credits')}): website, organization-document and community contributors.`,
    '',
    '## Data (JSON, CORS enabled, version 1)',
    '',
    `- [people.json](${abs('/api/v1/people.json')}): public fields of merged intros (${withIntro.length} so far).`,
    `- [contributions.json](${abs('/api/v1/contributions.json')}): who contributed what, from git history, document credits and credits.yml.`,
    `- [documents.json](${abs('/api/v1/documents.json')}): index of organization documents.`,
    `- [events.json](${abs('/api/v1/events.json')}): current events.`,
    '',
    '## Current events',
    '',
    ...(g.events.length
      ? g.events.map(
          (e) =>
            `- ${e.title['zh-tw']}${e.title.en ? ` / ${e.title.en}` : ''}${e.url ? `: ${e.url}` : ''}`,
        )
      : ['- None listed.']),
    '',
    '## Optional',
    '',
    `- [llms-full.txt](${abs('/llms-full.txt')}): full text of the key documents, every intro and the credits.`,
    `- [Discord](${links.discord})`,
    '',
  ];
  return text(out.join('\n'));
};
