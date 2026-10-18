# 原作與目前版本比較

本表只比較固定原作基準與本分支目前結果，不記錄中間試作。每次功能變更應同步修改對應列；逐日修改及驗證見 [更新紀錄](../CHANGELOG.md)。

- 初始基準：原作者 [JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor/tree/5bbc3b29288d6af4596f21188fb8b54e0e9b739f)，固定提交 `5bbc3b29288d6af4596f21188fb8b54e0e9b739f`，不是本分支經過修改的最早提交。
- 目前結果：本分支 2.0.0 及後續已合併修正；最後核對日期 **2026-10-19**。此欄隨功能維護，不隨上游 main 自動改變基準。
- 原作既有更新仍保留於遊戲內歷史；這不表示原站後端資料或政策已移植。

## 架構、帳號與連線

| 項目 | 原作基準 | 目前結果 | 對照文件／模組 |
|---|---|---|---|
| 遊戲核心 | 原生 HTML、JavaScript、Canvas 2D，最多四人合作 | 沿用核心架構，沒有改用遊戲框架 | `js/game.js`、`js/net/coop.js` |
| 雲端儲存 | Firebase Auth、Firestore、Realtime Database | Node.js HTTP API 與 PostgreSQL，原站帳號及資料獨立 | [部署](SELF_HOSTING.md)、[API](API.md) |
| Google 登入 | Firebase Google popup 與帳號綁定 | OAuth authorization code 流程、PKCE／state／nonce，保留登入、綁定及刪除前驗證；需要自己的 OAuth 設定 | [Google 登入](GOOGLE_AUTH.md) |
| 改名 | 以既有公開名稱使用帳號，沒有目前的改名流程 | 註冊帳號每 24 小時可改公開暱稱，舊名保留 7 天；登入帳號與 UID 不變；房間／遊戲中禁止改名 | [帳號方案及升級](ACCOUNT_NICKNAME_PLAN.md) |
| 好友搜尋 | 依公開名稱搜尋，以 UID 維繫好友關係 | 使用固定隨機好友代碼及複製按鈕，關係仍依 UID；清單顯示最新暱稱 | [帳號方案](ACCOUNT_NICKNAME_PLAN.md) |
| 部署 | Firebase 服務設定搭配前端 | Docker Compose：Nginx、API、PostgreSQL；外部網路銜接 Cloudflare Tunnel | [部署](SELF_HOSTING.md) |
| 多人協商 | 直連等待 9 秒；停用 relay | 協商等待延長至 30 秒，可設定 Cloudflare Realtime TURN 短期憑證；增加重試、限流及斷線診斷 | [多人連線](MULTIPLAYER.md) |
| 升級選卡同步 | 選卡暫停及合作同步 | 保留等待隊員完成，降低暫停期間資料頻率，增加回合序號與確認，避免舊訊息干擾 | `js/net/coop.js` |
| 安全措施 | Firebase SDK 與原站後端規則 | 自架 API 驗證、最小資料庫權限、代理驗證、CSP、輸出轉義與限流；仍非伺服器權威遊戲模擬 | [安全說明](SECURITY_REVIEW.md) |

## 玩法、數值與介面

