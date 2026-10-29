#!/usr/bin/env node
// Seedance 影片生成（透過 fal 佇列 API）。預設只做 dry-run：列出每個鏡頭的 prompt 與預估花費，不呼叫任何 API。
//
// 用法：
//   node scripts/media/seedance.mjs                       # dry-run：全部鏡頭，各 1 次
//   node scripts/media/seedance.mjs --only voyage-2-pacific --takes 3
//   node scripts/media/seedance.mjs --run --only hero-loop --takes 2      # 真的呼叫（會花錢）
//   node scripts/media/seedance.mjs --run --only voyage-2-pacific --image-url https://…/last.png
//   node scripts/media/seedance.mjs --last-frame media-work/raw/voyage-1-taipei-night/xxx.mp4   # 抽出最後一格（不呼叫 API）
//   node scripts/media/seedance.mjs --ledger              # 看目前花費
//
// 環境變數（見 scripts/media/README.md）：
//   FAL_KEY               fal 的 API key（只在 --run 時需要）
//   SEEDANCE_MODEL        fal 上 Seedance 模型的 endpoint id（到 fal 模型頁複製，不要猜）
//   MEDIA_PRICE_PER_SEC   該模型／解析度每秒成品的美元價格（--run 時必填；dry-run 未設定時用 0.10–1.10 的區間估算）
//   MEDIA_BUDGET_USD      總預算上限，預設 50；ledger 累計＋本次預估超過就拒絕
//   SEEDANCE_EXTRA_INPUT  （選填）JSON，合併進每次請求的 input（不同模型的欄位名稱不同時用）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORK = join(ROOT, 'media-work');
const LEDGER = join(WORK, 'ledger.json');
const PROMPTS = join(ROOT, 'scripts/media/prompts.json');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

const RUN = flag('run') && !flag('dry-run');
const env = process.env;
const budget = Number(env.MEDIA_BUDGET_USD ?? 50);
const price = env.MEDIA_PRICE_PER_SEC ? Number(env.MEDIA_PRICE_PER_SEC) : null;
const usd = (n) => `$${n.toFixed(2)}`;

function loadLedger() {
  if (!existsSync(LEDGER)) return { currency: 'USD', entries: [] };
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}
function saveLedger(l) {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
}
/** 已花費（含送出但尚未確認失敗的請求，保守計算） */
const spent = (l) =>
  l.entries.filter((e) => e.status !== 'failed').reduce((s, e) => s + (e.costUsd ?? 0), 0);

// ── --ledger ──
if (flag('ledger')) {
  const l = loadLedger();
  for (const e of l.entries)
    console.log(
      `${e.at}  ${e.status.padEnd(9)} ${usd(e.costUsd ?? 0).padStart(8)}  ${e.shot}  ${e.output ?? ''}`,
    );
  console.log(`\n已花費 ${usd(spent(l))} / 預算 ${usd(budget)}`);
  process.exit(0);
}

// ── --last-frame：抽出影片最後一格，作為下一段的起始畫面 ──
if (opt('last-frame')) {
  const video = resolve(opt('last-frame'));
  const out = join(WORK, 'frames', `${basename(video).replace(/\.[^.]+$/, '')}-last.png`);
  mkdirSync(dirname(out), { recursive: true });
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-sseof',
      '-0.1',
      '-i',
      video,
      '-frames:v',
      '1',
      '-update',
      '1',
      out,
    ],
    {
      stdio: 'inherit',
    },
  );
  console.log(`最後一格：${out}\n把它上傳到可公開讀取的位置後，用 --image-url 帶入下一段。`);
  process.exit(0);
}

