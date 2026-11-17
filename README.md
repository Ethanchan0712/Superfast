# 快送 · 香港貨運配對（PWA + Node 後端）

> 三種送法，價啱就接。步兵、私家車、貨van；出貨人定價或司機開價，雙方議價，平台費 $0。

「快送」是一個**獨立於「的道」**的貨運配對網頁 App。角色只有兩個：**出貨人**（出單、定價、揀司機）同**接貨人**（接單、開價、送貨）。呢個 repo 係 v2.4.0，包含：

- 前端 PWA（可安裝、可離線開啟）
- Node 後端（共用訂單狀態、即時同步、Web Push）
- Docker 部署（Render / 任何支援 Docker 嘅主機）

---

## 1. 版本與目錄

- 版本：`v2.4.0`
- 前端入口：`index.html`
- 後端入口：`server/server.js`
- 本機資料：`server/data/state.json`、`server/data/vapid.json`（執行時自動生成，**唔會**入 GitHub）
- 前端本機資料：`localStorage` key `ks_db_v2`、`ks_session_v2`、`ks_channel_v2`

```
快送-app/
├─ index.html
├─ manifest.webmanifest
├─ sw.js
├─ offline.html
├─ robots.txt
├─ css/styles.css
├─ js/config.js / utils.js / speech.js / pwa.js / app.js
├─ icons/
├─ server/server.js
├─ package.json / package-lock.json
├─ Dockerfile / .dockerignore
├─ render.yaml
└─ nginx.conf（只供純靜態主機用，Docker 版唔使用）
```

---

## 2. 功能

### 出貨人
- 電話號碼直接登入，**冇驗證碼**（示範版）
- 出單：提貨／送達地區、地址、時段、貨物、重量、件數、收貨人
- 價錢兩種：**自己定價** 或 **等司機開價**
- 三種運力：**步兵（限 10kg）／私家車／貨van**
- 三種都**包上樓**：預設加一小時泊車費 **$20**，完成交收可按實際改
- 隧道、停車場另議或另計；上樓費用由雙方直接傾
- 睇司機出價、還價、接受、拒絕、取消
- **配對成功先彈出雙方電話同資料**；配對前只顯示遮罩電話

### 接貨人
- 電話號碼直接登入，**冇驗證碼**（示範版）
- 登入即上線，**接單數目無上限**
- 只見到同自己送貨方式一樣嘅單（步兵／私家車／貨van）
- 可以直接接單、出價、還價、拒接、取消
- 長期登入：關閉瀏覽器／手機 App 後再開，仍然保持登入
- 有新單即時收到：大廳新卡、語音播報、通知中心、Web Push（瀏覽器/手機系統通知）

### 共用
- 所有裝置共用同一份訂單狀態（Node 後端）
- SSE 即時同步：出貨人一出單，其他在線接貨人即刻收到
- Web Push：即使 App 喺背景，裝置仍可收到新單／出價／配對通知
- 通知中心：未讀數、逐條記錄
- 版本自動更新：有新版本會自動重新載入，**保留登入同訂單**
- PWA：可加入主畫面；離線時可開 app shell
- 平台費 **$0**；平台唔代收、唔墊付

---

## 3. 本機運行（最簡單）

需要 Node.js 20 或以上。

```bash
cd 快送-app
npm install
npm start
```

打開 `http://localhost:8080`。

- 同一 Wi-Fi 嘅手機可以用 `http://<你電腦 IP>:8080` 測試（但 Web Push 需要 HTTPS 或 localhost）
- 資料會寫入 `server/data/state.json`
- 預設 VAPID key 會生成喺 `server/data/vapid.json`

### 示範帳號
| 角色 | 電話 | 名稱 |
| --- | --- | --- |
| 出貨人 | `91234567` | 陳記果欄 |
| 接貨人（步兵） | `97770000` | 阿明 |
| 接貨人（私家車） | `91230000` | 阿強 |
| 接貨人（私家車） | `98765432` | 阿強二 |

任何 8 位、4–9 字頭香港手機號都可以登入。

---

## 4. 部署上網

### 方法 A：Render Web Service（Docker，建議）
1. 把整個 repo 上傳 GitHub（**一定要有根目錄 `Dockerfile`**）。
2. Render → New → Web Service → 選 GitHub repo。
3. Runtime 選 **Docker**。
4. Dockerfile Path：`./Dockerfile`；Docker Context：`.`。
5. Plan 選 Free；Create Web Service。
6. 等 build 完成，開 Render 提供嘅 `https://xxx.onrender.com`。

