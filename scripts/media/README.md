# 影片素材管線（Seedance → 影格序列）

章節 03「出海」與 Hero 背景可以使用 AI 生成的影片。**沒有素材時網站會自動使用程式版本**（Three.js 地球與航線），所以這條管線是加分，不是上線的前提。

> 經費與授權需要團隊拍板（見 `docs/08-獎項等級製作計畫.md` §6、§10）。開工前先確認模型供應商的商業／公開使用條款。

## 檔案

| 檔案                | 用途                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `prompts.json`      | 4 段鏡頭的英文 prompt：Hero 循環 1 段＋出海 3 段。共用風格、Logo 色票、負面提示；每段的 `end` 就是下一段的 `start`  |
| `seedance.mjs`      | 呼叫 fal 佇列 API 生成影片。**預設 dry-run**；每次呼叫前估算成本，超過預算就拒絕；花費記在 `media-work/ledger.json` |
| `extract-frames.sh` | 用 ffmpeg 把影片轉成 WebP 影格（桌機 1920 寬 120 張、手機 960 寬 60 張、預覽 480 寬 40 張）與 `manifest.json`       |

`media-work/`（原始影片、ledger、抽出的畫格）已在 `.gitignore` 裡，不會進 repo。

## 環境變數

| 變數                   | 必填       | 說明                                                                                                                                                                                                                      |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FAL_KEY`              | `--run` 時 | fal 的 API key（fal.ai → Dashboard → Keys）。放在 `.env.local` 或 shell，不要 commit                                                                                                                                      |
| `SEEDANCE_MODEL`       | `--run` 時 | fal 上 Seedance 模型的 **endpoint id**。到 fal 的模型頁（搜尋 Seedance，選要用的版本與 text-to-video／image-to-video）複製頁面上的 id，例如 `<組織>/<模型>/<版本>/text-to-video` 這種格式。腳本不寫死，因為版本與命名會變 |
| `MEDIA_PRICE_PER_SEC`  | `--run` 時 | 該模型、該解析度「每秒成品」的美元價格，照模型頁的 Pricing 填。dry-run 沒設定時以每秒 $0.10–$1.10 的區間估算                                                                                                              |
| `MEDIA_BUDGET_USD`     | 否         | 總預算上限，預設 `50`。ledger 已花費＋本次預估超過就拒絕（exit code 2）                                                                                                                                                   |
| `SEEDANCE_EXTRA_INPUT` | 否         | JSON，合併進每次請求的 input。不同模型的欄位名稱不同（例如 `resolution`、`camera_fixed`、`end_image_url`），照模型頁的 schema 調整                                                                                        |

## 操作步驟

```bash
# 1. 先看 prompt 與預估花費（不會呼叫 API）
node scripts/media/seedance.mjs
node scripts/media/seedance.mjs --only voyage-1-taipei-night --takes 3

# 2. 設定環境變數後，小量試生成（會花錢）
export FAL_KEY=…  SEEDANCE_MODEL=…  MEDIA_PRICE_PER_SEC=…  MEDIA_BUDGET_USD=50
node scripts/media/seedance.mjs --run --only voyage-1-taipei-night --takes 2

# 3. 銜接下一段：抽出上一段挑中 take 的最後一格，上傳到可公開讀取的位置（R2 等），當作下一段的起始畫面
node scripts/media/seedance.mjs --last-frame media-work/raw/voyage-1-taipei-night/<挑中的檔>.mp4
node scripts/media/seedance.mjs --run --only voyage-2-pacific --takes 2 --image-url https://…/voyage-1-last.png
#    （起始畫面欄位叫 image_url 以外的名稱時，用 SEEDANCE_EXTRA_INPUT 指定）

# 4. 查看花費
node scripts/media/seedance.mjs --ledger

# 5. 後製（調色到 Logo 色票、清掉文字與破綻）後，三段接起來轉成影格
scripts/media/extract-frames.sh media-work/final/voyage-1.mp4 media-work/final/voyage-2.mp4 media-work/final/voyage-3.mp4
#    → public/media/voyage/manifest.json 出現後，章節 03 自動改用影格序列
#    素材要放 R2 時：上傳整個資料夾，建置時設 PUBLIC_VOYAGE_MANIFEST=https://…/voyage/manifest.json
```

## 預估花費

成品總長：Hero 8 秒＋出海 3×10 秒＝ **38 秒／輪**。

| 每秒價格 | 每輪  | 預算 $50 可跑 |
| -------- | ----- | ------------- |
| $0.10    | $3.8  | 約 13 輪      |
| $0.30    | $11.4 | 約 4 輪       |
| $0.50    | $19   | 約 2 輪       |
| $1.10    | $41.8 | 1 輪          |

實務上每段要重生 5–15 次才挑得到好的，建議：先用最低解析度／最便宜的版本調 prompt，定案後再用正式解析度只生成需要的段落。

## 規則

- 影片裡**不能出現任何文字或 Logo**；文字一律是 HTML，Logo 一律是 SVG（`prompts.json` 的 negative 已經寫了，仍要逐格檢查）。
- 色彩限定 Logo 色票：`#0b0f38` `#1e47f3` `#4d47fe` `#19acfe` `#decffe`。
- 影格總大小：桌機 < 10 MB、手機 < 4 MB（`QUALITY=70 scripts/media/extract-frames.sh …` 可再壓小）。
- 頁尾與 Credits 註明使用 AI 生成素材（`copy.footer.aiCredit`）。
