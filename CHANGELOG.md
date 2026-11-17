# 快送 · 更新記錄

## v2.4.0 — 2026-11-18
### 新增
- **Node 後端** `server/server.js`：共用訂單狀態，所有裝置讀寫同一份資料。
- **SSE 即時同步** `/api/events`：出貨人出單／司機出價／接受，其他在線裝置即刻更新。
- **Web Push** `/api/push/*`：新單、出價、配對通知，關咗 App 都收到（需 HTTPS 或 localhost）。
- **長期登入**：session 改存 `localStorage`，重開瀏覽器／手機 App 仍然登入。
- **新單通知**：大廳即時新卡、語音播報、通知中心、系統通知。
- **自動更新**：登入狀態下都會自動 reload 最新版本，保留 `ks_db_v2`／`ks_session_v2`。
- Docker 改為 Node 20 + `npm ci --omit=dev`，`DATA_DIR=/data`，healthcheck `/api/health`。
- `render.yaml` 改為 Docker Web Service；新增 `.dockerignore`、`.gitignore`。

### 修正
- 修正 Service Worker 誤快取 `/api/state`，導致出價／新單睇唔到。
- 修正遠端快照覆蓋本機新帳戶，登入資料會即時推上後端。
- 修正舊版「路邊交收」文案，統一為「三種都包上樓，上樓加一小時泊車費 $20」。
- 修正 Render Docker build：根目錄 Dockerfile、唔再 COPY `.nojekyll`。

### 已知限制
- 示範級 API，冇 OTP／權限控制，唔好直接公開營運。
- Render 免費服務會睡眠、冇持久磁碟，重啟可能清空資料。
- 純靜態部署（GitHub Pages）冇跨裝置同步／推送。
- Web Push 需要 HTTPS 或 localhost；iOS 要加入主畫面。

## v2.3.1 — 2026-11-18
- 由單檔 `快送.html` 重構為多檔案 PWA repo。
- 新增 Service Worker、manifest、offline、icons、Dockerfile、nginx.conf。
- 修正 Render Docker `open Dockerfile: no such file or directory`。

## v2.3 — 2026-11-18
- 移除驗證碼，電話號碼直接登入。
- 配對前電話遮罩；配對成功後彈出雙方資料。
- 出貨人定價或司機開價；雙方議價，出貨人最後揀人。
- 三種運力（步兵 10kg／私家車／貨van）都包上樓；上樓預設加一小時泊車費 $20。
- 語音播報、通知中心、桌面通知、版本自動更新。

## v2.2 及之前
- 單檔原型：三種送法、電話登入、語音、通知、自動更新。
