# 自架部署與操作

## 架構

瀏覽器 → Cloudflare Tunnel → 網站服務（Nginx）→ `/api/`（Node.js）→ PostgreSQL 17。

遊戲畫面與模擬仍在瀏覽器執行。合作房間、WebRTC 協商、好友與排行榜使用本站 API；遊戲即時資料使用 WebRTC DataChannel。設定 Cloudflare Realtime TURN 後，WebRTC 可透過 TURN 穿越無法直接連線的網路。

Cloudflare Tunnel 與 Cloudflare TURN 是兩個服務：Tunnel 提供網站 HTTPS 入口；TURN 轉送 WebRTC 流量，不能以 Tunnel 取代。TURN 是 Cloudflare 託管服務，此專案負責產生短期憑證及串接，並非在 Docker 啟動 Cloudflare 的 TURN 引擎。

## 首次部署

需求：可執行 Linux containers 的 Docker Engine／Docker Desktop、Docker Compose 2.33.1 以上，以及已連接到 Docker 網路 `cloudflared` 的 Tunnel connector。

1. 複製 `.env.example` 為 `.env`。分別設定初始化用 `POSTGRES_PASSWORD`、API 用 `APP_DATABASE_PASSWORD`（至少 32 字元）及 `API_PROXY_SECRET`（32～128 個英數字／底線／連字號），三者使用不同隨機值。`APP_ORIGIN` 必須改成自己的公開 HTTPS 網址，範例網域僅供示意。不需固定 connector IP，詳見下節的代理信任範圍。
2. 確認外部網路存在：`docker network inspect cloudflared`。若尚未建立，執行 `docker network create cloudflared`，並讓既有 Tunnel container 加入這個網路。不要重新建立正在使用的網路。
3. 執行：

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 api
```

4. 在 Cloudflare Tunnel 設定自己的公開 hostname，origin 指向同一 Docker 網路的網站服務；服務名稱與連接埠依 Compose 設定填寫。Tunnel 憑證由 connector 管理。`deployment/cloudflared.example.yml` 僅供結構參考，所有佔位值均須替換。
5. 開啟網站。繁中瀏覽器會自動選擇繁體中文，也可從設定 → 圖形 → 語言切換，或使用 `/zh-TW/` 入口。

資料庫與 API 不發布主機連接埠；只有 Nginx 的 `127.0.0.1:8080` 可供主機測試。公開連線經既有 Tunnel；PostgreSQL volume 為 `postgres-data`。`db-init` 以初始化帳號執行可重複套用的 schema 與權限設定，成功後 API 才啟動。API 只使用 `pokesurvivor_app`，沒有建表／管理角色權限；啟動時檢查權限過大的設定並拒絕啟動。沒有自動搬移 Firebase 的功能。

`APP_ORIGIN` 是 CSRF 驗證依據。請使用設定中的同一個網域、協定及連接埠；例如設定 `localhost` 後使用 `127.0.0.1` 註冊會被拒絕。公開部署使用 HTTPS，登入 Cookie 會自動加入 Secure。

不要將 `docker compose config` 的完整輸出貼到公開場所，因為展開後會包含環境變數；檢查設定請使用 `--quiet`。

## 自動辨認 cloudflared 網路與代理信任範圍

不用設定 `CLOUDFLARED_TRUSTED_PROXY`，也不用替 Tunnel 容器固定 IP。web 的 Compose 網路設定以 `gw_priority: 100` 選定 `cloudflared` 作為預設閘道網路；另一個 application 網路保持 internal。啟動腳本讀取 Linux 容器內的路由，只將該介面的私有直連子網寫入 Nginx `set_real_ip_from`，不猜測 eth0／eth1、不讀 Docker socket、不信任所有來源。

同一 Docker 網路中 connector IP 改變或電腦重新啟動，不需要修改 `.env`。若整個網路重建或子網改變，重新建立 web 容器會重新偵測。設定無法辨識唯一閘道、沒有私有直連子網或出現不支援的公網範圍時，web 拒絕啟動，不會降級成信任所有人。

**信任邊界是整個 cloudflared 網路，不再是單一 connector IP。此網路內只能加入可信容器；同網路的其他容器有能力偽造訪客 IP。** 若需隔離不可信服務，請使用只供 Tunnel 與遊戲 web 的專用 bridge 網路，並將外部網路名稱映射到該網路。不要公開 web 主機 port 或把 Docker socket 掛入容器；現有主機測試 port 維持只綁 127.0.0.1。

目前支援一般 Docker bridge 的 RFC1918 IPv4 子網（10/8、172.16/12、192.168/16）；同介面若有 IPv6 ULA 直連子網也會加入信任，link-local 不加入。不支援 IPv6-only、公網 IP／macvlan 或 cloudflared 網路被設為 internal 的拓撲。這些特殊環境需另行設計，不應改成信任 0.0.0.0/0。

Nginx 只對上述可信來源使用 `CF-Connecting-IP`，覆寫內部 `X-PS-Client-IP` 並附上 `API_PROXY_SECRET`；API 仍拒絕缺少或錯誤 secret 的代理請求，不直接相信 CF／XFF 標頭。secret 只在 Nginx 與 API，不傳入瀏覽器。`GET /api/health` 仍限內部健康檢查使用。

Cloudflare Cache Rules 對 `/api/*` 與 `/oauth-result.html` bypass cache。不要公開 `nginx -T`、完整 Compose 展開或容器環境，這些可能含 secret；使用 `docker compose config --quiet` 與 `nginx -t`。access log 不記錄 URI、query、Cookie 或 body。

參考：[Docker 閘道優先順序](https://docs.docker.com/reference/compose-file/services/#gw_priority)、[Nginx 可信來源機制](https://nginx.org/en/docs/http/ngx_http_realip_module.html)。

| 變數 | 用途／預設 |
|---|---|
| `POSTGRES_PASSWORD` | 初始化／維護帳號密碼；既有 volume 必須沿用原密碼，不能只改 env 當成已輪換 |
| `APP_DATABASE_PASSWORD` | 新的 `pokesurvivor_app` 密碼，至少 32 字元；db-init 建立／更新，API 使用；不得與初始化密碼相同 |
| `API_PROXY_SECRET` | Nginx 與 API 必須一致；修改後兩個服務都要重建 |
| `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET` | Google Web application OAuth 憑證；皆空關閉，secret 僅 API 使用 |
| `GOOGLE_REDIRECT_URI` | 預設範例 `https://game.example.com/api/auth/google/callback`；必須等於 APP_ORIGIN + callback 路徑 |
| `TURN_CREDENTIALS_PER_HOUR` | 同一資料庫每小時全站最多呼叫 TURN 發證次數，預設 300 |
| `GAME_EVENT_BOOST_ENABLED` | true 啟用活動機率、false 原始機率；預設 false，設定後重建 API 並重新整理頁面 |
| `REGISTRATIONS_PER_HOUR` | 同一資料庫每小時最多註冊嘗試，預設 100 |

全站註冊與 TURN 配額儲存在 `security_limits`，以 SQL 原子計數，重啟或同一資料庫的多個 API 程序共用額度。這是發證／嘗試次數上限，不是 TURN 頻寬或帳單硬上限，仍須在 Cloudflare 設定額度警示與邊緣限流。其他每 IP／每使用者請求頻率保護在程序記憶體中，重啟會重設；目前以單一 API 容器為部署基準。每帳號最多 20 個有效 session（新登入淘汰最舊）、同時最多 2 個房主房間，每小時最多新增 20 份檢舉、每帳號待處理檢舉最多 200 份。容器已設定記憶體與程序數上限，可按部署規模調整。

## 既有自架資料庫升級

先執行既有備份程序並驗證可還原。這次保留既有玩家資料表與 v3 存檔格式，新增 `security_limits`、`google_identities`、`oauth_flows`，並將 `users.password_hash` 放寬為 nullable 供 Google-only 帳號使用，不清空資料、不轉換玩家 UID。

1. 保留原本的 `POSTGRES_PASSWORD`，新增其餘必填 env 值。
2. `docker compose build --pull`，再執行 `docker compose run --rm db-init`；這會新增／設定 runtime role 並收回 public schema 的 PUBLIC CREATE 權限。若既有 `pokesurvivor_app` 有額外角色成員資格或擁有 public 物件，會失敗並要求人工處理，不能忽略。
3. 執行 `docker compose up -d --force-recreate db-init api pokesurvivor-web`，檢查 `docker compose ps` 與 `docker compose logs --tail=100 db-init api`。
4. 驗證登入、讀寫存檔、雙裝置更新、合作房間及持久化。若 db-init 失敗，API 不應使用舊的高權限連線繼續啟動。

這輪只在 PGlite 驗證 SQL 權限與資料保留，尚未對實際 Docker PostgreSQL volume 演練升級。

## Cloudflare TURN

1. 依 [Cloudflare 官方文件](https://developers.cloudflare.com/realtime/turn/generate-credentials/)在 Realtime TURN 建立 TURN key。
2. 將 TURN Key ID 與對應的 API token 分別填入 `.env`：

```dotenv
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_API_TOKEN=
```

3. 執行 `docker compose up -d api` 套用新設定，重新整理遊戲頁面，再邀請好友測試。

長期 token 只存於 API 容器環境，不會編入前端。登入後的 `/api/ice-servers` 會向 Cloudflare 申請有效期 2 小時的短期憑證；有每位使用者的請求限制。前端快取憑證，再於建立 WebRTC 連線前載入。

兩項皆未填時使用 STUN，部分網路可能無法合作；只填一項、設定錯誤或供應商拒絕時，API 明確回傳錯誤，不會宣稱 TURN 已啟用。TURN 是外部服務，使用額度及費用依 Cloudflare 帳號方案，請在其控制台確認。

驗收應以兩個不同網路的玩家建立房間並實際進入遊戲；檢查 WebRTC 的選用 ICE candidate 是否為 `relay`。單純取得憑證不能證明 TURN 中繼已通。

## 固定內網 IP（選配）

Tunnel origin 可使用 Docker 服務名稱，不需要固定 IP。若確有固定 IP 需求：

```sh
docker network inspect cloudflared
```

確認 IPAM 子網及未占用位址，將位址填入 `.env` 的 `CFT_IPV4`，再執行：

```sh
docker compose -f compose.yaml -f compose.static-ip.yaml config --quiet
docker compose -f compose.yaml -f compose.static-ip.yaml up -d --build
```

不提供預設 IP，避免占用既有服務位址或與未知子網衝突。之後維護同一部署時，沿用相同的兩個 `-f` 參數。

## 帳號與資料

- 帳號名稱：3～16 個 Unicode 字母、數字或底線；密碼：8～128 個字元（目前介面輸入上限為 64）。
- 帳號密碼使用 Node.js scrypt 加鹽雜湊；登入使用 30 天 HttpOnly、SameSite=Strict Cookie。可設定 Google OAuth 登入／綁定（見 [GOOGLE_AUTH.md](GOOGLE_AUTH.md)）；尚無自助密碼重設。
- 註冊、登入、存檔、暱稱、好友、邀請、房間及排行榜改用本站 PostgreSQL。原站 Firebase 帳號無法登入；沒有其管理權限及資料匯出，無法自動搬移帳號或存檔。
- 保留原本 v3 存檔格式，以 JSONB 儲存集合、升級及統計，並以 revision 防止並行更新覆蓋。原本的離線副本與跨裝置合併保留。
- 訪客不建立伺服器存檔。登出前會嘗試立即同步；網路中斷時仍保留瀏覽器副本。關閉分頁的傳輸無法保證送達，應留意介面同步狀態。
- 房間最多 4 人，操作在資料庫交易中檢查；房主失去心跳超過 90 秒後，後續房間操作會清理房間。閒置房間另有定期清理。
- 帳號刪除會先驗證密碼，再以單一交易清理存檔、暱稱、好友、邀請及排行榜資料；刪除不可復原。
- 管理員預設為空。需要時將自己使用者的 `users.id` 放入 `.env` 的 `ADMIN_USER_IDS`，以逗號分隔，再重建 API container。前端按鈕與 API 權限都依登入者的管理員資格判斷。

## 資料表

| 資料表 | 用途 |
|---|---|
| users、sessions | 帳號、密碼雜湊、登入 session 雜湊 |
| saves | 私人存檔、封鎖標記、revision |
| names、profiles | 唯一暱稱、公眾檔案 |
| friendships、presence、invitations | 好友、上線狀態、邀請 |
| rooms | 房間成員、租約、WebRTC 協商佇列 |
| runs | 伺服器記錄的開始時間 |
| leaderboard_entries、leaderboard_summaries | 成績、由伺服器重建的 top 50 |
| reports | 排行榜檢舉 |
| security_limits | 註冊／TURN 全站每小時計數，不透過一般文件 API 對玩家公開 |

即時通知採 HTTP 輪詢：一般文件約 3 秒，房間資料約 2 秒，協商佇列約 0.5 秒。遊戲幀不經資料庫傳送。交易使用短期 advisory lock 確保跨文件操作原子性；這是小型自架部署的簡單方案，大規模流量需另行量測及改良。

排行榜會驗證登入者、房間成員、時間上限及封鎖狀態，但遊戲與獎勵仍由客戶端模擬，並非完整的伺服器權威反作弊系統。

## 更新、備份與停止

一般更新：`docker compose build --pull`，再依上述方式執行 db-init 與重新建立服務。`--pull` 用於避免沿用舊 base image；PostgreSQL 映像另使用 `docker compose pull postgres` 更新同一主版本的修補版，更新前先備份。部署者仍須掃描最終映像並記錄 digest。

Docker 內以 `node tools/build.js --plain --sin-seo` 重建遊戲入口，再執行 `node tools/security-headers.js`，產生僅允許部署 HTML 既有 inline script hash 的 CSP。不使用 `unsafe-inline`／`unsafe-eval` 放行腳本；既有行內樣式仍保留 style 的 `unsafe-inline`。Nginx 的 API location 明確引入相同標頭，避免繼承被覆蓋。一般建置已移除 npx 壓縮／混淆下載路線。

備份資料庫範例（在支援二進位重導向的 shell 中執行）：

```sh
docker compose exec -T postgres pg_dump -U pokesurvivor -d pokesurvivor --format=plain > backup.sql
```

請妥善保護備份，內含帳號及存檔資料。停止服務使用 `docker compose down`，會保留 volume。不要加上 `-v`，否則資料庫 volume 會遭刪除。

## 開發與驗證

```sh
cd server
npm ci
npm run check
npm test
npm audit
```

測試透過 PGlite（僅 devDependency）執行 PostgreSQL WASM 引擎中的真實 schema、SQL 與 HTTP API；不會連接正式資料庫。正式部署仍使用 PostgreSQL 17 container，必須另行驗證 Docker 啟動、持久化及 TURN 跨網路連線。

本機開發 API 可設定 `DATABASE_URL`，或 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`；先以初始化帳號執行 `npm run db:init`，再以受限 runtime 帳號設定 `APP_ORIGIN`、`API_PROXY_SECRET` 後執行 `npm start`。前端必須透過符合上述代理驗證的同源反向代理轉送 `/api/`。API 啟動會拒絕落後於已查詢基線的 Node 22／24／26（分別至少需 22.23.2／24.18.1／26.5.1）；請使用部署當時最新受支援安全修補版，這個最低版本不代表永久無漏洞。

中文名稱與翻譯重建方式見 [LOCALIZATION.md](LOCALIZATION.md)。

安全修正與仍需實機驗收的項目見 [SECURITY_REVIEW.md](SECURITY_REVIEW.md)；回滾步驟見 [ROLLBACK.md](ROLLBACK.md)；Google OAuth 與原站資料限制見 [GOOGLE_AUTH.md](GOOGLE_AUTH.md)。通過功能測試不代表所有部署面安全檢查都已完成。

## Docker Desktop 部署

使用 Docker Desktop for Mac 的 Linux containers，Docker Compose 至少 2.33.1。Intel 與 Apple Silicon 使用相同 Compose，不設定 `platform: linux/amd64`，讓 Node／Nginx／PostgreSQL 官方映像選擇對應架構。啟動 Docker Desktop 後，在專案目錄執行：

```sh
docker compose version
docker network inspect cloudflared
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 db-init api pokesurvivor-web
```

`cloudflared` 外部網路須已存在，Tunnel connector 在同一台 Docker Engine 的該網路內；若沒有，建立網路後也要把 connector 加入。macOS 主機直接執行的 cloudflared 不屬於此 Docker 網路拓撲。Tunnel origin 使用 Compose 服務名稱，不必追蹤容器 IP。

設定 Docker Desktop 在登入時啟動；`restart: unless-stopped` 才能在 Docker Engine 啟動後恢復服務。主機睡眠、登出或 Docker Desktop 未運行時，網站仍可能無法服務。現有 `.env` 搬機時安全另行複製，勿覆蓋既有 PostgreSQL volume 的密碼。部署主機上的映像建置、Nginx runtime、持久化及 CFT／TURN 仍需實機驗收。

代理網路腳本的開發測試（需要 Linux shell 與 awk）：

```sh
python3 tools/test_proxy_network.py
```

舊 `.env` 若仍留有 `CLOUDFLARED_TRUSTED_PROXY`，新版 Compose／API 不再讀取，可移除；不需改動既有密碼或 Token。

## 網站重啟：BusyBox 路由輸出相容性

若 web 日誌在 `25-trusted-proxies.sh` 出現 `proxy_trust: expected one cloudflared gateway with private connected subnet`，舊腳本可能要求了 Alpine BusyBox 不會輸出的 `proto kernel` 欄位。新版以閘道介面、無中繼 via、IPv4 link scope 與私有 CIDR 驗證，不再依賴該文字；並提供較具體的失敗訊息。這個錯誤本身不代表容器沒有設定 cloudflared 網路。

更新 `deployment/25-trusted-proxies.sh` 後，只重建網站服務：

```sh
docker compose up -d --build --no-deps --force-recreate pokesurvivor-web
docker compose ps
docker compose logs --tail=40 pokesurvivor-web
```

預期出現 `proxy_trust: cloudflared network configured` 與 Nginx 正常啟動，容器稍後為 healthy；不需改 Token、HTTP_PORT 或資料庫，也不要刪除 volume。如果仍有錯誤，保留新的具體錯誤訊息再排查，不要改成全網信任。

格式差異依據：[BusyBox iproute 原始碼](https://github.com/mirror/busybox/blob/master/networking/libiproute/iproute.c) 的路由顯示實作未輸出 proto kernel。修正已用此格式回歸與真實 Linux 路由驗證，部署後的實際 Nginx／Tunnel 恢復仍須在重建後確認。

活動機率表、一次性全帳號 SQL 配發與拉霸文字解析度說明見 [GAME_CONFIG.md](GAME_CONFIG.md)。本次不新增配發資料表或領獎 API。

多人連線的等待時間、發證限額、診斷日誌與驗收方式請見 [MULTIPLAYER.md](MULTIPLAYER.md)。

## 帳號與好友代碼升級

新版需由 db-init 建立兩個帳號私有表並授權 API；既有使用者、存檔與好友保留。升級步驟、暱稱與代碼規則見 [帳號文件](ACCOUNT_NICKNAME_PLAN.md)。請同時發布前後端並重新載入舊分頁；不要刪除資料卷。

## 3.0.0部署注意

Node.js22.23.4及NGINX1.30.6固定官方多架構digest，含Apple Silicon使用的arm64；見[容器安全檢查](CONTAINER_SECURITY_2026-10-23.md)。升級前備份資料庫，離峰部署，所有玩家需更新；更新器會結束正在進行的場次。[存檔相容與回滾](SHOP_AND_MULTIPLAYER_3.md)。本次沒有SQL migration，不重設排行榜。
