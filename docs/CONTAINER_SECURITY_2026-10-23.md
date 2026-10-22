# 2026-10-23容器與移植安全檢查

## 結果與範圍

Dockerfile的Node建置／API階段與NGINX階段已指定官方修補版及多架構index digest，保留Linux amd64與Apple Silicon所需arm64。PostgreSQL17、自架儲存及既有代理邊界維持不變。

本次沒有連線至實際部署主機，也無法證明部署中的舊容器使用哪個版本。本機Docker Engine未啟動，**未完成容器建置、啟動或容器OS套件掃描**；不能將manifest可取得解讀成已部署成功或映像無任何CVE。

## SEC01：Node.js安全修補（高風險，已修改來源）

- 證據：`Dockerfile`第1、7行原使用浮動`node:22-alpine`，無法由來源確認實際建置是否已含修補。
- 官方2026-10-21發布22.23.4、24.22.1、26.12.1；本專案保留22主版本，選22.23.4以降低跨主版本風險。
- 相關問題包括Brotli越界寫入CVE-2026-111497、DNS NUL輸入CVE-2026-105482、TLS非標準IP驗證CVE-2026-106069等。此為官方公告的適用範圍，未以漏洞利用測試認定本應用可被直接攻擊。
- 修正：`node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`；package及lockfile引擎最低版本同步。
- [Node官方安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、[22.23.4發布說明](https://nodejs.org/en/blog/release/v22.23.4)。

## SEC02：NGINX安全修補（依功能而異，已修改來源）

- 證據：`Dockerfile`網頁階段原使用浮動`nginx:stable-alpine`；部署可能沿用快取，不能僅憑標籤判斷修補狀態。
- 官方列出1.30.6／1.31.7已修補alias與rewrite、變數運算、HTTP/3、TLS session tickets及AIO相關問題（CVE-2026-15176、93479、95101、97629、97205）。NGINX官方對這批列medium；不同產品或評分來源可能不同，不將它們一律宣稱相同高分。
- 現有`deployment/nginx.conf`只監聽HTTP80，未啟用HTTP/3、TLS session tickets、SSI或AIO，也未配置alias；但仍更新，不只依賴未啟用某模組的假設。含變數的代理處理需保持修補版。
- 修正：`nginx:1.30.6-alpine@sha256:c59d1f8b1e0e42da75be973424cd72e23f7f8adfb54e982f4d1cd0216a5a5576`。
- [NGINX官方安全公告與修補範圍](https://nginx.org/en/security_advisories.html)。

## SEC03：新功能輸入與資源邊界（已補強）

- `js/net/protocol.js`：維持256KiB、結構／深度／筆數及有限數字檢查；二進位解碼後仍走同一驗證；觀戰UID需符合格式，主端只採用同隊活玩家。
- `js/net/coop.js`、`js/entities/player.js`、`js/entities/fx.js`：依已批准原作限制狀態範圍、單次升級處理與圓環半徑，避免巨量迴圈。
- `server/shop-policy.js`及`shop-data.json`：驗證庫存、性格、特性槽、物種學習器相容性及第二初始招式格式；仍只寫入本人存檔，不放寬跨帳號文件權限。
- 消耗品加入既有每裝置收支帳本，避免舊存檔將已用掉的物品帶回；這不是伺服器權威反作弊，也不保證兩台離線裝置同時花費同一餘額不會超支。
- 新資料名稱來自原作PokéAPI資料，271個特性繁中名稱與既有官方CSV快取逐一一致；效果文案人工補譯。現有CSP、文字輸出轉義與安全DOM姓名處理保留。

## SEC04：房主移除權限（使用者已批准，已限縮）

`server/index.js`的`roomOperation`僅在操作者為該房間房主、目標為其他成員且操作為remove時允許移除；不能藉此寫入別人成員資料、讀取其訊息或操作其他房間。測試涵蓋一般成員／外人拒絕、房主修改成員拒絕，以及房主移除成功後成員失去讀取權。

## 檢查方式與限制

- 官方Docker Registry以`docker buildx imagetools inspect --raw`取得上述manifest，確認兩者含linux/amd64及linux/arm64；摘要已寫入Dockerfile。
- `npm audit --json`：38項依賴統計，已知漏洞總數0；沒有因本次新增npm依賴。這不涵蓋Node二進位或Alpine OS套件。
- JavaScript檢查、遊戲／API測試、建置、設定及瀏覽器驗證的最終結果見[更新紀錄](../CHANGELOG.md)，只記錄實際完成項目。
- 部署時需重新建置，不是單純restart。可用`docker compose build --pull`再`docker compose up -d`；本次需要所有遊戲客戶端更新。
- 固定digest有利回滾，但不會自動取得日後修補；下一次更新需重新查公告、manifest與測試。部署端應另執行映像掃描及`node --version`、`nginx -v`確認實際容器內容。
