// 章節 06 的地理資料產生器：準確的台灣輪廓與世界陸地遮罩。
//
// 資料來源：Natural Earth（公有領域），透過 world-atlas@2.0.2 的 TopoJSON 取得：
//   curl -o <dir>/countries-10m.json https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-10m.json
//   curl -o <dir>/land-110m.json https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json
// 用法：
//   node scripts/geo/build-ai-native-geo.mjs <dir>
// 輸出：
//   src/experience/chapters/06-ai-native/taiwan.ts   台灣本島與鄰近島嶼（正規化座標）
//   public/stage/world-land.png                      720×360 等距圓柱陸地遮罩（單通道）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/geo/build-ai-native-geo.mjs <world-atlas-dir>');
  process.exit(1);
}
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

function ringFrom(arcs, indices) {
  const ring = [];
  for (const i of indices) {
    const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
    ring.push(...(ring.length ? a.slice(1) : a));
  }
  return ring;
}

/** Douglas–Peucker；封閉環先切成兩段，避免起點被保留成尖角。 */
function simplifyOpen(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let dist = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > dist) {
        dist = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(ring, tol) {
  const open = ring.slice(0, -1);
  const [x0, y0] = open[0];
  let far = 1;
  let dist = 0;
  open.forEach(([x, y], i) => {
    const d = Math.hypot(x - x0, y - y0);
    if (d > dist) {
      dist = d;
      far = i;
    }
  });
  const a = simplifyOpen(open.slice(0, far + 1), tol);
  const b = simplifyOpen([...open.slice(far), open[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** 拉普拉斯平滑：去掉 1 公里以下的鋸齒，輪廓不變。 */
function relax(ring, passes) {
  let pts = ring.slice(0, -1);
  for (let k = 0; k < passes; k++) {
    pts = pts.map((p, i) => {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[(i + 1) % pts.length];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  return [...pts, pts[0]];
}
/** Chaikin 切角一次：螢幕空間寬度的線在轉角才不會出現尖刺。 */
function chaikin(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    out.push(
      [p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25],
      [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75],
    );
  }
  return out;
}

// ── 台灣 ──
const countries = JSON.parse(readFileSync(join(dir, 'countries-10m.json'), 'utf8'));
const cArcs = decodeArcs(countries);
const taiwan = countries.objects.countries.geometries.find((g) => g.properties?.name === 'Taiwan');
const rings = taiwan.arcs.map((poly) => ringFrom(cArcs, poly[0]));
const lonOf = (r) => r.reduce((s, p) => s + p[0], 0) / r.length;
const main = rings.reduce((a, b) => (a.length > b.length ? a : b));
// 金門在地圖框外，外傘頂洲是沙洲；這張圖只畫本島與澎湖、綠島、蘭嶼
const islets = rings.filter((r) => {
  const lon = lonOf(r);
  return r !== main && lon > 119 && (lon < 119.8 || lon > 121);
});

const lats = main.map((p) => p[1]);
const lons = main.map((p) => p[0]);
const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
const span = Math.max(...lats) - Math.min(...lats);
const kx = Math.cos((lat0 * Math.PI) / 180);
// 等距圓柱配合當地緯度修正：x 向東、y 向南，南北長度 = 1，中心在本島外框中心
const project = ([lon, lat]) => [((lon - lon0) * kx) / span, (lat0 - lat) / span];

const fmt = (ring) => ring.flatMap(project).map((v) => Number(v.toFixed(4)));
const mainOut = fmt(chaikin(simplifyRing(relax(main, 2), 0.0058)));
const isletsOut = islets.map((r) => fmt(chaikin(simplifyRing(relax(r, 1), 0.004))));

const ts = `// 由 scripts/geo/build-ai-native-geo.mjs 產生，來源 Natural Earth 10m（公有領域）。不要手改。
// 座標：x 向東、y 向南；本島南北長度 = 1；中心為本島外框中心。
export const TAIWAN_CENTER = { lat: ${lat0.toFixed(4)}, lon: ${lon0.toFixed(4)} };
/** 本島海岸線：x0, y0, x1, y1, … */
export const TAIWAN_MAIN: number[] = ${JSON.stringify(mainOut)};
/** 澎湖、綠島、蘭嶼 */
export const TAIWAN_ISLETS: number[][] = ${JSON.stringify(isletsOut)};
`;
writeFileSync(join(repo, 'src/experience/chapters/06-ai-native/taiwan.ts'), ts);

// ── 世界陸地遮罩（掃描線 even-odd 填色）──
const landTopo = JSON.parse(readFileSync(join(dir, 'land-110m.json'), 'utf8'));
const lArcs = decodeArcs(landTopo);
const landRings = [];
for (const g of landTopo.objects.land.geometries) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  for (const poly of polys) for (const ring of poly) landRings.push(ringFrom(lArcs, ring));
}
const W = 720;
const H = 360;
const pixels = Buffer.alloc((W + 1) * H);
for (let row = 0; row < H; row++) {
  const lat = 90 - (row + 0.5) / 2;
  const cross = [];
  for (const ring of landRings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      if (y0 <= lat === y1 <= lat) continue;
      cross.push(x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0));
    }
  }
  cross.sort((a, b) => a - b);
  const line = (W + 1) * row;
  pixels[line] = 0; // PNG filter: none
  for (let i = 0; i + 1 < cross.length; i += 2) {
    const a = Math.max(0, Math.round((cross[i] + 180) * 2));
    const b = Math.min(W, Math.round((cross[i + 1] + 180) * 2));
    for (let x = a; x < b; x++) pixels[line + 1 + x] = 255;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 0; // grayscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(join(repo, 'public/stage/world-land.png'), png);
console.log(
  `taiwan main ${mainOut.length / 2} pts, islets ${isletsOut.map((r) => r.length / 2).join('/')}; world-land.png ${(png.length / 1024).toFixed(1)} KB`,
);
