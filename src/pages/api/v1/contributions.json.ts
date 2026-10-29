// 貢獻彙整：網站製作（git＋credits.yml）、組織文件資訊貢獻者（mono）、社群（mono git、自介）。
import type { APIRoute } from 'astro';
import { getFullGraph } from '../../../graph';
import { json, meta, publicPerson } from '../../../graph/public';

export const GET: APIRoute = async ({ site }) => {
  const g = await getFullGraph();
  return json({
    ...meta(g, site),
    note: 'roles 來自 mono 會議記錄的行動表（組織紀錄中的分工），不是本人的自介。',
    people: g.people.map(publicPerson),
    contributions: g.contributions.map((c) => ({
      person: c.person,
      target: c.target,
      kind: c.kind,
      label: c.label,
      labelEn: c.labelEn ?? null,
      count: c.count ?? null,
      date: c.date ?? null,
      source: c.source ?? null,
    })),
    documents: g.documents
      .filter((d) => d.contributors.length)
      .map((d) => ({ path: d.path, title: d.title, url: d.url, contributors: d.contributors })),
  });
};
