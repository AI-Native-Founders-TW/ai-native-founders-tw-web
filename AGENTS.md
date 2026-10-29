# AGENTS.md

AI-Native Global Founders Speedrun Taiwan 的網站。屬於 [mono](https://github.com/AI-Native-Founders-TW/ai-native-founders-tw-mono) 的衍生程式碼，之後以 submodule 掛進 mono。

## 規則

- 網站上的所有內容與文案受 mono 的[憲法](https://github.com/AI-Native-Founders-TW/ai-native-founders-tw-mono/blob/main/specs/01-%E5%88%B6%E5%BA%A6/constitution.md)約束；Deliver／Push 前依 mono `AGENTS.md` 的方法，以 subagent 逐條檢查。
- 規則、願景、自介與筆記以 mono 為唯一來源，本 repo 不另存可編輯的副本；網站在 build 時從 mono 讀取。
- 不得把 mono `# Note` 中尚未採納的構想寫成網站已提供的服務。
- 不得加入付費置入、廣告或特定公司推銷（憲法第 7 條）。
- 加入組織的唯一途徑是自介 PR；網站不設其他申請表單。

## 指令

```bash
pnpm dev          # 本機開發 http://localhost:4321
pnpm build        # 先同步 mono 到 .cache/mono，再輸出 dist/
pnpm check        # Astro 與 TypeScript 型別檢查
pnpm test         # Vitest
pnpm lint         # Biome；pnpm format 自動排版
node scripts/shot.mjs <url> <out.png>   # 截圖，改畫面後用來實際看結果
```

Push 前 `pnpm check && pnpm test && pnpm lint && pnpm build` 都要通過。本機已有 mono 時用 `MONO_PATH=../ai-native-founders-tw-mono` 跳過複製。

## 程式碼地圖

| 位置 | 放什麼 |
|---|---|
| `src/graph/` | 內容圖譜：把 mono 的自介、規格、git 紀錄與 `credits.yml` 轉成人與貢獻。`index.ts` 是合約，簽名不要改 |
| `src/experience/` | 首頁的捲動體驗。`engine/` 是全站唯一的動畫時鐘與捲動，章節不要自己開 `requestAnimationFrame` 或 Lenis |
| `src/experience/chapters/NN-*/` | 首頁各章節，一章一個資料夾 |
| `src/components/` | 內頁（`/join`、`/credits`）與共用 Header／Footer |
| `src/content/copy/*.yaml` | 文案。zh-tw 為主，en 缺的欄位退回 zh-tw |
| `src/config/links.ts` | 所有外部連結的唯一來源 |
| `src/pages/api/v1/`、`llms*.txt.ts` | 給其他程式與 AI 讀的公開 JSON 與文字輸出 |
| `docs/` | 規劃文件：決策脈絡、架構、設計方向、路線圖 |

## 慣例

- 文案改 YAML，不寫死在元件裡；外部連結改 `links.ts`。
- 動態一律尊重 `prefers-reduced-motion`，降級時保留可讀的靜態 HTML。
- 讀不到 mono 時退回 `src/graph/fixture.ts` 並警告，build 不可因此失敗。
- 註解用繁體中文；commit 訊息沿用 `feat:`、`fix:`、`chore:` 前綴。
