# 快送 · 香港貨運配對（PWA）

> 三種送法，價啱就接。步兵、私家車、貨van；出貨人定價或司機開價，雙方議價，平台費 $0。

「快送」是一個**獨立於「的道」**的貨運配對網頁原型。角色只有兩個：**出貨人**（出單、定價、揀司機）同**接貨人**（接單、開價、送貨）。本 repo 係純靜態 PWA，冇後端、冇資料庫、冇金庫，唔會收平台費或代收款。

- 版本：`v2.3.1`
- 入口：`index.html`
- 資料：只存喺使用者瀏覽器嘅 `localStorage`（key：`ks_db_v2`、`ks_session_v2`、`ks_channel_v2`）
- 部署：GitHub Pages / Render Static Site / Render Docker（三選一）

---

## 1. 功能

### 出貨人
- 電話號碼直接登入，**冇驗證碼**（示範版）
- 出單：提貨／送達地區、地址、時段、貨物、重量、件數、收貨人
- 價錢兩種：**自己定價** 或 **等司機開價**
- 三種運力：**步兵（限 10kg）／私家車／貨van**
- 三種都**包上樓**：預設加一小時泊車費 **$20**，完成交收可按實際改
- 隧道、停車場另議或另計；上樓費用由雙方直接傾
- 睇司機出價、還價、接受、拒絕、取消
- 配對成功先彈出雙方電話同資料

### 接貨人
- 電話號碼直接登入，**冇驗證碼**（示範版）
- 登入即可接單，**接單數目無上限**
- 只見到同自己送貨方式一樣嘅單（步兵／私家車／貨van）
- 可以**直接接單**、**出價**、**還價**、拒接、取消
- 接單前只見到遮罩電話；**配對成功後**先見到出貨人電話
- 我的接單、我的報價、設定、規則

### 共同
- **語音播報**：新單／出價／接受／取消／提貨／交收，用粵語讀出
- **通知中心** + 桌面通知（需要使用者授權；背景分頁會用 Service Worker 彈通知）
- **自動更新**：檢查 `app-version`，有新版本顯示更新條；保留 `localStorage` 舊資料
- 離線快取：已載入過嘅頁面／JS／CSS 可以離線再開
- 響應式：手機窄屏優先，桌面兩欄
- 示範登入：任何 **8 位香港手機號（4–9 字頭）**；出貨人 `91234567`、步兵 `97770000`、私家車 `98765432`

---

## 2. 檔案結構

```text
快送-app/
├── index.html                  # 入口（HTML + meta + PWA link）
├── manifest.webmanifest        # PWA manifest（名稱、icon、standalone）
├── sw.js                       # Service Worker（app shell、offline、notificationclick）
├── offline.html                # 離線頁
├── robots.txt                  # 示範站不想被搜尋引擎收錄
├── .nojekyll                   # GitHub Pages 用
├── css/
│   └── styles.css              # 全部樣式（窄屏優先）
├── js/
│   ├── config.js               # 常數、三種運力、地區、貨物、付款方式
│   ├── utils.js                # 格式化、距離、時間、電話遮罩
│   ├── speech.js               # 粵語語音播報
│   ├── pwa.js                  # SW 註冊、系統通知、通知點擊
│   └── app.js                  # 儲存、UI、出單、報價、配對、通知、更新
├── icons/
│   ├── favicon.svg
│   ├── favicon-32.png
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   ├── apple-touch-icon.png
│   ├── og-image.png
│   └── og-icon.png
├── Dockerfile                  # Render Web Service（Docker）用
├── nginx.conf                  # 靜態服務、manifest MIME、sw.js 不快取
├── .dockerignore
├── render.yaml                 # Render Blueprint（可選；Static Site）
├── .gitignore
├── .editorconfig
├── README.md
└── CHANGELOG.md
```

冇 `node_modules`、冇 build step、冇 `.env`。上傳整個資料夾內容即可。

---

## 3. 本機預覽

```bash
cd 快送-app
python3 -m http.server 8080
# 開 http://127.0.0.1:8080/
```

> 唔好直接雙擊 `index.html`：`file://` 之下 ES module 同 Service Worker 會失效。一定要經 HTTP 伺服器。

---

## 4. 部署

### 方法 A：GitHub Pages（最簡單、免費）
1. 開一個新 repo（例如 `kuaisong`），**唔好同「的道」repo 混在一起**。
2. 把 `快送-app/` **入面嘅所有檔案**上傳到 repo **根目錄**：
   - `index.html` 必須在根，唔好變成 `快送-app/index.html` 或 `快送-app/快送-app/index.html`。
3. Settings → Pages → Source：`Deploy from a branch`；Branch：`main`；Folder：`/ (root)`；Save。
4. 等 1–2 分鐘，開 `https://<你的帳號>.github.io/<repo>/`。
5. `.nojekyll` 已經放好，避免 GitHub 用 Jekyll 處理。

### 方法 B：Render Web Service（你原本揀嘅 Docker）
你截圖入面嘅錯誤：
```text
failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
```
意思係 Render 用 **Docker** 建置，但 repo 根目錄冇 `Dockerfile`。唔係代碼壞，係上傳漏檔／路徑唔對。

