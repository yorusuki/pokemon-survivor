# 原作更新審查流程

## 原則

原作來源固定為 [JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor)。只取得與比較更新，不自動合併、改數值、重設排行榜或執行下載的程式。Firebase 專屬變更不移植；混合提交中的玩法另行評估。每次先呈現差異及相依關係，由維護者選擇後才實作。

本分支 PostgreSQL、OAuth、Docker、Cloudflare、繁中、最愛、紀念名稱與生命寶珠為需保留的分歧。2.2.0已依使用者決定採用審查版物特、防禦、支援與制裁規則；未來更新仍先比較再決策。選擇跟隨原作不代表直接覆蓋整個檔案。

## 執行檢查

需要 Python 3.10 以上、Git 與讀取公開原作的網路連線，不需要 GitHub token。

```sh
python tools/upstream_review.py --fetch
```

工具下載至已忽略的 `tools/cache/upstream.git` bare repository，不新增本專案 remote、不 checkout、不 merge、不 cherry-pick，也不改目前分支或資料庫。首次下載可能較久，後續重用快取。只讀快取重跑：

```sh
python tools/upstream_review.py
python -m unittest discover -s tools -p test_upstream_review.py
```

結果位於 `tools/cache/upstream-review/`：

| 檔案 | 用途 |
|---|---|
| report.md | 提交清單、逐檔分類及與本分支的文字比對 |
| report.json | 完整 SHA、檢查時間與結構化結果，可供後續排程讀取 |
| upstream.patch | 固定基準到原作最新的來源差異，僅供閱讀，禁止直接整份套用 |

工具採最近 200 個提交的歷史；若基準不在該歷史或已非祖先，明確失敗，不自行更換基準。網路、Git 或輸入錯誤會回傳非零結束碼。產生檔標記為重建，Firebase 規則標記略過，資料庫介面標記人工拆分；其他檔案仍需語意審查，文字一致不代表功能已完整移植。

## 版本狀態與人工決策

追蹤狀態放在 [upstream-sync-state.json](upstream-sync-state.json)：

- `initialBaseline`：固定原作比較基準，不隨檢查移動。
- `reviewedThrough`：已完成所有項目決策的原作提交，不表示其中全部已移植。
- `lastInspected`：最近人工閱讀並產生審查報告的提交。
- `decisionStatus`：目前是否仍在等待選擇。

工具不會自動推進這些狀態。人工將新報告整理至 `docs/UPSTREAM_REVIEW_YYYY-MM-DD.md`，為每項標記「待決定／採用／部分採用／略過／已實作」，並記錄對應本分支提交與未完成相依。只有全部項目有決策後才推進 `reviewedThrough`；尚未實作的已採用項目繼續保留在報告待辦，不能因下一次檢查而消失。

實作時另開分支，依功能移植來源、補翻譯與測試，再更新每日 CHANGELOG 與原作比較表。資料遷移、排行榜換代及大幅數值變更另行確認。原作比較表仍比較固定初始與目前，不寫入未採用功能。

## 自動化界線

目前提供的是可重跑的命令，**尚未建立定時排程**。可由 CI 或排程執行同一指令、保存輸出，再由人審查；不讓排程自動推送程式、修改基準、刪除資料或部署。若要後續排程，需另外決定檢查頻率與通知位置。

本次決策結果見 [2026-10-19 審查](UPSTREAM_REVIEW_2026-10-19.md)。此流程不影響遊戲執行，不需要重建容器才能使用檢查工具。

803125d 已依決策整合至2.3.0；見 [新增審查結果](UPSTREAM_REVIEW_2026-10-19_803125d.md) 與 [招式數據](MOVE_POOL_EXPANSION.md)。
