# 安全設計與部署驗收

本文件說明已加入的防護與已知限制，並非正式站台的滲透測試認證。歷史測試結果不代表最新依賴或部署映像持續沒有漏洞。

## 防護範圍

| 項目 | 實作與限制 |
|---|---|
| 名稱與房間輸出 | 驗證成員欄位、禁止覆寫可信 UID、使用 escaping 與 dataset；舊存檔仍須視為不可信輸入 |
| 代理與訪客 IP | 依容器路由辨識可信網路，Nginx 覆寫內部 IP 標頭並附代理 secret；API 不直接相信外部 CF／XFF 標頭 |
| 代理信任邊界 | 信任 connector 所在的指定網路；該網路只能加入可信容器，辨識失敗便拒絕啟動 |
| 資料庫權限 | db-init 使用初始化帳號；API 使用受限角色，不得建表、刪表或提權，啟動時檢查權限 |
| 瀏覽器標頭 | CSP script hash、防嵌入與其他安全標頭；實際回應須在反向代理部署後驗收 |
| WebRTC 輸入 | 訊息大小、頻率、深度、結構及來源檢查，限制 ICE 佇列並清理離房資源；不是所有事件的完整語義驗證 |
| 資源配額 | 註冊／TURN 配額、密碼雜湊工作上限、session／房間上限與容器資源限制 |
| Google OAuth | 後端 code flow、PKCE、state、nonce、簽章驗證與一次性流程；不依 Email 自動合併帳號 |
| 日誌 | 固定連線事件代碼；不記錄密碼、Token、Cookie、原始訊息或 OAuth callback query |
| 建置 | 使用鎖定依賴與既有來源，不以臨時 npx 下載完成一般建置 |

## 已知限制

- 戰鬥模擬與經濟數值仍由客戶端處理，沒有伺服器權威反作弊。輸入格式檢查不能證明冒險結果真實。
- 公開 profile、presence 與開放房間遵循現有產品規則，未加入 MFA 或自助密碼重設。
- Cloudflare 的快取規則、流量費用警示、connector 網路成員、主機及 Docker 權限由部署者管理。
- 不要公開 `.env`、完整 Compose 展開、容器環境、Nginx 完整設定、資料庫備份或授權回呼網址。
- Node.js、Nginx、PostgreSQL、Alpine、Docker 與 cloudflared 均須持續更新。`server/package.json` 的最低版本只是基線，不代表永久安全。

## 驗證方式

```sh
npm --prefix server ci
npm --prefix server run check
npm --prefix server test
npm --prefix server audit
```

自動化包含隔離 PGlite 資料庫及 HTTP API，用來驗證輸入拒絕、XSS 防護、限流、權限與 OAuth fixture。PGlite 不等於正式 PostgreSQL 容器，模擬 WebRTC 也不等於真實 NAT／TURN。

部署後另行確認容器健康、Nginx 設定與回應標頭、資料庫升級和重啟持久化、Google 授權往返、跨網路多人連線，以及實際映像與主機的漏洞掃描。`npm audit` 只涵蓋 npm 公告資料庫，不涵蓋整個系統。

操作與回滾：[部署文件](SELF_HOSTING.md)、[Google 登入](GOOGLE_AUTH.md)、[多人連線](MULTIPLAYER.md)、[回滾](ROLLBACK.md)。
