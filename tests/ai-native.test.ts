import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  at,
  field,
  inIsland,
  making,
  organization,
  product,
  spiral,
  threadPath,
} from '../src/experience/chapters/06-ai-native/layers';
import {
  anchorsOf,
  camAt,
  type Layout,
  layoutOf,
  stateAt,
  storyTime,
} from '../src/experience/chapters/06-ai-native/story';
import { TAIWAN_CENTER, TAIWAN_MAIN } from '../src/experience/chapters/06-ai-native/taiwan';

const spans = [
  { a: 0, b: 1350 },
  { a: 2106, b: 2754 },
  { a: 3510, b: 4158 },
  { a: 4914, b: 5562 },
  { a: 6318, b: 7182 },
  { a: 7938, b: 8874 },
];
const anchors = anchorsOf(spans);

/** 把經緯度換到輪廓的座標系，用實際地點驗證輪廓不是隨手畫的多邊形。 */
function project(lat: number, lon: number): [number, number] {
  const ys = TAIWAN_MAIN.filter((_, i) => i % 2 === 1);
  const north = Math.min(...ys);
  const south = Math.max(...ys);
  const span = 25.2978 - 21.8969; // 本島南北極點的緯度差
  const scale = (south - north) / span;
  const k = Math.cos((TAIWAN_CENTER.lat * Math.PI) / 180);
  return [(lon - TAIWAN_CENTER.lon) * k * scale, (TAIWAN_CENTER.lat - lat) * scale];
}

describe('台灣輪廓', () => {
  it('南北長度正規化為 1，東西比例符合實際地理', () => {
    const xs = TAIWAN_MAIN.filter((_, i) => i % 2 === 0);
    const ys = TAIWAN_MAIN.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 1);
    const ratio = Math.max(...xs) - Math.min(...xs);
    expect(ratio).toBeGreaterThan(0.48);
    expect(ratio).toBeLessThan(0.56);
  });

  it('實際城市落在島內，海上的點落在島外', () => {
    const inside: [number, number][] = [
      [25.03, 121.52], // 台北
      [24.15, 120.67], // 台中
      [22.75, 120.4], // 高雄內陸
      [23.98, 121.58], // 花蓮
    ];
    for (const [lat, lon] of inside) {
      const [x, y] = project(lat, lon);
      expect(inIsland(x, y)).toBe(true);
    }
    const outside: [number, number][] = [
      [23.5, 119.6], // 澎湖海域
      [23.0, 122.2], // 太平洋
      [25.0, 120.3], // 台灣海峽
    ];
    for (const [lat, lon] of outside) {
      const [x, y] = project(lat, lon);
      expect(inIsland(x, y)).toBe(false);
    }
  });
});

