// 活動（src/content/events/*.yaml）。
import type { APIRoute } from 'astro';
import { getFullGraph } from '../../../graph';
import { json, meta } from '../../../graph/public';

export const GET: APIRoute = async ({ site }) => {
  const g = await getFullGraph();
  return json({ ...meta(g, site), events: g.events });
};
