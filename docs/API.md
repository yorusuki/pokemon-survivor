# 自架 HTTP API

所有 API 與前端同源。除健康檢查與 Google GET callback 外都使用 `POST`、`Content-Type: application/json`，並要求 `Origin` 完全符合 `APP_ORIGIN`。沒有開放跨站 CORS。Cookie 為 HttpOnly，前端不讀取 session token。

正式 API 另要求 Nginx 注入的 `X-PS-Proxy-Token` 與有效 `X-PS-Client-IP`；這些是內部代理協定，瀏覽器不用也不應持有 proxy secret。沒有代理 secret 或值錯誤回傳 403 `invalid-proxy`。API 不直接信任 CF／XFF 標頭。每個帳號最多 20 個 session；配額用盡可能回傳 429，記憶體／密碼雜湊工作配額用盡回傳 503 `server-busy`。

成功回傳 JSON，錯誤為 `{"error":"錯誤代碼"}`，並使用對應 HTTP 狀態：400 輸入錯誤、401 未登入、403 權限／Origin 錯誤、404 不存在、409 名稱衝突或 revision 衝突、413 內容過大、429 限流、502 TURN 供應商錯誤、503 TURN 設定不完整。未預期錯誤回傳 500 `internal-error`，不暴露資料庫錯誤及憑證。

## 遊戲活動設定

`POST /api/game-config`，不需登入，body `{}`，仍要求同源 Origin 與 JSON。只回傳非秘密的活動設定，例如：

```json
{"eventBoostEnabled":true,"gachaRates":[[1,40],[2,30],[3,17],[4,6.5],[5,6.5]],"wildShinyRate":0.00048828125,"riftShinyRate":0.025}
```

設定來源為 `GAME_EVENT_BOOST_ENABLED`，程式與操作見 [GAME_CONFIG.md](GAME_CONFIG.md)。沒有配發／領獎 API，人工配發使用 SQL 檔。

## 帳號

| 路徑 | 登入需求 | Request | Response |
|---|---|---|---|
| `GET /api/health` | 僅內部健康檢查 | 無 | `{"ok":true}`，並檢查 DB 連線；Nginx 對外拒絕存取 |
| `/api/auth/session` | 無 | `{}` | `{"user":null}` 或目前使用者 |
| `/api/auth/register` | 無 | `{"name":"Trainer","password":"至少8字元"}` | `{"user":{...}}`，設定登入 Cookie |
| `/api/auth/login` | 無 | 同上 | 同上 |
| `/api/auth/logout` | 有 | `{}` | `{"ok":true}`，撤銷目前 session |
| `/api/auth/delete` | 有 | `{"password":"目前密碼"}` | `{"ok":true}`，交易刪除帳號與關聯資料 |

使用者格式為 `uid`、`displayName`、相容舊前端的內部識別 `email`、`hasPassword`、`providerData`（已綁定時含 `google.com`）與 `isAdmin`。內部 email 由登入名稱編碼而成，不是真實郵件地址，不能寄信或用於找回密碼；Google-only 的 email 為空。

## Google OAuth

| 路徑 | 登入需求 | Request | Response |
|---|---|---|---|
| `POST /api/auth/config` | 無 | `{}` | `{"googleEnabled":true}`，僅公開功能開關 |
| `POST /api/auth/google/start` | login 需未登入；link／delete 需登入 | `{"action":"login","returnTo":"/zh-TW/"}`；link 另加 `password` | `{"url":"https://accounts.google.com/..."}`；設定十分鐘 HttpOnly Lax flow Cookie |
| `GET /api/auth/google/callback` | state＋flow Cookie | Google 提供 `state`、`code` 或 `error` query | 303 到固定結果頁；驗證失敗／取消僅回固定錯誤碼，不洩漏供應商訊息 |
| `POST /api/auth/google/complete` | flow Cookie；link／delete 需原 session | `{"state":"64位hex"}` | `{"ok":true,"returnTo":"/zh-TW/"}`；login 設定 session；delete 另有 `deleted:true,uid` 並撤銷 session |

`action` 僅 login／link／delete，`returnTo` 僅 `/`、`/en/`、`/zh-TW/`。link 驗證目前遊戲密碼；delete 僅 Google-only，重新驗證相同 Google 身分。原密碼帳號（含已綁 Google）繼續使用 `/api/auth/delete`。

錯誤：503 `google-disabled`；400 `google-invalid-state`／`invalid-operation`；401 `auth/invalid-credential`；403 `google-session-changed`／`google-account-mismatch`；409 `google-credential-in-use`／`google-already-linked`／`google-already-signed-in`。callback 不要求 Origin（Google 導回），其餘 POST 維持同源 Origin＋JSON 檢查。完整流程與部署驗收見 [GOOGLE_AUTH.md](GOOGLE_AUTH.md)。

