# PokéSurvivor 繁體中文自架版

目前版本：**2.0.0**。升級包含新增資料表，請先閱讀 [帳號升級步驟](docs/ACCOUNT_NICKNAME_PLAN.md)。

以寶可夢為主題的瀏覽器倖存者遊戲，包含 966 隻寶可夢、招式升級、異色收藏、抽卡及最多四人合作。本分支沿用原作 HTML、CSS、原生 JavaScript 與 Canvas 2D，加入繁體中文、PostgreSQL 後端及 Docker 部署。

## 快速啟動

需要 Docker Engine／Docker Desktop（Linux containers）及 Docker Compose 2.33.1 以上。本專案使用 Cloudflare Tunnel 作為網站入口，Cloudflare Realtime TURN 提供選配的多人連線中繼。

1. 複製 `.env.example` 為 `.env`，設定三組不同的隨機資料庫密碼與代理 secret。
2. 將 `APP_ORIGIN` 改成自己的公開 HTTPS 網址；需要 Google 登入時，另外設定 OAuth 憑證與對應回呼網址。
3. 依 [部署文件](docs/SELF_HOSTING.md) 準備外部網路及 Tunnel，執行：

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
```

範例網域僅為佔位值，部署前必須替換。`.env`、私鑰、憑證與資料庫備份不得提交。

## 遊戲操作

- 電腦：WASD／方向鍵移動，1～4 切換招式，Q／E 切換前後招式，Esc／P 暫停。
- 手機／平板：橫向遊玩，拖曳虛擬搖桿移動，點選底部招式切換。
- 寶可夢自動攻擊；拾取經驗升級、選卡強化，挑戰頭目及傳說裂隙。
- 設定可切換繁中、英文、西文及畫面偏好；繁中瀏覽器自動選用繁體中文。
- 帳號與原站獨立。註冊後可保存進度；Google 登入需部署者自行設定，沒有自助密碼重設。

## 更新紀錄與文件

功能更新及修正見 [CHANGELOG.md](CHANGELOG.md)，按日期分類；完整功能差異見 [原作與目前版本比較表](docs/UPSTREAM_COMPARISON.md)。

| 主題 | 文件 |
|---|---|
| 部署、備份與回滾 | [自架部署](docs/SELF_HOSTING.md)、[回滾](docs/ROLLBACK.md) |
| 帳號與 API | [Google 登入](docs/GOOGLE_AUTH.md)、[API](docs/API.md)、[暱稱與好友代碼](docs/ACCOUNT_NICKNAME_PLAN.md) |
| 安全與多人連線 | [安全說明](docs/SECURITY_REVIEW.md)、[連線診斷](docs/MULTIPLAYER.md) |
| 機率與遊戲設定 | [遊戲設定](docs/GAME_CONFIG.md)、[道具與異色](docs/ITEMS_SHINY_DEFENSE_REVIEW.md)、[生命寶珠平衡](docs/LIFE_ORB_PROPOSAL.md) |
| 介面與收藏 | [畫面設定](docs/GAMEPLAY_OPTIONS.md)、[最愛與能力面板](docs/FAVORITES_DISPLAY.md) |
| 平衡與招式 | [平衡方案](docs/BALANCE_PLAN.md)、[支援敵人](docs/SUPPORT_BALANCE.md)、[招式池](docs/SKILL_POOL_REVIEW.md) |
| 翻譯與字型 | [中文化](docs/LOCALIZATION.md)、[名稱來源](docs/terminology-zh-TW.json)、[字型來源](docs/FONT_SOURCES.md) |
| 原作更新審查 | [檢查與移植流程](docs/UPSTREAM_SYNC.md)、[本次待選差異](docs/UPSTREAM_REVIEW_2026-10-19.md) |
| Git 更新方式 | [版本下載與更新](docs/GITHUB_SSH.md) |

## 開發與驗證

使用符合 `server/package.json` 要求且仍受支援的 Node.js 安全修補版、Python 3.10 以上及 PostgreSQL 17。

```sh
npm --prefix server ci
npm --prefix server run check
npm --prefix server test
node tools/export_data.js
python tools/localize_zh_tw.py
node tools/build.js --plain --sin-seo
node tools/security-headers.js
```

前端來源為 `dev.html`、`js/`、`css/`，產生入口與素材位於根目錄、語言目錄及 `assets/`。API 與測試位於 `server/`，工具及文件分別位於 `tools/` 與 `docs/`。

## 原作、素材與授權

原作：[JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor)，原作官方網站：[pokesurvivor.com](https://pokesurvivor.com)。本分支為非官方自架修改版本。

原有 [LICENSE](LICENSE)、[LICENSE-NONCOMMERCIAL.md](LICENSE-NONCOMMERCIAL.md) 與 [CREDITS.md](CREDITS.md) 保留原作者及素材署名。現行程式採 PolyForm Noncommercial 1.0.0；舊版 MIT 適用範圍依原 LICENSE 說明，不將整個專案改稱 MIT。SpriteCollab 圖像依原有 CC BY-NC 4.0 條件使用。

新增字型 [Cubic 11／俐方體11號](https://github.com/ACh-K/Cubic-11) 由 ACh-K 維護，採 SIL Open Font License 1.1，隨附 [完整字型授權](assets/fonts/Cubic11-OFL.txt)。Pixelify Sans 的原有授權與署名亦保留。字型授權不取代程式、其他素材或商標的授權條件。

Pokémon 及相關角色與名稱屬原權利人所有；本專案不代表 Nintendo、Creatures、GAME FREAK 或 The Pokémon Company。
