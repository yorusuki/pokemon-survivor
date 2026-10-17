# 舊 Firebase 部署路線已替換

此自架版本不再載入 Firebase SDK，也不連接原作 Firebase 專案。帳號、存檔、好友、排行榜與合作房間改由 Node.js API 及 PostgreSQL 提供。

請改依 [SELF_HOSTING.md](SELF_HOSTING.md)部署，並參考 [API.md](API.md)了解資料存取介面。

沒有原 Firebase 管理權限及資料匯出時，無法自動搬移既有帳號與雲端存檔。原站帳號不適用於本站。