## 文件資料介面

`POST /api/documents`，必須登入。這是既有前端資料呼叫的相容介面；資料實際存入 PostgreSQL 的具名資料表，沒有載入 Firebase SDK 或呼叫其服務。

允許文件路徑：`saves/{uid}`、`profiles/{uid}`、`names/{lower}`、`friendships/{pair}`、`pres/{uid}`、`inv/{to_from}`、`runs/{uid}`、`lb/{board}/e/{entry}`、`lbs/{board}`、`reports/{id}`。沒有任意 SQL、表名或檔案存取介面。

讀取範例：

```json
{"op":"get","path":"saves/使用者UID"}
```

回傳 `{"path":"saves/使用者UID","data":{...},"revision":1}`，不存在時 data 為 null、revision 為 0。私人存檔僅擁有者或管理員可讀，好友與邀請僅相關人可讀，檢舉僅管理員可讀。

查詢範例：

```json
{"op":"query","path":"friendships","filters":[["users","array-contains","使用者UID"]],"order":null,"limit":100,"group":false}
```

回傳 `{"docs":[{"path":"...","data":{...},"revision":1}]}`。filter 支援 `==`、`array-contains`、`in` 及數值比較；最多 5 條 filter、最多 500 筆結果。集合群組查詢僅支援 `group:true,path:"e"` 的排行榜成績。SQL 先限制私人資料，再套用查詢；全部值均透過 SQL 參數傳遞。

寫入／交易範例：

```json
{
  "op":"commit",
  "reads":[{"path":"saves/使用者UID","revision":1}],
  "writes":[{"op":"set","path":"saves/使用者UID","data":{"save":{"coins":500,"tickets":{"t1":0,"t10":0}},"v":3,"updatedAt":{"__serverTimestamp":true}}}]
}
```

`set` 取代文件；`set,merge:true` 合併；`update` 更新存在文件，支援 `names.UID` 形式的欄位路徑；`delete` 刪除。reads 與 writes 各最多 100 項。revision 不符時整筆交易回滾，回傳 409 `conflict`；前端最多重試 5 次。任何一項權限或驗證失敗都回滾，不會回報部分成功。

`{"__serverTimestamp":true}` 由後端轉換成毫秒時間。排行榜開始時間一律由後端填入；成績需符合登入者、時間與隊伍限制。`lbs` 的前端摘要寫入只是舊呼叫相容訊息，不採用客戶端 top 內容；伺服器會從合法成績重建 top 50。

## 合作房間與 WebRTC 協商

`POST /api/rooms`，必須登入。

```json
{"op":"get","path":"rooms/房間ID/m"}
```

回傳 `{"data":{...}}`。支援 `get`、`set`、`update`、`remove`。可操作路徑限房間本身、`host`、`open`、`m/{自己的UID}`、`q/{收件者UID}/{訊息ID}`。

- 建立房間：`set` 房間根節點，data 為 `{host:自己的UID,open:true,m:{自己的UID:{name,dex,shiny,at}}}`。
- 加入：`set rooms/{id}/m/{自己的UID}`，data 為自己的成員資料；伺服器在同一交易中檢查房間是否開放及 4 人上限。
- 退出：`remove` 自己的成員節點；房主可刪除整個房間。
- 協商：`set rooms/{id}/q/{收件者}/{訊息ID}`，data 為 JSON 字串 `{"f":"發送者UID","sig":{...}}`。發送者必須是本人，雙方必須在同房；收件者只能讀取及移除自己的佇列。
- 遊戲狀態透過 WebRTC 傳送，API 不接收遊戲幀作為 Firebase relé 的替代。

## TURN 與排行榜計數

| 路徑 | Request | Response |
|---|---|---|
| `/api/ice-servers` | `{}` | `{turn,iceServers,expiresAt?}`；必須登入，每位使用者每小時最多 10 次 |
| `/api/ranking/count` | `{"board":"s_all2","time":120}` | `{"count":數字}`；計算時間大於指定值的成績 |

TURN 長期 token 只用於後端與 Cloudflare API；前端取得的是短期 ICE 憑證。請勿將短期憑證、Cookie 或密碼寫入 log。


## POST /api/network-events

需登入，同源 JSON。請求範例：`{"event":"failed","reason":"timeout","route":"unknown"}`。
成功：`{"ok":true}`；未登入 401、無效列舉 400、每帳號每分鐘超過 30 次為 429（錯誤格式 `{"error":"..."}`）。
只記錄固定列舉與帳號 ID，不記錄額外請求欄位。此端點為不可信玩家端診斷，非稽核證據。列舉值與操作說明見 [MULTIPLAYER.md](MULTIPLAYER.md)。
