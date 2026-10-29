import type { APIRoute } from 'astro';

// 新增頁面時加在這裡（zh 路徑；英文版自動加上 /en）
const PAGES = ['/', '/join', '/credits'];

export const GET: APIRoute = ({ site }) => {
  const abs = (p: string) => new URL(p, site).href;
  const en = (p: string) => (p === '/' ? '/en/' : `/en${p}`);
  const today = new Date().toISOString().slice(0, 10);
  const entry = (loc: string, zh: string) => `  <url>
    <loc>${abs(loc)}</loc>
    <lastmod>${today}</lastmod>
    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="${abs(zh)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${abs(en(zh))}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(zh)}"/>
  </url>`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${PAGES.flatMap((p) => [entry(p, p), entry(en(p), p)]).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