describe('故事時間', () => {
  it('錨點對到整數 T，往下捲只會前進', () => {
    anchors.forEach((y, i) => {
      expect(storyTime(y, anchors, 900)).toBeCloseTo(i, 5);
    });
    let last = Number.NEGATIVE_INFINITY;
    for (let y = -1800; y < 11000; y += 37) {
      const t = storyTime(y, anchors, 900);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });

  it('反向捲回同一個位置，得到同一個畫面', () => {
    for (const y of [120, 2300, 5000, 6700, 8200]) {
      const t = storyTime(y, anchors, 900);
      expect(stateAt(t)).toEqual(stateAt(storyTime(y, anchors, 900)));
      expect(camAt(t, 'side')).toEqual(camAt(storyTime(y, anchors, 900), 'side'));
    }
  });

  it('文字沒有停留區間時不會除以零', () => {
    const flat = anchorsOf([
      { a: 0, b: 0 },
      { a: 100, b: 100 },
    ]);
    for (let y = -200; y < 400; y += 11) {
      expect(Number.isFinite(storyTime(y, flat, 800))).toBe(true);
    }
  });

  it('鏡頭在任何相鄰時刻都不會跳動', () => {
    for (const layout of ['side', 'stack'] as Layout[]) {
      const step = 0.01;
      for (let t = -1; t < 11; t += step) {
        const a = camAt(t, layout);
        const b = camAt(t + step, layout);
        expect(Math.abs(b.dist - a.dist)).toBeLessThan(0.1);
        expect(Math.abs(b.elev - a.elev)).toBeLessThan(0.7);
        expect(Math.abs(b.az - a.az)).toBeLessThan(0.7);
        expect(Math.abs(b.ty - a.ty)).toBeLessThan(0.05);
      }
    }
  });
});

describe('三層的份量', () => {
  it('每一層聚焦時是最亮的，其餘兩層仍可辨識', () => {
    [2.5, 4.5, 6.5].forEach((t, i) => {
      const { focus } = stateAt(t);
      expect(focus[i]).toBeGreaterThan(0.9);
      focus.forEach((f, k) => {
        if (k !== i) {
          expect(f).toBeLessThan(focus[i]);
          expect(f).toBeGreaterThan(0.35);
        }
      });
    });
  });

  it('貫穿時三層亮度相同，三層不合併', () => {
    const { focus, sep } = stateAt(8.5);
    expect(new Set(focus.map((f) => f.toFixed(3))).size).toBe(1);
    expect(sep).toBeGreaterThan(1);
    expect(stateAt(11).sep).toBeGreaterThan(0.5);
  });

  it('收尾時世界與島內連線都走到完整狀態', () => {
    const end = stateAt(11);
    expect(end.world).toBe(1);
    expect(end.arcs).toBe(1);
    expect(end.net).toBe(1);
    expect(end.netAlpha).toBeGreaterThan(0.9);
  });

  it('開場只有一層，其餘兩層在分層後才出現', () => {
    const open = stateAt(0.8);
    expect(open.peel).toBe(0);
    expect(open.focus[1]).toBe(0);
    expect(open.focus[2]).toBe(0);
  });
});

describe('版面與路徑', () => {
  it('三層的節點都落在島內', () => {
    for (const g of [organization(), product(), making()]) {
      for (const n of g.nodes) expect(inIsland(n.p[0], n.p[1])).toBe(true);
    }
    for (const p of field(90).points) expect(inIsland(p[0], p[1])).toBe(true);
    for (let t = 0; t <= 1; t += 0.05) {
      const p = spiral(t);
      expect(inIsland(p[0], p[1])).toBe(true);
    }
    expect(inIsland(...at(0, 0))).toBe(true);
  });

  it('光線依序走過三層，途中不跳層', () => {
    const { pts, hits } = threadPath(3.5, 300);
    expect(hits[0].at).toBeLessThan(hits[1].at);
    expect(hits[1].at).toBeLessThan(hits[2].at);
    let top = 0;
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i][3] - pts[i - 1][3])).toBeLessThan(0.05);
      top = Math.max(top, pts[i][3]);
    }
    expect(top).toBeCloseTo(2, 1);
  });

  it('版面判斷與 CSS 的斷點一致', () => {
    expect(layoutOf(1440, 900)).toBe('side');
    expect(layoutOf(1024, 768)).toBe('side');
    expect(layoutOf(900, 900)).toBe('stack');
    expect(layoutOf(768, 1024)).toBe('stack');
    expect(layoutOf(390, 844)).toBe('stack');
  });
});

describe('文案結構', () => {
  const read = (f: string) =>
    parse(readFileSync(join(process.cwd(), 'src/content/copy', f), 'utf8')).aiNative;
  const zh = read('zh-tw.yaml');
  const en = read('en.yaml');

  it('英文與中文的欄位一致，不會混出兩種場景', () => {
    expect(en.layers).toHaveLength(zh.layers.length);
    zh.layers.forEach(
      (l: { link?: string; tags: { hub?: string; items: string[] } }, i: number) => {
        expect(Boolean(en.layers[i].link)).toBe(Boolean(l.link));
        expect(Boolean(en.layers[i].tags.hub)).toBe(Boolean(l.tags.hub));
        expect(en.layers[i].tags.items).toHaveLength(l.tags.items.length);
      },
    );
    expect(en.close.outcomes).toHaveLength(zh.close.outcomes.length);
  });

  it('圖上的小字數量對得上畫面的錨點', () => {
    const graphs = [organization(), product(), making()];
    zh.layers.forEach((l: { tags: { hub?: string; items: string[] } }, i: number) => {
      const need = l.tags.items.length + (l.tags.hub ? 1 : 0);
      expect(graphs[i].labels).toHaveLength(need);
    });
  });

  it('找人終端機的欄位已經退出本區', () => {
    for (const copy of [zh, en]) {
      expect(copy.terminal).toBeUndefined();
      expect(copy.prompt).toBeUndefined();
      expect(copy.points).toBeUndefined();
    }
  });
});
