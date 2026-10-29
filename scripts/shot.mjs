// 截圖工具：讓開發者（與 AI）實際看到畫面。
// 用法：
//   node scripts/shot.mjs <url> <out.png> [--mobile] [--scroll <px|#id>] [--wait <ms>] [--full] [--frames <n> --step <px>]
// 例：
//   node scripts/shot.mjs http://localhost:4321/ /tmp/hero.png
//   node scripts/shot.mjs http://localhost:4321/ /tmp/ch02.png --scroll '#ch-02' --wait 1200
//   node scripts/shot.mjs http://localhost:4321/ /tmp/seq.png --scroll '#ch-03' --frames 4 --step 600
import { chromium } from 'playwright';

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error(
    'usage: node scripts/shot.mjs <url> <out.png> [--mobile] [--scroll <px|#id>] [--wait <ms>] [--full] [--frames n --step px]',
  );
  process.exit(1);
}
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? def : rest[i + 1];
};
const has = (name) => rest.includes(`--${name}`);
const mobile = has('mobile');
const wait = Number(opt('wait', 1500));
const frames = Number(opt('frames', 1));
const step = Number(opt('step', 500));

const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
});
const logs = [];
page.on(
  'console',
  (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${m.type()}] ${m.text()}`),
);
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);

const scroll = opt('scroll', null);
async function scrollTo(y) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  // 讓 Lenis／ScrollTrigger 跟上
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 0);
  await page.waitForTimeout(wait);
}
let y = 0;
if (scroll) {
  y = scroll.startsWith('#')
    ? await page.evaluate(
        (sel) => document.querySelector(sel)?.getBoundingClientRect().top + window.scrollY,
        scroll,
      )
    : Number(scroll);
  await scrollTo(y);
}
if (frames > 1) {
  for (let f = 0; f < frames; f++) {
    const file = out.replace(/\.png$/, `-${f}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    y += step;
    await scrollTo(y);
  }
} else {
  await page.screenshot({ path: out, fullPage: has('full') });
  console.log(out);
}
if (logs.length) console.log(logs.join('\n'));
await browser.close();
