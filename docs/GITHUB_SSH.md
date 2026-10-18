# 版本下載與更新

公開儲存庫可透過 HTTPS clone，下載不需要 SSH 私鑰。私人儲存庫或推送操作則需要自己的權限。

```sh
git clone https://github.com/OWNER/REPOSITORY.git
```

將 OWNER／REPOSITORY 換成實際目標。已包含 `.git` 且設定追蹤分支的專案，可在部署目錄依序更新；每步成功後才執行下一步：

```sh
git pull --ff-only
docker compose config --quiet
docker compose up -d --build
```

出現合併衝突時，先停止部署，不要強制重設。GitHub Download ZIP 不包含 `.git`，不能直接 pull。

保留 `.env` 與資料庫 volume；私鑰、Token 及備份不得提交。程式碼版本不能代替資料庫備份。

## 選配私鑰檢查

```sh
git config --local core.hooksPath .githooks
```

hooks 檢查索引與將推送的提交，發現常見私鑰標頭便停止，只列出檔名。這是防誤操作措施，不能取代完整 secret scanning，亦可被刻意略過。首次推送需掃描較多提交。

SSH 身分與金鑰路徑由各開發者自行設定，不隨儲存庫發佈；跨電腦複製含 `.git` 的目錄時，應重新檢查 `.git/config`。
