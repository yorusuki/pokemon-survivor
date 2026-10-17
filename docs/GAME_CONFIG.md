# 活動機率與一次性配發

## 活動機率開關

在部署用 `.env` 加入以下欄位，保留既有密碼、憑證與連接埠設定：

```env
GAME_EVENT_BOOST_ENABLED=true
```

| 項目 | false 原始值 | true 活動值 |
|---|---|---|
| ★1 | 45% | 40% |
| ★2 | 30% | 30% |
| ★3 | 17% | 17% |
| ★4 | 6.5% | 6.5% |
| ★5 | 1.5% | 6.5% |
| 野生敵人異色 | 1/4096 | 1/2048 |
| 裂縫傳說異色 | 1/512 | 1/40（2.5%） |

兩種模式總權重都是 100。保底、十連保障、可用素材與卡池 fallback 仍生效，因此表列是基礎抽卡權重；抽卡異色率現為獨立 3%。只有具有異色素材的寶可夢能變成異色。

`.env.example` 預設 false；目前工作區私有 `.env` 設為 true。API 只接受小寫 true／false，其他值拒絕啟動。調整活動數值請編輯 `server/game-config.js`，不需要分別修改三份機率程式。前端每次載入以同源 `POST /api/game-config` 取得非秘密設定，實際抽卡與機率顯示使用同一份值；舊分頁不會自動套用，必須重新整理。

初次更新請同步整個專案並執行：

```sh
docker compose config --quiet
docker compose up -d --build
```

以後只切換 env 開關、程式未更動時，可重建 API：

```sh
docker compose up -d --no-deps --force-recreate api
```

然後玩家重新整理，抽卡頁會顯示「活動機率已啟用」。本次沒有新增資料表、配發 API 或新的外部依賴；遊戲模擬仍在瀏覽器，沒有新增防作弊權威伺服器。

## 一次性配發 600000 金幣與 200 張十連券

配發不會自動執行。`deployment/grant-existing-users.sql` 是純 PostgreSQL SQL，對執行當下的所有 users 帳號追加，不包含訪客。既有金額／抽卡券保留，不是設定餘額為 600000／200。

**執行前先備份正式資料庫。** shell 範例：

```sh
mkdir -p backups
GRANT_BACKUP="backups/before-grant-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U pokesurvivor -d pokesurvivor -Fc > "$GRANT_BACKUP"
```

檢查備份指令成功、檔案非空後，可用以下只讀指令核對 archive 清單：

```sh
docker compose exec -T postgres pg_restore --list < "$GRANT_BACKUP"
```

正式配發：

```sh
docker compose exec -T postgres psql -U pokesurvivor -d pokesurvivor -v ON_ERROR_STOP=1 < deployment/grant-existing-users.sql
```

也可把 SQL 檔內容貼入自己的 PostgreSQL 管理工具執行；必須使用可寫入 saves 的維護帳號。不要直接改 coins／tickets 而不改帳本。

- SQL 使用與 API 相同的交易鎖，更新金幣、十連券、跨裝置帳本及 revision；異常時整批回滾。
- 固定帳本鍵 `admin_grant_20261017_600000_200` 防止同一帳號重複配發。不要改名重跑；改名會被視為另一份獎勵。
- 重跑會略過已有標記者；若期間有新註冊帳號，重跑會向那些尚無標記的帳號配發。因此只想涵蓋本次使用者時，執行一次即可。
- 原本沒有 saves 的帳號會建立與目前 newSave 結構一致的初始存檔，保留原始 500 金幣後追加 600000，十連券為 200。第一次夥伴成就仍可能另給獎勵。
- 玩家重新載入／再次登入後讀取新餘額；跨裝置合併保留固定帳本鍵，不會重複加或被舊副本抵消。
- 若存檔格式不正確，或餘額與帳本不一致，SQL 會拒絕整批操作。不要移除驗證或覆蓋原帳本；保留錯誤再排查。
- 備份內含私人帳號與存檔，保持私密。此配發僅測試於隔離 PGlite，尚未在 正式 PostgreSQL 執行。

## 拉霸清晰度

原本把中文字畫在 176×170 的低解析度 Canvas，LED 字級只有 8px，再由 CSS 放大。新版保留像素機台的邏輯座標，按實際尺寸與 DPR（最高 3）建立繪圖解析度，文字使用系統字型、9px 邏輯字級及翻譯後量測。瀏覽器視窗調整時重新配置解析度；圖示繪製維持關閉 image smoothing。高解析度螢幕及行動裝置須實機驗收。

## 抽卡異色（2026-10-18 更新）

js/systems/gacha.js 的 SHINY_RATE 現為 3/100，先抽星級與寶可夢，再獨立抽異色；介面讀取同一常數。一般與活動的 1～5 星權重及保底未變，野生與裂縫異色率未變。此設定不是新增的 ENV。
