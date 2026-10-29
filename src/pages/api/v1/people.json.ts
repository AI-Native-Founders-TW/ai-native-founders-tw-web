// 有自介者的公開欄位（自介裡本人寫的內容）。自介格式自由，對不到欄位時 structured=false、全文在 about。
import type { APIRoute } from 'astro';
import { getFullGraph } from '../../../graph';
import { json, meta, publicIntro } from '../../../graph/public';

export const GET: APIRoute = async ({ site }) => {
  const g = await getFullGraph();
  const byId = new Map(g.people.map((p) => [p.id, p]));
  const people = g.intros.flatMap((i) => {
    const p = byId.get(i.person);
    return p ? [publicIntro(p, i)] : [];
  });
  return json({
    ...meta(g, site),
    note: '自介（Members/*.md 已合併進 mono main）。R&R 是本人表達的意願，不代表已承諾任何工作。',
    count: people.length,
    people,
  });
};