注意：
- Render 免費服務會**睡眠**，第一次打開可能慢 30–60 秒；睡眠期間 Web Push 可能延遲。
- Render 免費服務**冇持久磁碟**，重新部署／重啟有機會清空 `state.json`。要正式營運，請加 Persistent Disk（`/data`）或改用 PostgreSQL / Supabase。
- 呢個 repo 嘅 `DATA_DIR=/data` 已經預留俾 Persistent Disk。

### 方法 B：其他 Docker 主機
```bash
docker build -t kuaisong .
docker run -d -p 8080:8080 -v kuaisong-data:/data -e PORT=8080 kuaisong
```

### 方法 C：純靜態（GitHub Pages / Netlify / Cloudflare Pages）
- 只上傳前端檔案（index、css、js、icons、manifest、sw、offline）。
- 可以開 app、出單、本機示範。
- **冇跨裝置同步、冇 Web Push**；因為冇後端。
- 要完整功能，必須用方法 A 或 B。

### 方法 D：Render Static Site
- 只適合睇版面；同上，冇後端同步／推送。

---

## 5. 通知設定

1. 用接貨人電話登入。
2. 按「開啟新單通知」，允許瀏覽器通知。
3. 手機最好「加入主畫面」，用 PWA 方式開；iOS 16.4+ 支援 Web Push（必須加入主畫面）。
4. 出貨人出單後，在線接貨人會即刻收到：
   - 大廳新卡
   - 語音播報（要開語音／手機媒體音量）
   - 通知中心
   - 系統通知（Web Push）

### 收不到通知的檢查
- 必須用**後端版**（Render / Docker / localhost），純 GitHub Pages 冇推送。
- 接貨人必須登入、上線、並且送貨方式同張單一樣（步兵／私家車／貨van）。
- 瀏覽器要允許通知；iOS 要加入主畫面。
- Render 免費服務睡眠時，推送會延遲到服務醒返。
- 同一部電話同一瀏覽器只可以有一個帳號；測試兩個角色要用兩個瀏覽器 / 兩部電話。

---

## 6. 資料與私隱

- 示範版 API **冇登入驗證、冇 OTP、冇權限控制**：任何人有網址都可以讀寫狀態。只適合朋友內部測試，唔好直接當正式平台。
- 正式營運前最少年做：
  - 電話 OTP / SMS 驗證
  - 接貨人身份／牌照／保險證明
  - API rate limit、簽名／工作階段 token
  - 個人資料收集同意、保留期限、刪除機制（香港 PDPO）
  - 禁止品檢查、貨物責任同保險條款
- 平台唔收平台費、唔代收貨款、唔墊付；代購建議先收錢或交收後再安排運輸。
- 接貨人自負牌照、保險同交通法例責任。

---

## 7. 業務規則（已寫入 App）

- 三種運力：步兵 **≤10kg**；私家車；貨van。
- 三種都包上樓；上樓預設加一小時泊車費 **$20**，完成按實際。
- 隧道、停車場另議／另計；貨van 上樓費用由雙方直接傾。
- 出貨人可以定價，接貨人可以開價／還價，最後由出貨人決定。
- 只接**封箱**或**一眼睇清**貨物；唔接禁運品、危險品、非法物品。
- 平台費 **$0**；平台只提供配對，唔係承運人。

---

## 8. 常見問題

**Render 報 `failed to read Dockerfile`**
→ repo 根目錄要有 `Dockerfile`；Dockerfile Path 填 `./Dockerfile`。

**Render 報 `.nojekyll not found`**
→ v2.4.0 嘅 Dockerfile 已經唔再 COPY `.nojekyll`，重新用最新 ZIP。

**出完單，司機收唔到**
→ 確認司機已登入、上線、送貨方式一樣；確認係後端版；睇通知權限。

**重開 App 要再登入**
→ v2.4.0 已經改用 localStorage 長期登入；如果之前用舊版，請重新登入一次。

**資料會唔會唔見**
→ 前端資料存在瀏覽器；後端資料存在 `DATA_DIR/state.json`。Render 免費服務重啟可能清空後端，正式用要加持久碟或資料庫。

---

## 9. 授權 / 名稱

- App 名稱：**快送**
- 與「的道 DidaoHK」完全獨立，唔共用程式、資料、品牌。
- 呢個 repo 係私人原型，未經同意唔好當商業平台營運。
