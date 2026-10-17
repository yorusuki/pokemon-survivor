# 多人連線與排錯

房間上限為 4 人（房主 + 3 位訪客），後端鎖住房間再檢查名額。遊戲資料使用房主中心 WebRTC，網站 API 僅傳遞協商；TURN 為 Cloudflare 託管中繼。

## 本次調整

- WebRTC 協商期限 30 秒，房主失敗後 15 秒重試。
- transport 短暫 disconnected 保留 15 秒，恢復後繼續；failed 或 DataChannel 關閉仍視為失敗。這不是完整的中途重返機制，超時後訪客可能須離開重進，進行中的對局不保證恢復。
- 每位玩家的協商序列化；房主 answer 後補上提前抵達的 ICE candidates。
- 所有訪客連線就緒才能開始。四人同時進房會增加房主頻寬與 CPU，測試通過不代表所有裝置／網路皆可用。
- API 請求預設 15 秒逾時，失敗不自動重送寫入，避免重複操作；輪詢在請求結束後繼續。
- 每帳號 ICE 設定端點 60 次／小時；協商傳送 600 次／分鐘；全站 TURN 發證預設 300 次／小時。既有 .env 若有 TURN_CREDENTIALS_PER_HOUR=60，請自行改成 300 才會套用新值。這是發證額度，不是流量／費用上限。
- Nginx 使用 Docker DNS，每 10 秒更新 API 解析；API 重建仍有短暫服務中斷，無須固定 IP。web 重啟本來就會重新解析。

## 日誌

```sh
docker compose logs -f --tail=100 api pokesurvivor-web
```

API 的 JSON 事件 `multiplayer_network` 包含 userId、peerId（可選的對方帳號 ID）、state、reason、route。事件為玩家端回報，供診斷使用，不可當作可信稽核事實。固定列舉值驗證、需登入、每帳號 30 次／分鐘；瀏覽器最多傳送 20 次／分鐘。不寫入 SDP、候選 IP、憑證、token 或玩家輸入。

玩家瀏覽器開發者工具 Console 可搜尋 `[Net]`，或執行：

```js
G.Net.diagnostics()
```

保留最近 100 筆，關閉／重整頁面即失去。`route` 為 unknown、direct 或 turn；瀏覽器無 selected candidate stats 時維持 unknown，不猜測路徑。API 不通時無法送達伺服器，仍可看瀏覽器紀錄；限流可能省略部分事件。

- connecting：開始協商。
- connected：DataChannel 已開啟。
- route：選用直連／TURN 路徑。
- disconnected / recovered：短暫中斷／恢復。
- failed：timeout、transport、channel、configuration、signaling、send、protocol 或 limit。
- retry：房主重新協商；closed：清理連線。

## 部署與驗收

保留部署用 `.env` 與資料庫，更新程式後執行 `docker compose up -d --build`。

使用四個帳號、至少兩個不同網路測試同時加入、開始遊戲、房主短暫斷網再恢復，以及 TURN route。瀏覽器背景節流、手機鎖屏、主機睡眠、房主離線、TURN 憑證錯誤或限額仍可能使遊戲斷線。未設定 TURN 時僅 STUN，部分 NAT／公司網路無法連線。

自動化測試使用模擬 RTCPeerConnection 驗證時序與清理，不能代替 Safari／Chrome、真實 NAT、TURN 中繼及 實際容器 實機驗收。


## 可以記錄與無法確定的情況

| 情況 | 現有紀錄與限制 |
|---|---|
| 協商逾時、transport 斷線、DataChannel 關閉 | 會記錄 timeout、transport 或 channel；無法單憑結果確定路由器、防火牆或 VPN 是根因 |
| TURN 設定、供應商或限額錯誤 | 玩家端記錄 configuration；供應商拒絕會在 API 請求回傳 turn-provider-error，限額回傳錯誤；目前未將所有預期 HTTP 錯誤額外寫成詳細 API 事件 |
| 網站 API 也無法連線 | 診斷傳送失敗，主要看瀏覽器 [Net] 紀錄；伺服器無法記錄沒收到的事件 |
| 鎖屏、分頁暫停、主機睡眠、瀏覽器崩潰 | 不能保證離線前有機會寫入或送出事件；另一端偵測到斷線時才可能留下紀錄 |
| 高延遲、頻寬不足、遊戲主迴圈卡住 | 尚無定期 RTT／封包遺失統計或遊戲心跳，不能保證即時偵測或直接辨識根因 |

日誌不會自動判斷「公司網路阻擋」或「手機換 Wi-Fi」，必須配合玩家操作時間、另一端紀錄及實機測試。Docker 日誌保存依部署端 log driver 設定，尚未提供集中式永久留存。
