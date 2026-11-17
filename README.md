# 快送 v2.3.1 · 香港貨運配對網頁（原型）

「快送」是一個獨立於「的道」的貨運配對網頁原型：出貨人用手機號登入、出單；接貨人（步兵／私家車／貨van）登記後接單、開價；雙方議價，最後由出貨人揀邊個送。平台費 **HK$0**，平台唔代收、唔墊付，車費同附加費由雙方直接交收。

> 這是一版可以直接放上網試用的前端原型，資料只存在使用者自己部機嘅瀏覽器（localStorage），唔係正式多人即時平台。真營運需要後端、帳號驗證、地圖、司機認證同保險安排。

---

## 三種送法

| 運力 | 限制 | 隧道／停車 | 上樓 |
| --- | --- | --- | --- |
| 步兵 | 貨重 10kg 內 | 行路／搭車，冇隧道費 | 可以上樓 |
| 私家車 | 一般件、文件、生果等 | 隧道費、停車場費另議 | 可以上樓 |
| 貨van | 大件、多箱 | 隧道費、停車場費另計 | 可以上樓 |

**上樓規則（v2.3.1 已更正）**：三種送法都包上樓，唔再只做路邊交收。上樓要加一小時泊車費，一般 **HK$20**；完成交收時司機可以按實際泊車費修改。隧道費、停車場費仍然另議／另計，唔包喺協定車費入面。

---

## 主要功能

- 手機號碼直接登入，**冇驗證碼**（示範版；正式版必須加 SMS OTP）。
- 出貨人出單：可自己定價，或等接貨人開價；兩種模式都可以雙方議價。
- 接貨人可接單、開價、還價、撤回；出貨人可以接受、拒絕、揀人。
- **成交前電話遮罩**（例：`9123 ****`）；成交後自動彈出雙方姓名、電話、車牌、協定價、提貨時間、送達時限、上樓／隧道／停車附加費，可直接 `tel:` 致電。
- 提貨碼／交收碼；完成交收可輸入隧道費、停車場費、上樓泊車費，計出實收總額。
- 語音播報（粵語 `speechSynthesis`）＋通知中心＋瀏覽器桌面通知；有新單、新出價、還價、接受、拒絕、撤回、取消、完成都會通知。
- 版本自動更新：登入頁偵測到新版本會自動 reload 一次；已登入會顯示「有新版本」bar，一撳更新；更新會保留舊訂單、舊帳戶、旧通知。
- 獨立資料庫 key：`ks_db_v2`、`ks_session_v2`、`ks_channel_v2`；唔會影響「的道」。

---

## 示範帳號

任何 8 位香港手機號（4–9 字頭）都可以登入。示範資料預設：

- 出貨人：`91234567`（陳記果欄）
- 接貨人：`91230000`（阿強／私家車）、`97770000`（阿明／步兵）、`98765432`（阿強二／私家車）

想試完整流程：開兩個瀏覽器視窗（唔好複製分頁），一個登入出貨人、一個登入接貨人。

---

## 部署到 GitHub Pages（免費）

1. 登入 GitHub，開一個 **Public** repository，例如 `Superfast`。
2. 在 repository 根目錄上傳以下三個檔案：
   - `index.html`
   - `README.md`
   - `.nojekyll`（空檔案；Windows 預設可能隱藏，請確認有上傳）
3. Commit changes。
4. 入 **Settings → Pages**：
   - **Build and deployment → Source**：`Deploy from a branch`
   - **Branch**：`main`
   - **Folder**：`/(root)`
   - 按 **Save**
5. 等 1–2 分鐘，網址會係：
   `https://<你的GitHub用戶名>.github.io/<repo名>/`
   例如 `https://Ethanchan8712.github.io/Superfast/`

### 用命令上傳（可選）

```bash
git init
git add index.html README.md .nojekyll
git commit -m "快送 v2.3.1"
git branch -M main
git remote add origin https://github.com/<你的用戶名>/<repo名>.git
git push -u origin main
```

### 更新版本（保留舊資料）

1. 改 `index.html` 內三個版本標記，令瀏覽器知道有新版本：
   - `<meta name="app-version" content="2.4.0">`
   - `const APP_VERSION = '2.4.0';`
   - `const APP_VER_TAG = 'v2.4.0';`
2. 上傳覆蓋 `index.html`。
3. 已開啟的頁面：登入頁會自動 reload 一次；已登入會顯示更新 bar。資料保留在 `ks_db_v2`，唔會因為更新而清走。
4. GitHub Pages 可能快取幾分鐘；重新整理一次通常會見到新版。

> 自動更新只適用於 `http://` 或 `https://` 網址；直接雙擊本機 `index.html`（`file://`）不會檢查更新。

---

## 部署到 Render（免費 Static Site）

**不要用 Web Service / Docker**。之前失敗訊息 `failed to read dockerfile: open Dockerfile: no such file or directory`，就是因為選了 Docker 但 repo 冇 `Dockerfile`。

正確做法：

1. Render Dashboard → **New → Static Site**
2. 連接 GitHub repo，Branch 選 `main`
3. **Build Command** 留空
4. **Publish Directory** 填 `.`
5. Create Static Site

Render 會產生一個 `https://<name>.onrender.com` 網址，免費方案就夠試用。

---

## 本機測試同限制

直接雙擊 `index.html` 可以試大部分功能，但：

- **自動更新**：`file://` 下會停用；要放上 GitHub Pages／Render 才有效。
- **桌面通知**：需要 `https://` 或 `localhost`，而且要按瀏覽器「允許通知」；頁面關閉後不會推送（這版冇 Service Worker／Push）。
- **語音播報**：瀏覽器要求先有使用者點擊（例如登入）才准出聲；iOS 可能要先解鎖音訊。
- **資料同步**：localStorage 只存在同一個瀏覽器、同一個網域；不同裝置、不同瀏覽器不會同步。清理網站資料會清走訂單。
- **電話直登**：示範版冇 SMS OTP，唔可以當正式身份驗證。
- **金錢**：平台唔代收、唔墊付；代購要先收錢，或交收完成後才安排運輸。
- **貨物**：只接封箱或一眼睇得出嘅貨；違禁品、易碎／貴重物品要雙方事先講清；司機自負牌照、保險同貨物賠償責任。

---

## 檔案

- `index.html` — 完整單檔網頁（CSS／JS 全部內聯，冇外部依賴）
- `README.md` — 本說明
- `.nojekyll` — 告訴 GitHub Pages 不要用 Jekyll 處理，避免檔案被忽略