| 項目 | 原作基準 | 目前結果 | 對照文件／模組 |
|---|---|---|---|
| 寶可夢與相剋 | 既有寶可夢資料、基礎能力、屬性與天氣規則 | 保留資料及規則；未全面重算種族值或相剋 | `js/data/pokedex.js`、`js/data/types.js` |
| 語言 | 西文、英文 | 增加繁體中文介面、測驗、攻略及名稱對照；名稱以穩定 ID 對應，避免翻譯破壞存檔 | [中文化](LOCALIZATION.md) |
| 抽卡星級 | 1～5 星：45／30／17／6.5／1.5% | 預設維持；活動開關啟用後為 40／30／17／6.5／6.5% | [遊戲設定](GAME_CONFIG.md) |
| 抽卡異色 | 獨立 1% | 獨立 3%，星級分布及保底不受影響 | [道具與異色](ITEMS_SHINY_DEFENSE_REVIEW.md) |
| 野生／裂縫異色 | 野生 1/4096，裂縫傳說 1/512 | 預設維持；活動開關啟用後分別為 1/2048、1/40 | [遊戲設定](GAME_CONFIG.md) |
| 治療者 | 每次 7～17.5%，依玩家攻擊成長；可自療，沒有目標共同冷卻或專用數量上限 | 每次 5～12%，依玩家等級；不自療，可互補、隔牆及治療特殊敵人；目標共同間隔在場次 0～30 分鐘從 2 秒增至 8 秒；每次治療不限人數 | [原始模式](SUPPORT_ORIGINAL.md)、[目前規則](SUPPORT_BALANCE.md) |
| 護盾者 | 最近最多 6 名敵人補至 35% 護盾、持續 8 秒，可包括自身，沒有目標共同冷卻 | 依等級 10～40%，同目標 2.5 秒不能重複上盾；不能自盾，可隔牆與作用於特殊敵人；維持最多 6 名及持續 8 秒 | [支援敵人](SUPPORT_BALANCE.md) |
| 支援敵人生成 | 沒有目前的開場排除與個別上限，仍受一般生成規則限制 | 前 60 秒不出現一般治療者／護盾者；場上各最多 25 隻，仍受總敵人上限限制 | [支援敵人](SUPPORT_BALANCE.md) |
| 護甲減傷 | 護甲與道具等共用減傷來源，reduction 上限 80%；近戰另乘 0.75 | 分開計算護甲、道具與臨時效果；含近戰保護合計最多 90%，相剋與天氣保留；純傷及最低傷害規則仍適用 | [防禦方案](ARMOR_FIX_PROPOSAL.md) |
| 生命寶珠 | 攻擊 +30%，施放適用招式時扣最大生命 1%，最低扣 1 且不低於 1 HP | 攻擊 +30%、最大生命 -10%，取消攻擊扣血；裝卸維持血量比例 | [生命寶珠](LIFE_ORB_PROPOSAL.md) |
| 招式儲備 | 購買後使用第二起始招式 | 購買後每隻寶可夢可自行開關，開關獨立換行 | [畫面設定](GAMEPLAY_OPTIONS.md) |
| 初次道具 | 初次取得直接裝備 | 先詢問是否裝備，可拒絕 | `js/game.js` |
| 私人最愛 | 公開個人資料的既有最愛展示 | 額外加入最多 100 隻私人最愛、雙擊切換、愛心與篩選；保留原公開展示 | [最愛](FAVORITES_DISPLAY.md) |
| 30 分鐘紀念 | 沒有目前的逐帳號、逐寶可夢紀念名稱 | 達成後在選擇、詳情、選單及 HUD 顯示金字與閃光，不加金框；無戰力加成，無法從缺少寶可夢資料的舊紀錄補發 | [畫面設定](GAMEPLAY_OPTIONS.md) |
| 字型與戰鬥顯示 | 原有字型及戰鬥介面 | 增加並預設 Cubic 11；己方攻擊透明度、角色下方血條及數字、半透明能力面板；只列已有加成，選卡顯示前後數值 | [畫面](GAMEPLAY_OPTIONS.md)、[字型授權](FONT_SOURCES.md) |
| 獎勵配發 | 既有獎勵流程 | 提供管理員一次性配發指令及防重複紀錄，不自動改新帳號初始資產 | [遊戲設定](GAME_CONFIG.md) |
| 更新紀錄 | 遊戲內雙語更新清單 | 遊戲與 GitHub 每日一筆、依類別整理；本表只維護原作到目前差異 | [更新紀錄](../CHANGELOG.md)、[維護規則](../AGENTS.md) |

## 尚未套用與驗證界線

| 項目 | 目前狀態 |
|---|---|
| 每帳號、每隻寶可夢補強點數／低星補正 | 僅 [平衡提案](BALANCE_PLAN.md)，尚未實作，不計入已提供功能。 |
| 原站 Firebase 資料合併 | 沒有存取原站資料的權限，不提供自動合併。 |
| 遊戲作弊防護 | 客戶端仍掌握模擬與經濟；API 驗證不等於完整反作弊。 |
| 外部服務及部署 | 程式測試不能取代部署端容器、實際 Google 授權與多人跨網路長局驗收。 |

原始行為可由固定提交的 [資料庫](https://github.com/JPTER78/pokesurvivor/blob/5bbc3b29288d6af4596f21188fb8b54e0e9b739f/js/core/db.js)、[敵人](https://github.com/JPTER78/pokesurvivor/blob/5bbc3b29288d6af4596f21188fb8b54e0e9b739f/js/entities/enemy.js)、[玩家](https://github.com/JPTER78/pokesurvivor/blob/5bbc3b29288d6af4596f21188fb8b54e0e9b739f/js/entities/player.js)、[抽卡](https://github.com/JPTER78/pokesurvivor/blob/5bbc3b29288d6af4596f21188fb8b54e0e9b739f/js/systems/gacha.js) 與 [連線](https://github.com/JPTER78/pokesurvivor/blob/5bbc3b29288d6af4596f21188fb8b54e0e9b739f/js/net/net.js) 核對。原作者、素材與字型授權保持原規定，見 [README 授權說明](../README.md#原作素材與授權)。
