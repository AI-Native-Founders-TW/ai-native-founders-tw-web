// 組織文件索引（mono specs 與自介說明）。內文以 mono 為準，這裡只放索引。
import type { APIRoute } from 'astro';
import { getFullGraph } from '../../../graph';
import { json, meta } from '../../../graph/public';

export const GET: APIRoute = async ({ site }) => {
  const g = await getFullGraph();
  return json({
    ...meta(g, site),
    documents: g.documents.map((d) => ({
      path: d.path,
      title: d.title,
      layer: d.layer,
      url: d.url,
      contributors: d.contributors,
    })),
  });
};