修正：
1. 確認 repo 根目錄有 `Dockerfile`（同 `index.html` 同一層）。
2. Render → 你的 Web Service → **Settings**：
   - **Environment / Runtime**：`Docker`
   - **Dockerfile Path**：`./Dockerfile`
   - **Docker Context**：`.`（如果檔案在子資料夾，改成該子資料夾，例如 `./快送-app`）
   - **Branch**：`main`
3. Save → **Manual Deploy** → **Clear build cache & deploy**。
4. 健康檢查用 `GET /`，Dockerfile 已內建 `HEALTHCHECK`。

> GitHub 網頁上傳 **ZIP 唔會自動解壓**。要把 ZIP 解壓後，將入面嘅檔案逐個／整個資料夾拖上去，確認根目錄見到 `Dockerfile`。

### 方法 C：Render Static Site（免費、唔用 Docker）
1. Render → **New** → **Static Site**。
2. 連同一個 repo，Branch `main`。
3. **Build Command**：留空。
4. **Publish Directory**：`.`（如果檔案在子資料夾，填 `快送-app`）。
5. Create Static Site。

> 呢個係純靜態 PWA，Static Site 已經夠；Docker 只係為咗繼續用你原本個 Web Service。

### 方法 D：其他靜態主機
Cloudflare Pages／Netlify：Build Command 留空，Output/Publish Directory `.`。冇 server-side route，全部用 hash／前端狀態，唔需要 SPA rewrite。

---

## 5. 業務規則（UI 已寫入）

- 平台費 **$0**；平台唔抽佣、唔代收、唔墊付、唔做中間人。
- 運費、隧道、停車場、上樓泊車費，全部由**出貨人同接貨人直接交收**。
- 步兵限 **10kg**；私家車／貨van 嘅隧道費、停車場費另議或另計。
- **三種都包上樓**；預設加一小時泊車費 **$20**，完成交收按實際調整。唔上樓就冇呢項。
- 本版三種運力都**包上樓**；路邊交收只是其中一種安排，唔代表平台承擔搬運合約責任。
- 貨物要**封箱**或**一眼睇清**；唔收違禁品、危險品、易腐爛而無妥善包裝嘅貨。
- 代購：建議**先收錢**，或者交收完成後才安排運輸；平台不代收。
- 接單前電話遮罩；**配對成功後**才交換雙方資料。
- 司機自負車輛牌照、保險、載貨合規；步兵自負安全運送。

---

## 6. 資料與自動更新

### 資料存放
- `ks_db_v2`：訂單、出價、通知、種子資料
- `ks_session_v2`：登入 session（`sessionStorage`）
- `ks_channel_v2`：跨分頁同步 channel
- 清除瀏覽器資料會回復種子示範單；**唔會**影響伺服器（因為冇伺服器）。

### 更新版本時（重要）
一次過改四個位置，否則使用者可能仍跑舊 cache：

1. `js/config.js`：`APP_VERSION`、`APP_VER_TAG`
2. `index.html`：`<meta name="app-version" content="...">`
3. `sw.js`：`CACHE_VERSION`（例如 `ks-v2.3.2-r1`）
4. `CHANGELOG.md` 加一行

改完重新部署。使用者開 App 時：
- 未登入／冇開 modal：自動 reload 到新版本；
- 已登入／有 modal：顯示「有新版本」更新條，按「立即更新」先 reload；
- `localStorage` 舊訂單會保留。

---

## 7. 已知限制（唔好當成正式交易平台）

- **純前端示範**：所有資料只存在同一部裝置嘅瀏覽器；不同電話、不同裝置之間**唔會真正同步**。要跨裝置派單，必須加後端（例如 Node/Express + SQLite/Postgres）同推送服務。
- **冇真實 SMS 驗證**：示範版任何 8 位香港手機號都可登入。正式上線要加 OTP、防濫用、實名／司機認證。
- **冇支付／托管**：平台不代收、不墊付；如要做代購，需另外接支付商同退款流程。
- **通知受瀏覽器限制**：iOS 要加入主畫面（Add to Home Screen）後才支援 Web Push／通知；Android Chrome 較完整。語音要用使用者手勢啟動，唔會自動播。
- **Service Worker 快取**：更新版必須 bump `CACHE_VERSION`，否則舊 JS 可能被 cache 住。
- **法律／保險**：私營配對、司機自負牌照保險；正式營運前請找香港律師／保險顧問確認載貨、載客、責任同私隱（PDPO）安排。

---

## 8. 快速檢查清單（部署前）

- [ ] repo 根目錄見到 `index.html`、`Dockerfile`、`sw.js`
- [ ] 用 HTTP 開到首頁，兩個角色都登入到
- [ ] 出貨人出單 → 接貨人收到通知 → 開價 → 出貨人接受 → 彈雙方電話
- [ ] 上樓 checkbox 有加到 $20 泊車費
- [ ] 手機同桌面都睇得清；冇白邊、冇字被切
- [ ] 版本三處一致（config／meta／SW cache）
