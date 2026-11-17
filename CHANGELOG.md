# 快送 · 更新記錄

## v2.3.1 — 2026-11-18
- 由單檔 `快送.html` 重構為完整多檔案 PWA repo：
  - `css/styles.css`、`js/config.js`、`js/utils.js`、`js/speech.js`、`js/pwa.js`、`js/app.js`
  - `manifest.webmanifest`、`sw.js`、`offline.html`、完整 icons
  - `Dockerfile`、`nginx.conf`、`.dockerignore`、`render.yaml`
- 新增 Service Worker：app shell 快取、導航 network-first、靜態資源 cache-first、舊 cache 清理。
- 新增系統通知：Service Worker `showNotification`，點擊通知會聚焦現有視窗並開啟通知中心。
- 保留原有 localStorage key：`ks_db_v2`、`ks_session_v2`、`ks_channel_v2`。
- 角色用語統一為「出貨人／接貨人」。
- 修正 Render Docker 部署：提供根目錄 `Dockerfile`，解決 `open Dockerfile: no such file or directory`。
- 新增 README／部署說明／版本更新清單。

## v2.3 — 2026-11-18
- 移除驗證碼，電話號碼直接登入。
- 配對前電話遮罩；配對成功後彈出雙方資料。
- 出貨人定價或司機開價；雙方議價，出貨人最後揀人。
- 三種運力（步兵 10kg／私家車／貨van）都包上樓；上樓預設加一小時泊車費 $20，隧道／停車另議。
- 語音播報、通知中心、桌面通知、版本自動更新（保留舊資料）。
- 修正「路邊交收」舊文案，改為包上樓。

## v2.2 及之前
- 單檔原型：三種送法、路邊交交、電話登入、語音、通知、自動更新。
