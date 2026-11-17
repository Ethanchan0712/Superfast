/************************************************************
 * 快送 · Node 後端
 * - 靜態 PWA
 * - 共用訂單狀態（SSE 即時同步）
 * - Web Push（新單／出價／配對通知）
 *
 * 注意：呢個係示範級後端，冇 OTP、冇付款、冇正式權限控制。
 ************************************************************/
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

let state = { rev: 0, db: null, subs: {}, pushed: {} };
let sseClients = new Set();
let vapid = null;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJSONAtomic(file, value) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
  fs.renameSync(tmp, file);
}

function loadState() {
  ensureDataDir();
  const saved = readJSON(STATE_FILE, null);
  if (saved && typeof saved === 'object') {
    state.rev = Number(saved.rev) || 0;
    state.db = saved.db || null;
    state.subs = saved.subs && typeof saved.subs === 'object' ? saved.subs : {};
    state.pushed = saved.pushed && typeof saved.pushed === 'object' ? saved.pushed : {};
  }
  const savedVapid = readJSON(VAPID_FILE, null);
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else if (savedVapid && savedVapid.publicKey && savedVapid.privateKey) {
    vapid = savedVapid;
  } else {
    vapid = webpush.generateVAPIDKeys();
    writeJSONAtomic(VAPID_FILE, vapid);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:demo@kuaisong.local', vapid.publicKey, vapid.privateKey);
}

function saveState() {
  ensureDataDir();
  writeJSONAtomic(STATE_FILE, state);
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (err) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function normalizePhone(v) {
  const phone = String(v || '').replace(/\D/g, '');
  return /^[4-9]\d{7}$/.test(phone) ? phone : '';
}

function broadcast(rev) {
  const payload = `event: state\ndata: ${JSON.stringify({ rev })}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}

function removeSubscription(phone, endpoint) {
  if (!state.subs[phone]) return;
  state.subs[phone] = state.subs[phone].filter(s => s.endpoint !== endpoint);
  if (!state.subs[phone].length) delete state.subs[phone];
}

async function sendPushToPhone(phone, payload) {
  const subs = state.subs[phone] || [];
  if (!subs.length) return;
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        removeSubscription(phone, sub.endpoint);
      } else {
        console.warn('push failed', phone, err && (err.statusCode || err.message));
      }
    }
  }));
}

function pushNewNotices(previousDB, nextDB) {
  const oldIds = new Set(((previousDB && previousDB.notices) || []).map(n => n.id));
  const fresh = ((nextDB && nextDB.notices) || []).filter(n => n && n.id && !oldIds.has(n.id) && !state.pushed[n.id]);
  const now = Date.now();
  for (const n of fresh) {
    state.pushed[n.id] = now;
    // 只推最近 15 分鐘嘅新通知，避免第一次同步時把舊通知全推
    if (!n.phone || (Number(n.at) || 0) < now - 15 * 60 * 1000) continue;
    const payload = {
      title: n.title || '快送新通知',
      body: n.body || '',
      noticeId: n.id,
      oid: n.oid || null,
      url: './?notice=' + encodeURIComponent(n.id)
    };
    void sendPushToPhone(n.phone, payload);
  }
  // 限制 pushed 記錄大小
  const keys = Object.keys(state.pushed);
  if (keys.length > 5000) {
    const keep = keys.sort((a, b) => state.pushed[b] - state.pushed[a]).slice(0, 4000);
    state.pushed = Object.fromEntries(keep.map(k => [k, state.pushed[k]]));
  }
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, rev: state.rev, pushReady: true, time: Date.now() });
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    return sendJSON(res, 200, { rev: state.rev, db: state.db });
  }

  if (pathname === '/api/state' && req.method === 'PUT') {
    let body;
    try { body = await readBody(req); } catch (err) { return sendJSON(res, 400, { error: err.message }); }
    const next = body && body.db;
    if (!next || !Array.isArray(next.orders) || !next.profiles || typeof next.profiles !== 'object') {
      return sendJSON(res, 400, { error: 'invalid db' });
    }
    const previous = state.db;
    next.schema = next.schema || 3;
    state.db = next;
    state.rev += 1;
    pushNewNotices(previous, next);
    saveState();
    broadcast(state.rev);
    return sendJSON(res, 200, { ok: true, rev: state.rev });
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`retry: 3000\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify({ rev: state.rev })}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 20000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
    return true;
  }

  if (pathname === '/api/push/key' && req.method === 'GET') {
    return sendJSON(res, 200, { publicKey: vapid.publicKey });
  }

  if (pathname === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 128 * 1024); } catch (err) { return sendJSON(res, 400, { error: err.message }); }
    const phone = normalizePhone(body.phone);
    const sub = body.subscription;
    if (!phone || !sub || !sub.endpoint || !sub.keys) return sendJSON(res, 400, { error: 'invalid subscription' });
    const list = state.subs[phone] || [];
    const filtered = list.filter(s => s.endpoint !== sub.endpoint);
    filtered.push(sub);
    state.subs[phone] = filtered;
    saveState();
    return sendJSON(res, 200, { ok: true, count: filtered.length });
  }

  if (pathname === '/api/push/unsubscribe' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 128 * 1024); } catch (err) { return sendJSON(res, 400, { error: err.message }); }
    const phone = normalizePhone(body.phone);
    if (phone && body.endpoint) { removeSubscription(phone, body.endpoint); saveState(); }
    return sendJSON(res, 200, { ok: true });
  }

  return false;
}

function isPublicPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') return true;
  if (/^\/(css|js|icons)\//.test(pathname)) return true;
  return /^\/(manifest\.webmanifest|sw\.js|offline\.html|robots\.txt|\.nojekyll)$/.test(pathname);
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method Not Allowed'); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); return res.end('Bad Request'); }
  if (!isPublicPath(pathname)) { res.writeHead(404); return res.end('Not Found'); }

  let file = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }

  let stat;
  try { stat = await fsp.stat(resolved); } catch (_) {
    // 單頁 fallback，但唔好將 /api 或檔案副檔名錯誤地變 index
    if (path.extname(pathname)) { res.writeHead(404); return res.end('Not Found'); }
    file = path.join(ROOT, 'index.html');
    try { stat = await fsp.stat(file); } catch (e) { res.writeHead(404); return res.end('Not Found'); }
  }
  if (stat.isDirectory()) {
    file = path.join(file, 'index.html');
    try { stat = await fsp.stat(file); } catch (e) { res.writeHead(404); return res.end('Not Found'); }
  }

  const ext = path.extname(file).toLowerCase();
  const cache = (ext === '.html' || pathname === '/sw.js')
    ? 'no-cache, no-store, must-revalidate'
    : (ext === '.webmanifest' ? 'public, max-age=3600' : 'public, max-age=604800');
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch (_) { res.writeHead(400); return res.end('Bad Request'); }

  if (url.pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, url);
      if (!handled && !res.headersSent) sendJSON(res, 404, { error: 'not found' });
      return;
    } catch (err) {
      console.error('API error', err);
      if (!res.headersSent) sendJSON(res, 500, { error: 'server error' });
      return;
    }
  }

  await serveStatic(req, res, url);
});

loadState();
server.listen(PORT, () => {
  console.log(`快送 server listening on :${PORT}`);
  console.log(`VAPID public key: ${vapid.publicKey}`);
});
