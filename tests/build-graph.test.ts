import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph/build-graph';

const root = resolve(__dirname, '..');
const mono = process.env.MONO_PATH ?? join(root, '.cache', 'mono');
const quiet = { writeCache: false, githubToken: '', log: () => {} };

describe('buildGraph', () => {
  it('找不到 mono 時不丟例外，只警告；網站的 credits 仍在', async () => {
    const g = await buildGraph({
      ...quiet,
      webRoot: root,
      monoPath: mkdtempSync(join(tmpdir(), 'no-mono-')),
    });
    expect(g.sources.mono).toBeNull();
    expect(g.warnings.some((w) => w.includes('找不到 mono'))).toBe(true);
    expect(g.contributions.some((c) => c.target === 'website' && c.label === 'Owner')).toBe(true);
    expect(g.intros).toEqual([]);
  });

  it.skipIf(!existsSync(join(mono, 'specs')))('真實 mono：別名合併、文件署名、行動表', async () => {
    const g = await buildGraph({ ...quiet, webRoot: root, monoPath: mono });
    const byName = (n: string) => g.people.find((p) => p.name === n);

    // 「Ray（Ray貓）」「Ray」「Ray 貓」合併成同一人，且同時有 website 與 org 貢獻
    const ray = byName('Ray 貓');
    expect(ray).toBeDefined();
    expect(g.people.filter((p) => /^ray/i.test(p.name))).toHaveLength(1);
    const rayTargets = new Set(
      g.contributions.filter((c) => c.person === ray?.id).map((c) => c.target),
    );
    expect(rayTargets.has('website')).toBe(true);
    expect(rayTargets.has('org')).toBe(true);
    expect(ray?.roles?.some((r) => r.source === 'A5')).toBe(true);

    // Yapi → yayapipi、有平（Chris）→ 有平、kun → Kun
    expect(byName('Yapi')).toBeUndefined();
    expect(byName('yayapipi')).toBeDefined();
    expect(byName('Chris')).toBeUndefined();
    expect(byName('kun')).toBeUndefined();

    // 資訊貢獻者.md 的署名掛在 vision.md
    const vision = g.documents.find((d) => d.path.endsWith('vision.md'));
    expect(vision?.contributors.length).toBeGreaterThanOrEqual(8);

    // 文案協作（品毅）來自 credits.yml，A13 來自行動表
    const pinyi = byName('品毅');
    expect(g.contributions.some((c) => c.person === pinyi?.id && c.kind === 'copy')).toBe(true);
    expect(pinyi?.roles?.some((r) => r.source === 'A13')).toBe(true);

    // 活動
    expect(g.events[0]?.url).toMatch(/^https:\/\/discord\.com\//);
    // 沒有自介時是空陣列，不是錯誤
    expect(Array.isArray(g.intros)).toBe(true);
    expect(g.people.filter((p) => p.hasIntro)).toHaveLength(g.intros.length);
  });
});
