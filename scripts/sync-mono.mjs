#!/usr/bin/env node
// 同步 mono（內容的唯一來源）到 .cache/mono。
//
// - 設定 MONO_PATH 時直接使用該路徑（本機已有 mono 的開發者），不做任何 git 操作。
// - 否則以 `--filter=blob:none` 部分複製（保留完整 commit 歷史供 credits 統計，檔案內容按需下載）；
//   已存在就 `git pull --ff-only`。
// - 任何失敗只警告、exit 0：建置不可因為網路問題失敗，graph 會退回 fixture。
//
// 用法：pnpm sync:mono   或   MONO_PATH=../ai-native-founders-tw-mono pnpm sync:mono
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO =
  process.env.MONO_REPO ??
  'https://github.com/AI-Native-Founders-TW/ai-native-founders-tw-mono.git';
const TARGET = join(ROOT, '.cache', 'mono');

const log = (msg) => console.log(`[sync-mono] ${msg}`);
const warn = (msg) => console.warn(`[sync-mono] ⚠ ${msg}`);

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 120_000,
  });
}

try {
  if (process.env.MONO_PATH) {
    const p = resolve(process.env.MONO_PATH);
    if (existsSync(join(p, 'specs'))) log(`使用 MONO_PATH=${p}（不做同步）`);
    else warn(`MONO_PATH=${p} 看起來不是 mono（找不到 specs/）`);
  } else if (existsSync(join(TARGET, '.git'))) {
    log(`更新 ${TARGET}`);
    git(['pull', '--ff-only', '--quiet'], TARGET);
    log(`完成：${git(['log', '-1', '--format=%h %cI %s'], TARGET).trim()}`);
  } else {
    mkdirSync(dirname(TARGET), { recursive: true });
    log(`部分複製 ${REPO} → ${TARGET}`);
    git(['clone', '--filter=blob:none', '--quiet', REPO, TARGET], ROOT);
    log(`完成：${git(['log', '-1', '--format=%h %cI %s'], TARGET).trim()}`);
  }
} catch (err) {
  warn(`同步失敗，將沿用既有快取或 fixture：${String(err?.stderr || err?.message || err).trim()}`);
}
process.exit(0);
