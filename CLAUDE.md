# PokéSurvivor 自架版開發與發布

- 遊戲來源入口為 `dev.html`；不要手動修改產生的 `index.html`、`en/index.html` 或 `zh-TW/index.html`。
- 自架建置：`node tools/build.js --plain --sin-seo`，必須保留 updater 及 `version.json` 產生流程。
- 中文資料重建：`node tools/export_data.js`、`python tools/localize_zh_tw.py`，最後重新建置遊戲。
- 帳號與資料使用 `server/` 的 Node.js API 及 PostgreSQL；不要恢復原作 Firebase 設定或 SDK。
- Cloudflare TURN 僅由後端以 `.env` 內的憑證申請短期 ICE 資料；不可把長期 token 放到前端。
- Docker 外部網路供 Cloudflare Tunnel connector 與網站服務通訊；部署者自行設定公開 hostname 與 origin。
- 修改後執行 `server/` 的 `npm run check`、`npm test`，依變更執行建置與設定驗證。
- 更新紀錄按日期合併、同日分類及原作比較表維護規則見 [AGENTS.md](AGENTS.md)。
- 介面／玩法修正同步更新 `js/data/changelog.js`；伺服器及資料庫變更記錄於根目錄 `CHANGELOG.md`。
- 不自行建立 remote 或 push；遵循使用者提供的 AGENTS.md。
