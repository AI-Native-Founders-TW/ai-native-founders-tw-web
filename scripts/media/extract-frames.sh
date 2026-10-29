#!/usr/bin/env bash
# 把出海章節的影片轉成捲動用的 WebP 影格序列與 manifest.json。
#
# 用法：
#   scripts/media/extract-frames.sh <video> [<video2> <video3> …] [-o public/media/voyage]
#   多段影片會先依序接起來（建議：voyage-1、voyage-2、voyage-3 挑好的 take）。
#
# 產出（預設 public/media/voyage/）：
#   preview/0001.webp …  480 寬、40 張（先載入的低解析度）
#   desktop/0001.webp …  1920 寬、約 120 張
#   mobile/0001.webp  …  960 寬、約 60 張（中央裁成 3:4 直式）
#   poster.webp          最後一格（減少動態／無 JS 的靜態畫面可用）
#   manifest.json        章節 03 的 FrameSequence 讀這個檔
#
# 可用環境變數調整：DESKTOP_COUNT=120 MOBILE_COUNT=60 PREVIEW_COUNT=40 QUALITY=78
set -euo pipefail

OUT="public/media/voyage"
INPUTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o | --out) OUT="$2"; shift 2 ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) INPUTS+=("$1"); shift ;;
  esac
done
[[ ${#INPUTS[@]} -gt 0 ]] || { sed -n '2,17p' "$0"; exit 1; }
command -v ffmpeg >/dev/null || { echo "需要 ffmpeg（brew install ffmpeg）"; exit 1; }

DESKTOP_COUNT="${DESKTOP_COUNT:-120}"
MOBILE_COUNT="${MOBILE_COUNT:-60}"
PREVIEW_COUNT="${PREVIEW_COUNT:-40}"
QUALITY="${QUALITY:-78}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. 接成一段
SRC="${INPUTS[0]}"
if [[ ${#INPUTS[@]} -gt 1 ]]; then
  : >"$TMP/list.txt"
  for f in "${INPUTS[@]}"; do printf "file '%s'\n" "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" >>"$TMP/list.txt"; done
  ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$TMP/list.txt" -an -c:v libx264 -crf 14 -pix_fmt yuv420p "$TMP/joined.mp4"
  SRC="$TMP/joined.mp4"
fi

DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$SRC")"
echo "來源長度 ${DUR}s"
fps() { awk -v n="$1" -v d="$DUR" 'BEGIN { printf "%.5f", n / d }'; }

rm -rf "$OUT/desktop" "$OUT/mobile" "$OUT/preview"
mkdir -p "$OUT/desktop" "$OUT/mobile" "$OUT/preview"

extract() { # <dir> <count> <filter> <quality>
  ffmpeg -hide_banner -loglevel error -y -i "$SRC" -an \
    -vf "fps=$(fps "$2"),$3" -frames:v "$2" \
    -c:v libwebp -quality "$4" -compression_level 6 -preset photo "$OUT/$1/%04d.webp"
  echo "  $1: $(find "$OUT/$1" -name '*.webp' | wc -l | tr -d ' ') 張"
}
extract desktop "$DESKTOP_COUNT" "scale=1920:-2:flags=lanczos" "$QUALITY"
extract mobile "$MOBILE_COUNT" "crop=ih*3/4:ih,scale=960:-2:flags=lanczos" "$QUALITY"
extract preview "$PREVIEW_COUNT" "scale=480:-2:flags=lanczos" 60
ffmpeg -hide_banner -loglevel error -y -sseof -0.1 -i "$SRC" -frames:v 1 -update 1 -vf "scale=1920:-2" -c:v libwebp -quality 82 "$OUT/poster.webp"

dims() { ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$1"; }
count() { find "$OUT/$1" -name '*.webp' | wc -l | tr -d ' '; }
D="$(dims "$OUT/desktop/0001.webp")"
M="$(dims "$OUT/mobile/0001.webp")"
P="$(dims "$OUT/preview/0001.webp")"

cat >"$OUT/manifest.json" <<JSON
{
  "version": 1,
  "poster": "poster.webp",
  "variants": {
    "preview": { "width": ${P%x*}, "height": ${P#*x}, "count": $(count preview), "pattern": "preview/{i}.webp", "pad": 4, "start": 1 },
    "desktop": { "width": ${D%x*}, "height": ${D#*x}, "count": $(count desktop), "pattern": "desktop/{i}.webp", "pad": 4, "start": 1 },
    "mobile": { "width": ${M%x*}, "height": ${M#*x}, "count": $(count mobile), "pattern": "mobile/{i}.webp", "pad": 4, "start": 1 }
  }
}
JSON

echo "總大小：桌機 $(du -sh "$OUT/desktop" | cut -f1)、手機 $(du -sh "$OUT/mobile" | cut -f1)、預覽 $(du -sh "$OUT/preview" | cut -f1)"
echo "完成：$OUT/manifest.json（重新整理頁面，章節 03 會自動改用影格）"