const spec = JSON.parse(readFileSync(PROMPTS, 'utf8'));
const only = opt('only')?.split(',');
const takes = Math.max(1, Number(opt('takes', 1)));
const shots = spec.shots.filter((s) => !only || only.includes(s.id));
if (!shots.length) {
  console.error(`找不到鏡頭：${only?.join(', ')}。可用：${spec.shots.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

function buildInput(shot) {
  const prompt = [
    shot.prompt,
    `Opening frame: ${shot.start}`,
    `Closing frame: ${shot.end}`,
    spec.style,
    `Avoid: ${spec.negative}.`,
  ].join('\n\n');
  const extra = env.SEEDANCE_EXTRA_INPUT ? JSON.parse(env.SEEDANCE_EXTRA_INPUT) : {};
  const input = {
    prompt,
    negative_prompt: spec.negative,
    duration: shot.duration,
    aspect_ratio: spec.defaults.aspect_ratio,
    resolution: spec.defaults.resolution,
    seed: spec.defaults.seed,
    ...(shot.input ?? {}),
    ...extra,
  };
  const img = opt('image-url');
  if (img) input.image_url = img;
  return input;
}

// ── 成本估算 ──
const seconds = shots.reduce((s, x) => s + x.duration, 0) * takes;
const ledger = loadLedger();
console.log(`鏡頭 ${shots.length} 個 × ${takes} 次 = 成品 ${seconds} 秒`);
if (price !== null) console.log(`預估花費：${usd(seconds * price)}（每秒 ${usd(price)}）`);
else
  console.log(
    `預估花費：${usd(seconds * 0.1)}–${usd(seconds * 1.1)}（未設定 MEDIA_PRICE_PER_SEC，以每秒 $0.10–$1.10 估算）`,
  );
console.log(`已花費：${usd(spent(ledger))}／預算 ${usd(budget)}\n`);

if (!RUN) {
  for (const s of shots) {
    console.log(`── ${s.id}（${s.duration}s）${s.use ? `｜${s.use}` : ''}`);
    console.log(JSON.stringify(buildInput(s), null, 2));
    console.log();
  }
  console.log('這是 dry-run，沒有呼叫任何 API。確認後加上 --run 才會真的生成（會花錢）。');
  process.exit(0);
}

// ── 真的呼叫 ──
const missing = ['FAL_KEY', 'SEEDANCE_MODEL', 'MEDIA_PRICE_PER_SEC'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`--run 需要環境變數：${missing.join(', ')}（見 scripts/media/README.md）`);
  process.exit(1);
}
if (!Number.isFinite(price) || price <= 0) {
  console.error('MEDIA_PRICE_PER_SEC 必須是正數');
  process.exit(1);
}

const model = env.SEEDANCE_MODEL.replace(/^\/+|\/+$/g, '');
const headers = { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(shot, take) {
  const cost = shot.duration * price;
  const l = loadLedger();
  if (spent(l) + cost > budget) {
    throw new Error(
      `超過預算：已花 ${usd(spent(l))}＋本次 ${usd(cost)} > ${usd(budget)}。提高 MEDIA_BUDGET_USD 前請先跟團隊確認。`,
    );
  }
  const entry = {
    at: new Date().toISOString(),
    shot: shot.id,
    take,
    model,
    seconds: shot.duration,
    pricePerSec: price,
    costUsd: cost,
    status: 'submitted',
  };
  l.entries.push(entry);
  saveLedger(l);
  const idx = l.entries.length - 1;
  const update = (patch) => {
    const cur = loadLedger();
    Object.assign(cur.entries[idx], patch);
    saveLedger(cur);
  };

  try {
    const input = buildInput(shot);
    const res = await fetch(`https://queue.fal.run/${model}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`送出失敗 ${res.status}: ${await res.text()}`);
    const q = await res.json();
    update({ requestId: q.request_id });
    console.log(`  已送出 ${shot.id} #${take}（${q.request_id}）`);

    let status = '';
    const t0 = Date.now();
    while (status !== 'COMPLETED') {
      await sleep(5000);
      const s = await (await fetch(q.status_url, { headers })).json();
      status = s.status;
      process.stdout.write(`\r  ${status} ${Math.round((Date.now() - t0) / 1000)}s   `);
      if (status === 'FAILED' || s.error) throw new Error(`生成失敗：${JSON.stringify(s)}`);
      if (Date.now() - t0 > 20 * 60 * 1000) throw new Error('等待超過 20 分鐘');
    }
    process.stdout.write('\n');
    const out = await (await fetch(q.response_url, { headers })).json();
    const url = out?.video?.url ?? out?.videos?.[0]?.url ?? out?.output?.url;
    if (!url) throw new Error(`回應中找不到影片網址：${JSON.stringify(out).slice(0, 400)}`);
    const dir = join(WORK, 'raw', shot.id);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `${shot.id}-take${take}-${stamp}.mp4`);
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
    writeFileSync(file.replace(/\.mp4$/, '.json'), JSON.stringify({ input, output: out }, null, 2));
    update({ status: 'done', output: file.replace(`${ROOT}/`, '') });
    console.log(`  ✓ ${file.replace(`${ROOT}/`, '')}`);
  } catch (err) {
    // 送出前就失敗的請求不會被收費；送出後失敗的，保守起見仍計入，請到 fal 後台核對後手動改成 failed
    const submitted = loadLedger().entries[idx].requestId;
    update({ status: submitted ? 'error' : 'failed', error: String(err.message ?? err) });
    throw err;
  }
}

for (const s of shots) {
  for (let k = 1; k <= takes; k++) {
    try {
      await generate(s, k);
    } catch (err) {
      console.error(`\n✗ ${s.id} #${k}：${err.message}`);
      if (String(err.message).startsWith('超過預算')) process.exit(2);
    }
  }
}
console.log(`\n完成。已花費 ${usd(spent(loadLedger()))}／預算 ${usd(budget)}`);
