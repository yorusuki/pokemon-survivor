# Google 登入與帳號綁定

更新日期：2026-10-17。已將原本 Firebase Auth 的 Google 登入、綁定與刪除前驗證，接到本站 Node.js／PostgreSQL。尚未使用真實 GCP 憑證驗收。

## GCP 與部署設定

在自己的 GCP 專案建立 OAuth「Web application」client，設定 Google Auth Platform 的品牌、受眾與測試使用者；測試模式通常僅允許列入的測試帳號。以佔位網域 `https://game.example.com` 為例，Authorized redirect URI 必須完整等於：

```text
https://game.example.com/api/auth/google/callback
```

此版本使用後端 authorization code flow，不需 Google 前端 SDK 或 JavaScript origin。Scope 僅 `openid email`；不保存真實 Email、姓名、頭像、access token、ID token 或 refresh token。資料庫只保存 Google 的 `sub` 與本站 UID 對應。

將 `.env.example` 複製為 `.env`，設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`；`GOOGLE_REDIRECT_URI` 必須改成自己的回呼網址，必須與 `APP_ORIGIN` 對應。Secret 只傳入 API。ID／secret 皆空會隱藏 Google 按鈕；部分設定或 callback 不符會拒絕啟動。本機僅允許 localhost／loopback HTTP，其他環境必須 HTTPS。

升級前備份資料庫，依 [部署文件](SELF_HOSTING.md) 重建映像、執行 `db-init`，再重新建立 API／web。只改 `.env` 不會讓既有容器取得新設定。

## 操作與相容性

- 登入頁 →「使用 Google 登入」→ Google 選擇帳號 → 返回遊戲。首次建立獨立本站 UID；再次登入會回到同一 UID 與存檔。預設顯示名稱為隨機 `Trainer_` 名稱，沿用遊戲首次取暱稱流程。
- 既有密碼帳號 → 設定／帳號 →「綁定 Google」→ 輸入目前遊戲密碼 → Google 授權。首次恢復帳號提示亦可進入此流程。成功後 UID、暱稱、存檔保留，密碼登入照常可用；忘記密碼時可用已綁定的 Google 進入同一帳號。
- 一個 Google `sub` 只能綁一個本站帳號，一個本站帳號也只能綁一個 Google。已綁他人或不同 Google 時顯示錯誤；不根據 Email 或暱稱自動合併，也沒有覆蓋綁定或解除綁定功能。
- Google-only 帳號刪除：先確認刪除，再重新導向 Google，取得新的 code／nonce 並驗證相同 `sub`，最後由資料庫交易刪除帳號、存檔與關聯資料。Google 的既有登入狀態可能不要求再次輸入 Google 密碼；此流程不宣稱強制密碼或 MFA。
- 同時有密碼與 Google 的帳號仍輸入遊戲密碼刪除。取消 Google 或選錯帳號不刪除資料。

授權改用整頁導向，不使用原站 popup。綁定／刪除前先同步待存進度，若尚未同步成功會阻止導向。驗證過期、重放、切換 session 或網路失敗會顯示錯誤，需回遊戲重試。

## 安全設計與資料變更

使用 Google 官方 `google-auth-library` 11.3.1，後端交換 code，官方驗證器檢查簽章、issuer、audience、expiry；另檢查 nonce、iat。PKCE S256、隨機 state、十分鐘時限與 HttpOnly Lax 瀏覽器綁定 Cookie 保護流程。原 session 維持 HttpOnly Strict；callback 只保存驗證結果，返回本站結果頁後再同源 POST 完成，避免跨站 callback 丟失 Strict Cookie。綁定／刪除額外綁定原 session hash。

新增 `google_identities`、`oauth_flows`，並允許 `users.password_hash` 為 NULL（Google-only）。原密碼帳號、UID、存檔格式不變。流程包含一次性 code verifier；逾期每分鐘清理，不保存 Google token。兩個新表不開放通用 documents API。

Nginx access log 不含 URI／query，callback location 禁止輸出可能包含 code 的 upstream error log；API 不記錄 SDK 原始錯誤。Cloudflare 端仍須關閉 callback query／body 的額外追蹤記錄，對 `/api/*` 與 `/oauth-result.html` bypass cache。不要把授權回呼網址貼入客服或公開 log。

## 驗證範圍

自動化測試使用隔離 PGlite 資料庫、HTTP API、官方 SDK 真正的 RSA JWT 驗證器；Google code 交換及憑證端使用本機 fixture。涵蓋新舊帳號、綁定／衝突、取消、session 切換、錯誤簽章／aud／iss／exp／nonce／iat、state／Cookie／重放、Google-only 刪除及原密碼路線。這不等同真正 Google consent／網路驗收。

部署後仍需實測：GCP 同意畫面、正式 HTTPS callback、Strict／Lax Cookie 跨站返回、存檔往返、密碼及 Google-only 各一組帳號、錯選帳號／取消、Docker PostgreSQL 權限與重啟持久化。請使用可丟棄的測試帳號測試刪除。

## 原站與 Firebase 資料

[原站程式](https://github.com/JPTER78/pokesurvivor/blob/main/js/core/db.js) 透過 Firebase `signInWithPopup`、`linkWithPopup`、`reauthenticateWithPopup` 完成上述功能。本站是功能移植，沒有連回原站 Firebase。Fork 只有程式碼，不帶原站 Auth／Firestore 管理權限；OAuth client 也不是原站存檔存取憑證。未取得原站管理員授權匯出，因此不建立原站資料匯入或自動合併。

參考：[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)、[Google 官方 SDK](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/google-auth-library-nodejs)。
