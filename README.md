# 快送（Quick Send HK）

香港貨運配對網頁：步兵（≤10kg）、私家車、貨van；路邊交收、平台費 $0。
單一 `index.html`，零後端、零資料庫，適合一鍵上載 GitHub Pages。

## 一、上載到 GitHub（唔使裝 Git）

1. 登入 GitHub，撳 **New repository**。
2. Repository name 填 `kuaisiong`（或 `quick-send-hk`），揀 **Public**。
3. **唔好**勾「Add a README file」或「Add .gitignore」——本包已經有。
4. 撳 **Create repository**。
5. 入到 repo，撳 **Add file → Upload files**。
6. 解壓本 ZIP，將 `index.html`、`README.md`、`.nojekyll` 一齊拖入去，撳 **Commit changes**。
   - 如果電腦睇唔到 `.nojekyll`（以點開頭嘅隱藏檔），可以喺 GitHub 撳 **Add file → Create new file**，檔名打 `.nojekyll`，內容留空，再 Commit。
7. 去 **Settings → Pages → Build and deployment**：
   - Source 揀 **Deploy from a branch**
   - Branch 揀 **main**，資料夾揀 **/ (root)**
   - 撳 **Save**
8. 等 1–3 分鐘，網址會係：
   `https://<你嘅GitHub用戶名>.github.io/<repo名>/`

## 二、用 Git 指令上載（可選）

```bash
cd 快送_GitHub上傳包
git init
git add .
git commit -m "快送 v2.3.0"
git branch -M main
git remote add origin https://github.com/<用戶名>/<repo名>.git
git push -u origin main
```

之後去 Settings → Pages 開返 Pages 即可。

## 三、更新版本

1. 改 `index.html` 兩處：
   - `<meta name="app-version" content="2.3.0">`
   - `const APP_VERSION = '2.3.0';`
   （`APP_VER_TAG` 只係畫面顯示，例如 `v2.3`）
2. 重新上載／commit push 覆蓋 `index.html`。
3. GitHub Pages 會自動重新發佈；用戶開住舊版會自動檢查，登入頁自動換新版，已登入會彈「有新版本」，一撳即更新。
4. 更新只換程式，`localStorage` 嘅訂單、帳戶、通知全部保留。

## 已包含功能

- 三種運力：步兵（≤10kg）、私家車、貨van
- 出貨人定價 或 接貨人開價；雙方議價；最後由出貨人揀邊個送
- 電話號碼直接登入（冇驗證碼）
- 接單前電話遮罩；成交後自動彈出雙方聯絡資料
- 語音播報（新單、出價、還價、接受）
- 通知中心＋瀏覽器桌面通知（需用戶允許）
- 路邊交收、提貨碼／交收碼、附加費（隧道／停車／上樓）
- 版本自動檢查與更新提示

## 示範帳號

- 任何 8 位香港手機號（4–9 字頭）即可登入
- 出貨人：9123 4567
- 接貨人：9876 5432

## 重要限制

- GitHub Pages 係**公開網站**，唔好放真實客戶個人資料、密碼或 API key。
- 資料只存喺同一個瀏覽器（localStorage），**唔會跨裝置同步**。要手機同電腦互通，必須加後端（Supabase / Firebase / 自建 API）。
- 語音用瀏覽器 `speechSynthesis`；多數瀏覽器要你先撳過頁面先出聲。
- 桌面通知要用戶按「開啟桌面通知」授權；頁面完全關閉後唔會推播（純靜態冇背景推送）。
- 平台費 $0，平台不代收、不墊付；車費與附加費由司機同貨主線下處理。
- 步兵 10kg 靠申報，冇實際量重。
