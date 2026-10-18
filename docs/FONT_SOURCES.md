# 字型引用來源

查核日期：2026-10-18。預設字型為俐方體11號／Cubic 11，保留平滑字型選項。

- 作者／專案：[ACh-K/Cubic-11](https://github.com/ACh-K/Cubic-11)。
- 依據：[上游 README](https://github.com/ACh-K/Cubic-11#readme) 說明其為基於 M⁺ gothic 12r 修改與擴充的繁體中文點陣字型，包含臺灣常用字形與標點。
- 授權：上游聲明採 SIL Open Font License 1.1，授權全文見 [上游 OFL.txt](https://github.com/ACh-K/Cubic-11/blob/main/OFL.txt) 與隨附 [Cubic11-OFL.txt](../assets/fonts/Cubic11-OFL.txt)。發布時須一併保留授權檔；遊戲程式與其他素材仍各依原授權。
- 本專案檔案：[Cubic_11.woff2](../assets/fonts/Cubic_11.woff2)，未修改字型內容；不宣稱已驗證其與上游某個版本二進位完全相同。
- SHA-256：`d28e92846e00c3696b30d950d4eddf445dd90b2a970e67cdb629796c1997ef67`。

來源紀錄也由 tools/localize_zh_tw.py 寫入 docs/terminology-zh-TW.json 的 fontSources，包含上游、授權、本地路徑與檔案雜湊，避免下次重建遺失。遊戲法律聲明的第三方內容區亦有上游連結。

未有字型偏好的使用者預設 pixel／Cubic 11；已有明確保存的 smooth 偏好保留，不強制覆蓋。設定仍只存在當前瀏覽器，不改帳號資料。DOM 與 Canvas 共同使用，缺字由後備字型處理，字型由本站供應。
