/* =========================================================
   快送 v2.4 · PWA + 後端同步
   角色：出貨人（出貨人） / 接貨人（步兵、私家車、貨van）
   收費：出貨人定價 或 司機開價，雙方議價，出貨人最後決定
   ========================================================= */

/* ---------- 模組 ---------- */
import { DB_KEY, SESSION_KEY, CHANNEL, APP_VERSION, APP_VER_TAG, UPSTAIRS_FEE, MODES, GOODS, PAYS, DISTRICTS, AREAS } from './config.js';
import { $, pad2, esc, money, num, fmtKm, uid, code4, nowMin, timeToMin, tlab, clockLabel, clock, todayStr, haversine, estKm, meterFare } from './utils.js';
import { speak, unlockSpeech, announceText } from './speech.js';
import { registerServiceWorker, showSystemNotification, listenServiceWorkerMessages } from './pwa.js';


/* ---------- 儲存 ---------- */
let db = null;
let session = null;
let ui = { tab:'new', filter:{mode:'全部', district:'全部', sort:'new'}, draft:null, screen:'login', rolePick:'shipper', modePick:'car', pending:{} };
let lastAnnouncedAt = 0;
let lastNoticeAt = 0;
let typingTimer = null;
let serverMode = false;
let serverRev = 0;
let serverSaveTimer = null;
let pushReady = false;

function migrateDB(d){
  d.schema = 3;
  d.orders = Array.isArray(d.orders) ? d.orders : [];
  d.profiles = d.profiles && typeof d.profiles === 'object' ? d.profiles : {};
  d.notices = Array.isArray(d.notices) ? d.notices : [];
  Object.keys(d.profiles).forEach(k => {
    const p = d.profiles[k];
    if(!p || typeof p !== 'object'){ delete d.profiles[k]; return; }
    p.phone = p.phone || k;
    if(!MODES[p.mode]) p.mode = 'car';
    if(!Array.isArray(p.areas)) p.areas = [];
    if(p.announce === undefined) p.announce = true;
  });
  d.orders.forEach(o => {
    if(!o.pickup) o.pickup = { district:'', addr:'', from:'', to:'' };
    if(!o.drop) o.drop = { district:'', addr:'', deadline:'' };
    if(!o.goods) o.goods = { type:'其他', desc:'', pieces:1 };
    if(!o.consignee) o.consignee = { name:'', phone:'' };
    if(!MODES[o.mode]) o.mode = 'car';
    if(!Array.isArray(o.offers)) o.offers = [];
    if(o.status === 'accepted' && !o.agreedPrice) o.agreedPrice = o.askPrice || 0;
    if(o.status === 'delivered' && !o.finalTotal) o.finalTotal = o.agreedPrice || 0;
  });
  return d;
}
function loadDB(){
  let raw = null;
  try{
    raw = localStorage.getItem(DB_KEY);
    if(raw){
      const d = JSON.parse(raw);
      if(d && Array.isArray(d.orders) && d.profiles) return migrateDB(d);
    }
  }catch(e){
    try{ if(raw) localStorage.setItem(DB_KEY + '_backup_' + Date.now(), raw); }catch(_){}
  }
  return migrateDB({ rev:0, orders:[], profiles:{} });
}
function saveDB(){
  db.schema = 3;
  db.rev = (db.rev || 0) + 1;
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  if(serverMode) queueServerSave();
}
function setSession(phone){
  session = { phone };
  // 長期登入：關閉瀏覽器／手機 App 後仍保留
  const raw = JSON.stringify(session);
  try{ localStorage.setItem(SESSION_KEY, raw); }catch(e){}
  try{ sessionStorage.setItem(SESSION_KEY, raw); }catch(e){}
}
function clearSession(){
  session = null;
  try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
}
function me(){ return session ? db.profiles[session.phone] : null; }
function isTyping(){
  const a = document.activeElement;
  return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
}

/* ---------- 提示 / 彈窗 ---------- */
let toastTimer = null;
function toast(msg, type){
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}
function openModal(html){
  const m = $('#modal');
  m.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
  m.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal(){
  const m = $('#modal');
  m.hidden = true; m.innerHTML = '';
  document.body.style.overflow = '';
}

/* =========================================================
   登入
   ========================================================= */
function renderLogin(){
  const p = { role: ui.rolePick, mode: ui.modePick };
  const driver = ui.rolePick === 'driver';
  $('#app').innerHTML = `
  ${topBar(null)}
  <main class="login">
    <section class="login-hero">
      <div class="kicker">QUICK SEND · 香港</div>
      <h1>三種送法，<br>價啱就接。</h1>
      <p>步兵、私家車、貨van，三種都包上樓。出貨人可以自己定價，或者等司機開價；雙方議價，最後由出貨人揀邊個送。</p>
      <div class="login-points">
        <div class="lp">${icoCheck()} 步兵限 10kg；三種都包上樓，上樓泊車約 $20</div>
        <div class="lp">${icoCheck()} 出貨人定價 或 司機開價，平台唔抽佣</div>
        <div class="lp">${icoCheck()} 司機接單無上限，可以拒接、可以取消</div>
        <div class="lp">${icoCheck()} 一出單即語音播報，其他在線司機即時收到</div>
      </div>
    </section>

    <section class="login-card">
      <h2>用手機號登入</h2>
      <div class="sub">示範版：任何 8 位香港手機號（4–9 字頭）就可以登入，唔使驗證碼。</div>

      <div class="role-cards">
        <button class="role ${ui.rolePick === 'shipper' ? 'on' : ''}" data-act="pickRole" data-role="shipper">
          <b>出貨人</b><span>出單、定價、揀司機</span>
        </button>
        <button class="role ${ui.rolePick === 'driver' ? 'on' : ''}" data-act="pickRole" data-role="driver">
          <b>接貨人</b><span>接單、開價、送貨</span>
        </button>
      </div>

      ${driver ? `
      <div class="field" style="margin-top:12px">
        <label>你用咩送？</label>
        <div class="chips">
          ${Object.keys(MODES).map(k => `<button class="chip ${ui.modePick === k ? 'on' : ''}" data-act="pickMode" data-mode="${k}">${MODES[k].name}${k === 'walk' ? '<small>≤10kg</small>' : ''}</button>`).join('')}
        </div>
        <span class="hint">${MODES[ui.modePick].fee}</span>
      </div>` : ''}

      <div class="field">
        <label>手機號碼</label>
        <input type="tel" inputmode="numeric" maxlength="8" placeholder="9123 4567" data-login="phone" value="${esc(p.phone || '')}">
        <span class="hint">8 位數字，4–9 字頭。示範用 91234567（出貨人）／98765432（接貨人）。</span>
      </div>
      <div class="field">
        <label>稱呼（可留空）</label>
        <input type="text" maxlength="16" placeholder="${driver ? '阿銘' : '陳記果欄'}" data-login="name">
      </div>

      <label class="check agree" data-check="agree">
        <input type="checkbox" checked data-login="agree">
        <span>我同意：《包上樓，上樓加一小時泊車費（一般 $20）》、《貨物要封箱或一眼睇得出》、《平台費 $0、司機自負牌照保險》。</span>
      </label>

      <div class="btn-row" style="margin-top:12px">
        <button class="btn warn block" data-act="login">
          登入做${ui.rolePick === 'shipper' ? '出貨人' : '接貨人'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#12130f" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="login-foot">示範版：電話直登，唔使驗證碼。${serverMode ? '後端版：訂單會同步到伺服器，其他裝置都見到。' : '純靜態版：資料只存喺你部機嘅瀏覽器。'} 唔係真實交易平台。</div>
      <div class="notice calm demo-note">${icoInfo()} 想試完整流程：開兩個瀏覽器視窗（唔好複製分頁），一個登入出貨人、一個登入接貨人。</div>
    </section>
  </main>`;
}

function doLogin(){
  const phone = ($('[data-login="phone"]').value || '').replace(/\D/g, '');
  const name = ($('[data-login="name"]').value || '').trim();
  const agree = $('[data-login="agree"]').checked;
  if(!/^[4-9]\d{7}$/.test(phone)) return toast('請輸入 8 位香港手機號（4–9 字頭）', 'err');
  if(!agree) return toast('要先同意規則', 'err');

  if(!db.profiles[phone]){
    db.profiles[phone] = {
      phone, role: ui.rolePick, name: name || (ui.rolePick === 'shipper' ? '出貨人' : '接貨人'),
      mode: ui.modePick, plate:'', online: ui.rolePick === 'driver', announce:true, areas:[], createdAt: Date.now()
    };
  }else{
    const p = db.profiles[phone];
    p.role = ui.rolePick;
    if(name) p.name = name;
    if(ui.rolePick === 'driver'){
      p.mode = ui.modePick;
      // 接貨人一登入就上線，避免之前關過「上線」之後收唔到新單
      p.online = true;
      p.announce = true;
    }
  }
  saveDB();
  setSession(phone);
  // 登入資料立即推上後端，避免被其他裝置嘅舊快照蓋走
  if(serverMode) pushServerState();
  lastAnnouncedAt = Date.now();
  lastNoticeAt = Date.now();
  ui.tab = ui.rolePick === 'driver' ? 'board' : 'new';
  ui.screen = ui.rolePick;
  ui.draft = null;
  render();
  toast('已登入 · ' + (ui.rolePick === 'driver' ? '接貨人' : '出貨人'), 'ok');
  const profile = db.profiles[phone];
  if(ui.rolePick === 'driver' && profile.announce){
    // 登入本身係使用者手勢，順便解鎖手機語音
    setTimeout(() => speak('快送已登入。有新單會即時播報。'), 250);
  }
  // 登入係手勢：後端版即時請求通知權限（已授權就靜默訂閱）
  if(serverMode) enableServerPush(true);
}

/* ---------- 頂欄 ---------- */
function topBar(p){
  const unread = p ? unreadCount(p.phone) : 0;
  return `
  <header class="top">
    <div class="wrap">
      <div class="top-row">
        <a class="brand" href="javascript:void(0)" data-act="home">
          <span class="brand-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="#12130f" stroke-width="2.2" stroke-linecap="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>
          </span>
          <span class="brand-txt"><b>快送<span class="vtag">${APP_VER_TAG}</span></b><small>包上樓 · 價啱就接</small></span>
        </a>
        <div class="top-right">
          ${p ? `<span class="phone">${esc(p.phone)}</span>
          <button class="icon-btn" data-act="openNotices" title="通知">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e9e3d0" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8M10 20a2 2 0 0 0 4 0"/></svg>
            ${unread ? `<span class="nbadge">${unread > 9 ? '9+' : unread}</span>` : ''}
          </button>
          <button class="icon-btn" data-act="switchRole" title="切換身份">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e9e3d0" stroke-width="2" stroke-linecap="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>
          </button>
          <button class="icon-btn" data-act="help" title="點樣試">?</button>
          <button class="icon-btn" data-act="logout" title="登出">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e9e3d0" stroke-width="2" stroke-linecap="round"><path d="M15 4h4v16h-4M10 12H3M6 8l-3 4 3 4"/></svg>
          </button>` : `<button class="icon-btn" data-act="help" title="點樣試">?</button>`}
        </div>
      </div>
    </div>
    <div class="hazard"></div>
  </header>`;
}
function pageHead(kicker, title, sub, p, roleLabel){
  return `<div class="page-head">
    <div><div class="kicker">${kicker}</div><h1>${title}</h1><p>${sub}</p></div>
    ${p ? `<div class="role-chip">${roleLabel}</div>` : ''}
  </div>`;
}
function tabs(list, active){
  return `<div class="tabs">${list.map(t => `<button class="tab ${active === t.k ? 'on' : ''}" data-act="tab" data-tab="${t.k}"><span class="dot"></span>${t.n}${t.badge ? `<span class="badge ink" style="padding:0 5px">${t.badge}</span>` : ''}</button>`).join('')}</div>`;
}

/* ---------- 規則 ---------- */
function rulesBody(){
  return `
  <div class="sec">
    <div class="sec-head"><span class="sec-no">1</span><h3>三種送法</h3></div>
    <div class="sec-body">
      <p><b>步兵</b>：只限 10kg 內，行路／搭車送，可以上樓；上樓加一小時泊車費，一般 $20。<br>
      <b>私家車</b>：隧道費、停車場費另議，唔包喺個價入面；上樓加一小時泊車費，一般 $20。<br>
      <b>貨van</b>：隧道費、停車場費另計；上樓加一小時泊車費，一般 $20。</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">2</span><h3>價錢邊個話事</h3></div>
    <div class="sec-body">
      <p>落單時可以揀：<b>我定價</b>（出貨人出一個價）或 <b>由司機開價</b>（司機報價）。<br>
      兩邊都可以還價，最後由<b>出貨人</b>決定接受邊個報價、搵邊個送。平台唔會自動派單。</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">3</span><h3>交收方式</h3></div>
    <div class="sec-body">
      <p>三種送法都<b>包上樓</b>，貨可以送到門口或樓上。上樓要泊車，一般加一小時停車場費 <b>$20</b>；實際泊車費由司機同出貨人完成時確認。唔上樓就冇呢項。</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">4</span><h3>貨物要求</h3></div>
    <div class="sec-body">
      <p>只接<b>已封箱</b>或者<b>外觀一眼睇得清</b>嘅貨。唔收違禁品、危險品、易腐壞而無妥善包裝嘅貨。司機有權即場拒收。</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">5</span><h3>司機權利</h3></div>
    <div class="sec-body">
      <p>接單無上限，可以拒接、可以報價、可以還價。已接嘅單如果貨物同描述不符、等太耐、冇位泊車或者有危險，司機可以取消，毋須賠償。</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">6</span><h3>錢銀安排</h3></div>
    <div class="sec-body">
      <p><b>平台費 $0</b>，平台唔代收款、唔墊付、唔做中間人。車費同附加費由出貨人同司機直接交收。代購要先收錢，或者交收完成後才安排運輸。</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">7</span><h3>法律與保險</h3></div>
    <div class="sec-body">
      <p>平台只提供配對，不承擔任何法律責任。司機須確保自己嘅車輛牌照、保險適合載貨；步兵須確保自己有能力安全運送。雙方自行判斷風險。</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">8</span><h3>示範版做咗／未做</h3></div>
    <div class="sec-body">
      <p><b>已做</b>：電話登入、三種送法、包上樓 $20 泊車、定價／報價／議價、接單、提貨碼、交收碼、附加費、語音播報、後端跨裝置同步、SSE 即時更新、Web Push、長期登入、自動更新。<br>
      <b>未做</b>：SMS OTP、真地圖距離、線上支付、管理員後台、正式營運認證。${serverMode ? '資料存喺後端；後端重啟有機會清空（免費主機）。' : '純靜態版資料只存本機。'}</p>
    </div>
  </div>`;
}

/* ---------- 圖示 ---------- */
function icoCheck(){ return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M4 12l5 5 11-11" stroke-linecap="round"/></svg>'; }
function icoInfo(){ return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v.5M12 11v6" stroke-linecap="round"/></svg>'; }
function icoWarn(){ return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 3l9 17H3z" stroke-linejoin="round"/><path d="M12 9v5M12 17v.5" stroke-linecap="round"/></svg>'; }

/* ====== APPJS-B ====== */

/* ---------- 路由 ---------- */
function render(){
  const p = me();
  if(!p){ ui.screen = 'login'; renderLogin(); return; }
  if(p.role === 'shipper'){ ui.screen = 'shipper'; renderShipper(p); }
  else { ui.screen = 'driver'; renderDriver(p); }
}

const STATUS = { open:'等接單', accepted:'已接單', picked:'已提貨', delivered:'已交收', cancelled:'已取消' };

function myOrders(){ return db.orders.filter(o => o.shipperPhone === session.phone); }
function myJobs(){ return db.orders.filter(o => o.driverPhone === session.phone && ['accepted','picked','delivered'].includes(o.status)); }
function myOffers(){
  return db.orders.filter(o => o.status === 'open' && (o.offers || []).some(x => x.driverPhone === session.phone));
}
function profileOf(phone){ return db.profiles[phone] || { phone, name:'接貨人', mode:'car' }; }
function maskPhone(phone){ const p = String(phone || ''); return p.length >= 8 ? p.slice(0,4) + ' ****' : p; }

/* ---------- 通知 ---------- */
function unreadCount(phone){
  return (db.notices || []).filter(n => n.phone === phone && !n.read).length;
}
function pushNotice(phone, title, body, oid, type){
  if(!phone) return;
  db.notices = db.notices || [];
  db.notices.push({ id: uid(), phone, title, body, oid: oid || null, type: type || 'info', at: Date.now(), read: false });
  const mine = db.notices.filter(n => n.phone === phone);
  if(mine.length > 80){
    const ids = new Set(mine.slice(0, mine.length - 80).map(n => n.id));
    db.notices = db.notices.filter(n => !ids.has(n.id));
  }
}
function timeAgo(at){
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if(s < 60) return '剛剛';
  if(s < 3600) return Math.floor(s / 60) + ' 分鐘前';
  const d = new Date(at); return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function notifyNewOrder(o){
  const m = MODES[o.mode]; if(!m) return;
  Object.values(db.profiles || {}).forEach(p => {
    if(p.role === 'driver' && p.online && p.mode === o.mode && p.phone !== o.shipperPhone){
      if(Array.isArray(p.areas) && p.areas.length && !p.areas.includes(o.pickup.district)) return;
      const price = o.pricing === 'fixed' ? '$' + money(o.askPrice) : '待出價';
      pushNotice(p.phone, '新單 ' + price, `${o.pickup.district} → ${o.drop.district} · ${o.weight}kg · ${m.name} · ${o.pickup.from}–${o.pickup.to} 提貨${o.upstairs ? ' · 上樓 +$' + UPSTAIRS_FEE + ' 泊車' : ''}`, o.id, 'newOrder');
    }
  });
}
function notifyPermission(){ return ('Notification' in window) ? Notification.permission : 'unsupported'; }
function showSystemNotice(n){
  if(notifyPermission() !== 'granted' || !document.hidden) return;
  showSystemNotification(n.title, n.body, 'ks_' + n.id);
}

/* =========================================================
   出貨人
   ========================================================= */
function renderShipper(p){
  const openCount = myOrders().filter(o => ['open','accepted','picked'].includes(o.status)).length;
  const offerCount = myOrders().filter(o => o.status === 'open' && (o.offers || []).some(x => x.status === 'open')).length;
  const tab = ui.tab;
  const title = tab === 'new' ? '落單' : tab === 'orders' ? '我的訂單' : '規則';
  const sub = tab === 'new' ? '三種送法，自己定價或等司機開價；出單即播報。' :
    tab === 'orders' ? '睇報價、還價、揀司機；提貨碼同交收碼都喺呢度。' :
    '平台費 $0，只做配對，錢銀你哋自己交收。';
  let body = '';
  if(tab === 'new') body = renderOrderForm(p);
  else if(tab === 'orders') body = renderMyOrders(p);
  else body = `<div class="order-layout"><div>${rulesBody()}</div></div>`;

  $('#app').innerHTML = `
    ${topBar(p)}
    <div class="wrap">
      ${pageHead('SHIPPER · 出貨人', title, sub, p, '出貨人')}
      ${tabs([
        {k:'new', n:'落單'},
        {k:'orders', n:'我的訂單', badge: openCount || ''},
        {k:'rules', n:'規則'}
      ], tab)}
      ${body}
      <div class="foot-note">快送（示範版）· 平台只提供配對，不收平台費、不代收款、不參與運輸合約。<br>價錢由出貨人同司機直接協定；附加費另議。</div>
    </div>`;
}

/* ---------- 落單表 ---------- */
function newDraft(){
  const t = clock(45);
  const t2 = clock(105);
  const t3 = clock(255);
  return {
    mode:'walk', weight:'8',
    fromD:'離島', fromAddr:'東涌站 A 出口（路邊）',
    toD:'離島', toAddr:'機場一號客運大樓（路邊）',
    pickupFrom:t.t, pickupTo:t2.t, deadline:t3.t,
    goods:'包裹', desc:'已封箱，2 件', pieces:'2',
    sealed:false, noBanned:false, buyFor:false,
    consignee:'', consigneePhone:'', note:'',
    pricing:'quote', askPrice:'', budget:'100',
    km:String(estKm('離島','離島')), upstairs:false,
    tomorrow: t3.tomorrow
  };
}

function ensureDraft(){
  if(!ui.draft) ui.draft = newDraft();
  return ui.draft;
}

function renderOrderForm(p){
  const d = ensureDraft();
  const mode = MODES[d.mode];
  const km = num(d.km, estKm(d.fromD, d.toD));
  const ref = meterFare(km);
  const priceTxt = d.pricing === 'fixed'
    ? (d.askPrice ? '$' + money(d.askPrice) : '未定價')
    : ('等報價' + (d.budget ? ' · 預算 $' + money(d.budget) : ''));
  const weightWarn = d.mode === 'walk' && num(d.weight) > 10;

  return `
  <div class="order-layout">
    <div>
      <div class="sec">
        <div class="sec-head"><span class="sec-no">1</span><h3>路線</h3><small>揀區會自動估公里，可以手改</small></div>
        <div class="sec-body">
          <div class="grid two">
            <div class="field">
              <label>提貨區</label>
              <select data-f="fromD" data-rerender="1">${AREAS.map(a => `<option ${d.fromD === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>提貨地址</label>
              <input type="text" data-f="fromAddr" value="${esc(d.fromAddr)}" placeholder="例：果欄 A 座門口">
            </div>
            <div class="field">
              <label>送達區</label>
              <select data-f="toD" data-rerender="1">${AREAS.map(a => `<option ${d.toD === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>送達地址</label>
              <input type="text" data-f="toAddr" value="${esc(d.toAddr)}" placeholder="例：沙田第一城 49 座對出巴士站">
            </div>
            <div class="field">
              <label>大約公里</label>
              <input type="number" min="0.5" step="0.5" data-f="km" data-rerender="1" value="${esc(d.km)}">
              <span class="hint">示範用區中心估算，實際由司機自己判斷。</span>
            </div>
          </div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><span class="sec-no">2</span><h3>送貨方式</h3><small>三種運力，價錢同附加費唔同</small></div>
        <div class="sec-body">
          <div class="mode-cards">
            ${Object.keys(MODES).map(k => `
              <button class="mode ${d.mode === k ? 'on' : ''}" data-act="setMode" data-mode="${k}">
                <b>${MODES[k].name}</b>
                <span>${k === 'walk' ? '行路／搭車送，可上樓' : k === 'car' ? '私家車點對點，可上樓' : '大件、多箱、可上樓'}</span>
                <span class="mtag">${MODES[k].tag}</span>
              </button>`).join('')}
          </div>
          <div class="grid two" style="margin-top:11px">
            <div class="field">
              <label>貨重（kg）</label>
              <input type="number" min="0.5" step="0.5" data-f="weight" data-rerender="1" value="${esc(d.weight)}" placeholder="8">
              <span class="hint">${d.mode === 'walk' ? '步兵上限 10kg。' : '如實填寫，司機有權即場拒收。'}</span>
            </div>
            <div class="field">
              <label>你嘅方式</label>
              <div class="settings-hint" style="padding-top:6px">${mode.name} · ${mode.tag}</div>
            </div>
          </div>
          <label class="van-opt">
            <input type="checkbox" data-c="upstairs" ${d.upstairs ? 'checked' : ''}>
            <span>需要上樓（加一小時泊車費，一般 $${UPSTAIRS_FEE}）</span>
          </label>
          ${weightWarn ? `<div class="notice warn" style="margin-top:9px">${icoWarn()} 步兵限 10kg，你填咗 ${esc(d.weight)}kg。請改做私家車或貨van，或者減重。</div>` : ''}
          <div class="notice ${d.upstairs ? '' : 'calm'}" style="margin-top:9px">${icoInfo()} ${mode.fee}</div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><span class="sec-no">3</span><h3>時間</h3><small>幾點至幾點提貨、幾點前送到</small></div>
        <div class="sec-body">
          <div class="grid two">
            <div class="field">
              <label>提貨由</label>
              <input type="time" data-f="pickupFrom" value="${esc(d.pickupFrom)}">
            </div>
            <div class="field">
              <label>提貨至</label>
              <input type="time" data-f="pickupTo" value="${esc(d.pickupTo)}">
            </div>
            <div class="field">
              <label>送達時限（幾點前到）</label>
              <input type="time" data-f="deadline" value="${esc(d.deadline)}">
            </div>
          </div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><span class="sec-no">4</span><h3>貨物</h3><small>只接封箱或一眼睇得清</small></div>
        <div class="sec-body">
          <div class="field">
            <label>貨類</label>
            <div class="chips">
              ${GOODS.map(g => `<button class="chip ${d.goods === g ? 'on' : ''}" data-act="setGoods" data-g="${g}">${g}</button>`).join('')}
            </div>
          </div>
          <div class="grid two" style="margin-top:11px">
            <div class="field">
              <label>貨物描述</label>
              <input type="text" data-f="desc" value="${esc(d.desc)}" placeholder="例：3 箱日本蜜瓜，已封箱">
            </div>
            <div class="field">
              <label>件數</label>
              <input type="number" min="1" step="1" data-f="pieces" value="${esc(d.pieces)}">
            </div>
          </div>
          <label class="check" style="margin-top:11px" data-check="sealed">
            <input type="checkbox" data-c="sealed" ${d.sealed ? 'checked' : ''}>
            <span>貨物已封箱，或者外觀一眼睇得清係咩（司機有權拒收睇唔清嘅貨）。</span>
          </label>
          <label class="check" style="margin-top:8px" data-check="noBanned">
            <input type="checkbox" data-c="noBanned" ${d.noBanned ? 'checked' : ''}>
            <span>唔係違禁品、危險品或非法物品。</span>
          </label>
          <div class="divider"></div>
          <button class="switch ${d.buyFor ? 'on' : ''}" data-act="toggleBuyFor">
            <span class="track"><span class="knob"></span></span>代客人買貨（要先收錢）
          </button>
          ${d.buyFor ? `<div class="notice" style="margin-top:8px">${icoWarn()} 代購要先收錢，或者交收完成後才安排運輸。平台唔代收款、唔墊付，你同司機直接傾。</div>` : ''}
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><span class="sec-no">5</span><h3>價錢</h3><small>你定價，或等司機開價</small></div>
        <div class="sec-body">
          <div class="price-cards">
            <button class="price-card ${d.pricing === 'fixed' ? 'on' : ''}" data-act="setPricing" data-p="fixed">
              <b>我定價</b><span>你出一個價，司機可以接或還價</span>
            </button>
            <button class="price-card ${d.pricing === 'quote' ? 'on' : ''}" data-act="setPricing" data-p="quote">
              <b>由司機開價</b><span>司機報價，你慢慢揀</span>
            </button>
          </div>
          <div class="grid two" style="margin-top:11px">
            ${d.pricing === 'fixed' ? `
            <div class="field">
              <label>你出幾錢（HK$）</label>
              <input type="number" min="1" step="1" data-f="askPrice" data-rerender="1" value="${esc(d.askPrice)}" placeholder="80">
              <span class="hint">未計隧道／停車場；上樓另加泊車（一般 $${UPSTAIRS_FEE}）。</span>
            </div>` : `
            <div class="field">
              <label>預算上限（可留空）</label>
              <input type="number" min="1" step="1" data-f="budget" data-rerender="1" value="${esc(d.budget)}" placeholder="100">
              <span class="hint">只作參考，唔係強制；司機可以報高過或低過。</span>
            </div>`}
          </div>
          ${d.mode === 'car' ? `
          <div class="notice calm" style="margin-top:9px">${icoInfo()} 市區紅的跳錶參考：<b>$${money(ref)}</b>（${fmtKm(km)}）。
            ${d.pricing === 'fixed' ? `<button class="btn sm ghost" style="margin-left:6px" data-act="useRef" data-ref="${ref}">用參考價</button>` : ''}
          </div>` : ''}
          ${d.upstairs ? `<div class="notice calm" style="margin-top:9px">${icoInfo()} 上樓另加一小時泊車費，一般 <b>$${UPSTAIRS_FEE}</b>；完成交收時按實際輸入。</div>` : ''}
          <div class="notice" style="margin-top:9px">${icoWarn()} 平台費 <b>$0</b>。車費由你同司機直接交收，平台唔代收、唔墊付。</div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><span class="sec-no">6</span><h3>收貨人與備註</h3><small>收貨人唔需要開帳戶</small></div>
        <div class="sec-body">
          <div class="grid two">
            <div class="field">
              <label>收貨人稱呼</label>
              <input type="text" data-f="consignee" value="${esc(d.consignee)}" placeholder="陳太">
            </div>
            <div class="field">
              <label>收貨人電話</label>
              <input type="tel" inputmode="numeric" maxlength="8" data-f="consigneePhone" value="${esc(d.consigneePhone)}" placeholder="6123 4567">
            </div>
          </div>
          <div class="field" style="margin-top:11px">
            <label>備註（可留空）</label>
            <textarea data-f="note" placeholder="例：到樓下打電話，司機唔使上樓">${esc(d.note)}</textarea>
          </div>
        </div>
      </div>
    </div>

    <aside class="aside">
      <div class="card pad">
        <div class="kicker">SUMMARY</div>
        <div class="big-num" style="font-size:26px;margin-top:4px">${priceTxt}</div>
        <div class="mini" style="margin-top:3px">${mode.name} · ${esc(d.weight || '0')}kg · ${fmtKm(km)}</div>
        <div class="hr"></div>
        <div class="summary-line"><span>路線</span><b>${esc(d.fromD)} → ${esc(d.toD)}</b></div>
        <div class="summary-line"><span>提貨</span><b>${esc(d.pickupFrom)}–${esc(d.pickupTo)}</b></div>
        <div class="summary-line"><span>送達時限</span><b>${esc(d.deadline)} 前</b></div>
        <div class="summary-line"><span>附加費</span><b>${d.mode === 'walk' ? '無' : d.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</b></div>
        <div class="summary-line"><span>平台費</span><b>$0</b></div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn warn block" data-act="submitOrder">出單 · 播報給司機</button>
        </div>
        <p class="tip" style="margin-top:9px">出單後，所有在線同類司機會即時收到語音播報，亦可以喺「接單大廳」睇到。</p>
      </div>
      <div class="notice calm" style="margin-top:10px">${icoInfo()} 三種送法都包上樓；上樓加一小時泊車費，一般 $${UPSTAIRS_FEE}，完成時按實際輸入。</div>
    </aside>
  </div>`;
}

/* ---------- 我的訂單 ---------- */
function renderMyOrders(p){
  const list = myOrders().sort((a, b) => b.createdAt - a.createdAt);
  const active = list.filter(o => ['open','accepted','picked'].includes(o.status)).length;
  const offers = list.reduce((n, o) => n + (o.status === 'open' ? (o.offers || []).filter(x => x.status === 'open').length : 0), 0);
  const done = list.filter(o => o.status === 'delivered');
  const paid = done.reduce((n, o) => n + (o.finalTotal || o.agreedPrice || 0), 0);

  return `
  <div class="kpis">
    <div class="kpi"><small>進行中</small><b>${active}<span>單</span></b></div>
    <div class="kpi"><small>收到報價</small><b>${offers}<span>個</span></b></div>
    <div class="kpi"><small>已完成</small><b>${done.length}<span>單</span></b></div>
    <div class="kpi"><small>已付車費</small><b>$${money(paid)}</b></div>
  </div>
  ${list.length ? `<div class="orders">${list.map(o => orderCardShipper(o)).join('')}</div>` : `
    <div class="empty"><b>仲未出過單</b>去「落單」出第一張，8kg 東涌去機場都可以。</div>`}`;
}

function orderCardShipper(o){
  const m = MODES[o.mode];
  const dp = o.driverPhone ? profileOf(o.driverPhone) : null;
  const openOffers = (o.offers || []).filter(x => x.status === 'open');
  const priceLabel = o.status === 'delivered' && o.finalTotal ? '$' + money(o.finalTotal) : (o.agreedPrice ? '$' + money(o.agreedPrice) : o.pricing === 'fixed' ? '$' + money(o.askPrice) : '等報價');
  const priceNote = o.status === 'delivered' ? '實收' : o.agreedPrice ? '協定' : o.pricing === 'fixed' ? '你定價' : (o.budget ? '預算 $' + money(o.budget) : '未定價');
  const canCancel = ['open','accepted','picked'].includes(o.status);

  return `
  <article class="card order-card">
    <div class="o-top">
      <div class="o-route">
        <div class="rd"><span class="dotpick"></span><b>${esc(o.pickup.district)}</b><span>${esc(o.pickup.addr)}</span></div>
        <div class="arw">↓</div>
        <div class="rd"><span class="dotdrop"></span><b>${esc(o.drop.district)}</b><span>${esc(o.drop.addr)}</span></div>
      </div>
      <div class="badges" style="margin:0">
        <span class="badge ${o.status === 'open' ? 'haz' : o.status === 'cancelled' ? 'warn' : 'ok'}">${STATUS[o.status]}</span>
        <span class="badge ink">${o.code}</span>
      </div>
    </div>

    <div class="badges">
      <span class="badge ${o.mode === 'van' ? 'van' : 'line'}">${m.name}</span>
      <span class="badge">${esc(o.weight)} kg</span>
      <span class="badge">${esc(o.goods.type)} · ${esc(o.goods.pieces)} 件</span>
      <span class="badge">${fmtKm(o.km)}</span>
      <span class="badge">提貨 ${tlab(o, o.pickup.from)}–${esc(o.pickup.to)}</span>
      <span class="badge">${tlab(o, o.drop.deadline)} 前</span>
      ${o.mode !== 'walk' ? `<span class="badge">${o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</span>` : ''}
      ${o.upstairs ? `<span class="badge">可上樓 · 泊車約 $${UPSTAIRS_FEE}</span>` : ''}
      ${o.goods.buyFor ? `<span class="badge warn">代購 · 先收錢</span>` : ''}
    </div>

    ${stepBar(o.status)}

    ${['open','accepted','picked','delivered'].includes(o.status) ? `
    <div class="o-codes">
      <div class="codebox"><small>提貨碼 · 給接貨人</small><b>${esc(o.pickupCode)}</b></div>
      <div class="codebox"><small>交收碼 · 自己傳給收貨人</small><b>${esc(o.dropCode)}</b></div>
    </div>` : ''}

    ${o.status === 'open' ? `
      <div class="offers">
        <div class="offers-head">
          司機報價
          <span class="badge ${openOffers.length ? 'ink' : ''}">${openOffers.length} 個</span>
        </div>
        ${o.pricing === 'fixed' ? `<div class="bid-hint">你已定價 <b>$${money(o.askPrice)}</b>。司機可以照價接單，或者出價（高／低都得）；你可以接受、還價，或揀第二個。</div>` : `<div class="bid-hint">你冇定價，等司機出價${o.budget ? '（預算 $' + money(o.budget) + ' 內）' : ''}。邊個價啱，你揀邊個。</div>`}
        ${openOffers.length ? openOffers.map(f => offerRow(o, f, 'shipper')).join('') : `<div class="bid-hint" style="margin-top:8px">暫時未有報價。可以「重新播報」叫多一次。</div>`}
      </div>` : ''}

    ${o.status === 'accepted' || o.status === 'picked' ? `
      <div class="o-note">
        <span>接貨人：</span><b>${esc(dp ? dp.name : '')}</b> · ${esc(o.driverPhone)} ${dp && dp.plate ? '· ' + esc(dp.plate) : ''}<br>
        <span>協定車費：</span><b>$${money(o.agreedPrice)}</b>${o.mode !== 'walk' ? `<br><span>附加費：</span>${o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}` : ''}
      </div>` : ''}

    ${o.status === 'delivered' ? `
      <div class="o-note">
        <span>已交收 · 實收：</span><b>$${money(o.finalTotal || o.agreedPrice)}</b>
        ${o.finalFee && (o.finalFee.tunnel || o.finalFee.parking || o.finalFee.upstairs) ? `<br><span>其中附加：</span>${[o.finalFee.tunnel ? `隧道 $${money(o.finalFee.tunnel)}` : '', o.finalFee.parking ? `停車 $${money(o.finalFee.parking)}` : '', o.finalFee.upstairs ? `上樓 $${money(o.finalFee.upstairs)}` : ''].filter(Boolean).join(' · ')}` : ''}
      </div>` : ''}

    <div class="o-foot">
      <div class="o-price">${priceLabel}<small>${priceNote}</small></div>
      <div class="o-actions" style="margin:0">
        <button class="btn sm ghost" data-act="detail" data-id="${o.id}">詳情</button>
        ${o.status === 'open' ? `<button class="btn sm ghost" data-act="recast" data-id="${o.id}">重新播報</button>` : ''}
        ${['accepted','picked'].includes(o.status) ? `<a class="btn sm ghost" href="tel:${esc(o.driverPhone)}">致電接貨人</a><button class="btn sm ghost" data-act="reveal" data-id="${o.id}">聯絡資料</button>` : ''}
        ${canCancel ? `<button class="btn sm danger" data-act="cancelOrder" data-id="${o.id}">取消</button>` : ''}
      </div>
    </div>
  </article>`;
}

function stepBar(status){
  const idx = { open:0, accepted:1, picked:2, delivered:4, cancelled:-1 }[status] ?? 0;
  const names = ['等接單','已接單','已提貨','已交收'];
  return `<div class="steps">${names.map((n, i) => `<div class="step ${i < idx ? 'done' : ''} ${i === idx ? 'now' : ''}"><span class="knob"></span>${n}</div>`).join('')}</div>`;
}

/* ---------- 報價列 ---------- */
function offerRow(o, f, viewer){
  const dp = profileOf(f.driverPhone);
  const turns = (f.history || []).slice(-3);
  const mine = viewer === 'driver';
  return `
  <div class="offer ${f.by === 'shipper' ? 'hot' : ''}">
    <div class="offer-row">
      <div class="offer-who">
        <b>${esc(dp.name)}</b>
        <span>${esc(viewer === 'shipper' ? maskPhone(f.driverPhone) : f.driverPhone)}${viewer === 'driver' && dp.plate ? ' · ' + esc(dp.plate) : ''} · ${MODES[dp.mode] ? MODES[dp.mode].name : ''}${viewer === 'shipper' ? ' · 電話接單後顯示' : ''}</span>
      </div>
      <div class="offer-price">
        <b>$${money(f.price)}</b>
        <span>${f.by === 'shipper' ? (mine ? '出貨人還價' : '你已還價') : '司機開價'}</span>
      </div>
    </div>
    ${turns.length ? `<ul class="turns">${turns.map(t => `<li><b class="${t.by === 'driver' ? 'who-driver' : 'who-shipper'}">${t.by === 'driver' ? '司機' : '出貨人'}</b><span>$${money(t.price)}</span></li>`).join('')}</ul>` : ''}
    ${f.note ? `<div class="offer-note">「${esc(f.note)}」</div>` : ''}
    ${viewer === 'shipper' ? `
      <div class="btn-row" style="margin-top:8px">
        <button class="btn sm" data-act="acceptOffer" data-oid="${o.id}" data-fid="${f.id}">接受 $${money(f.price)}</button>
        <button class="btn sm ghost" data-act="counter" data-oid="${o.id}" data-fid="${f.id}">還價</button>
        <button class="btn sm ghost" data-act="declineOffer" data-oid="${o.id}" data-fid="${f.id}">唔啱</button>
      </div>` : `
      <div class="btn-row" style="margin-top:8px">
        ${f.by === 'shipper' ? `<button class="btn sm warn" data-act="acceptCounter" data-oid="${o.id}" data-fid="${f.id}">接受 $${money(f.price)}</button>` : ''}
        <button class="btn sm ghost" data-act="driverCounter" data-oid="${o.id}" data-fid="${f.id}">${f.by === 'shipper' ? '再還價' : '改報價'}</button>
      </div>`}
  </div>`;
}

/* =========================================================
   出單 / 詳情 / 報價處理
   ========================================================= */
function submitOrder(){
  const d = ui.draft;
  if(!d) return;
  if(!d.fromAddr.trim()) return toast('請填提貨地址', 'err');
  if(!d.toAddr.trim()) return toast('請填送達地址', 'err');
  const w = num(d.weight);
  if(w <= 0) return toast('請填貨重（kg）', 'err');
  if(d.mode === 'walk' && w > 10) return toast('步兵限 10kg，請改私家車或貨van', 'err');
  if(num(d.pieces) < 1) return toast('件數至少要 1', 'err');
  if(!d.desc.trim()) return toast('請寫貨物描述', 'err');
  if(!d.sealed) return toast('要確認貨物已封箱或外觀清楚', 'err');
  if(!d.noBanned) return toast('要確認唔係違禁品', 'err');
  if(!d.consignee.trim()) return toast('請填收貨人稱呼', 'err');
  if(d.consigneePhone && !/^[4-9]\d{7}$/.test(String(d.consigneePhone).replace(/\D/g, ''))){
    return toast('收貨人電話要 8 位（4–9 字頭）', 'err');
  }
  if(!d.pickupFrom || !d.pickupTo || !d.deadline) return toast('請填提貨同送達時間', 'err');
  if(timeToMin(d.deadline) <= timeToMin(d.pickupTo)) return toast('送達時限要遲過「提貨至」', 'err');
  if(d.pricing === 'fixed' && num(d.askPrice) <= 0) return toast('你揀咗自己定價，請填價錢', 'err');
  if(d.pricing === 'quote' && d.budget && num(d.budget) <= 0) return toast('預算要係正數，或者留空', 'err');

  const km = num(d.km, estKm(d.fromD, d.toD));
  const tomorrow = timeToMin(d.deadline) <= nowMin();
  const o = {
    id: uid(), code: 'KS' + String(Date.now()).slice(-6),
    shipperPhone: session.phone, shipperName: me().name,
    mode: d.mode, weight: w,
    pickup: { district:d.fromD, addr:d.fromAddr.trim(), from:d.pickupFrom, to:d.pickupTo },
    drop: { district:d.toD, addr:d.toAddr.trim(), deadline:d.deadline },
    km,
    goods: { type:d.goods, desc:d.desc.trim(), pieces:num(d.pieces), sealed:true, buyFor:!!d.buyFor },
    consignee: { name:d.consignee.trim(), phone:String(d.consigneePhone || '').replace(/\D/g, '') },
    note: (d.note || '').trim(),
    pricing: d.pricing,
    askPrice: d.pricing === 'fixed' ? num(d.askPrice) : null,
    budget: d.pricing === 'quote' && d.budget ? num(d.budget) : null,
    upstairs: !!d.upstairs,
    offers: [],
    status: 'open',
    createdAt: Date.now(), recastAt: Date.now(),
    tomorrow,
    pickupCode: code4(), dropCode: code4(),
    driverPhone: null, agreedPrice: null
  };
  db.orders.unshift(o);
  notifyNewOrder(o);
  saveDB();
  ui.draft = null;
  ui.tab = 'orders';
  render();
  speak(announceText(o));
  openSuccess(o);
}

function openSuccess(o){
  const m = MODES[o.mode];
  const price = o.pricing === 'fixed' ? '$' + money(o.askPrice) : '等司機報價' + (o.budget ? '（預算 $' + money(o.budget) + ' 內）' : '');
  openModal(`
    <div class="success-box">
      <div class="tick"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M4 12l5 5 11-11" stroke-linecap="round"/></svg></div>
      <b>已出單 · 已播報</b>
      <div class="mini" style="margin-top:3px">在線同類司機會收到語音同大廳通知</div>
    </div>
    <div class="o-note" style="margin-top:12px">
      <b>${esc(o.pickup.district)}</b> ${esc(o.pickup.addr)}<br>
      <span>↓ ${esc(o.pickup.from)}–${esc(o.pickup.to)} 提貨</span><br>
      <b>${esc(o.drop.district)}</b> ${esc(o.drop.addr)}<br>
      <span>↓ ${esc(o.drop.deadline)} 前送到</span>
    </div>
    <div class="codes">
      <div class="codebox big"><small>提貨碼 · 給接貨人</small><b>${esc(o.pickupCode)}</b></div>
      <div class="codebox big" style="margin-top:8px"><small>交收碼 · 自己傳給收貨人</small><b>${esc(o.dropCode)}</b></div>
    </div>
    <div class="hr"></div>
    <div class="summary-line"><span>送貨方式</span><b>${m.name} · ${esc(o.weight)}kg</b></div>
    <div class="summary-line"><span>價錢</span><b>${price}</b></div>
    <div class="summary-line"><span>平台費</span><b>$0</b></div>
    <div class="summary-line"><span>附加費</span><b>${o.mode === 'walk' ? '無隧道／停車' : o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</b></div>
    ${o.upstairs ? `<div class="summary-line"><span>上樓</span><b>需要 · 泊車約 $${UPSTAIRS_FEE}（完成時按實際）</b></div>` : ''}
    <div class="notice" style="margin-top:11px">${icoInfo()} 已向在線同類司機播報。佢哋可以開價或者直接接單，最後由你揀。</div>
    <div class="modal-foot">
      <button class="btn warn" data-act="closeAndOrders">睇我的訂單</button>
      <button class="btn ghost" data-act="closeModal">閂</button>
    </div>`);
}

function openDetail(oid){
  const o = db.orders.find(x => x.id === oid);
  if(!o) return;
  const m = MODES[o.mode];
  const dp = o.driverPhone ? profileOf(o.driverPhone) : null;
  const price = o.pricing === 'fixed' ? '$' + money(o.askPrice) + '（你定價）' :
    o.agreedPrice ? '$' + money(o.agreedPrice) + '（協定）' : '等司機報價' + (o.budget ? '（預算 $' + money(o.budget) + '）' : '');
  const offers = (o.offers || []);
  openModal(`
    <div class="modal-head">
      <div><h3>訂單詳情</h3><small>${o.code} · ${STATUS[o.status]}</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="summary-line"><span>路線</span><b>${esc(o.pickup.district)} → ${esc(o.drop.district)}</b></div>
      <div class="summary-line"><span>提貨</span><b>${esc(o.pickup.addr)}</b></div>
      <div class="summary-line"><span>送達</span><b>${esc(o.drop.addr)}</b></div>
      <div class="summary-line"><span>時間</span><b>${tlab(o, o.pickup.from)}–${esc(o.pickup.to)} 提貨 · ${tlab(o, o.drop.deadline)} 前到</b></div>
      <div class="summary-line"><span>方式</span><b>${m.name} · ${esc(o.weight)}kg · ${fmtKm(o.km)}</b></div>
      <div class="summary-line"><span>貨物</span><b>${esc(o.goods.type)} · ${esc(o.goods.desc)} · ${esc(o.goods.pieces)} 件</b></div>
      <div class="summary-line"><span>收貨人</span><b>${esc(o.consignee.name)} ${esc(o.consignee.phone)}</b></div>
      <div class="summary-line"><span>價錢</span><b>${price}</b></div>
      ${o.mode !== 'walk' ? `<div class="summary-line"><span>附加費</span><b>${o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</b></div>` : ''}
      ${o.upstairs ? `<div class="summary-line"><span>上樓</span><b>需要 · 泊車約 $${UPSTAIRS_FEE}（完成時按實際）</b></div>` : ''}
      ${o.note ? `<div class="summary-line"><span>備註</span><b>${esc(o.note)}</b></div>` : ''}
      ${o.cancelNote ? `<div class="summary-line"><span>上一次取消</span><b>${esc(o.cancelNote)}</b></div>` : ''}
      ${dp ? `<div class="summary-line"><span>接貨人</span><b>${esc(dp.name)} · ${esc(o.driverPhone)}${dp.plate ? ' · ' + esc(dp.plate) : ''}</b></div>` : ''}
      ${['open','accepted','picked','delivered'].includes(o.status) ? `
        <div class="o-codes">
          <div class="codebox"><small>提貨碼</small><b>${esc(o.pickupCode)}</b></div>
          <div class="codebox"><small>交收碼</small><b>${esc(o.dropCode)}</b></div>
        </div>` : ''}
      ${offers.length ? `<div class="hr"></div><div class="offers-head">所有報價 <span class="badge">${offers.length}</span></div>
        ${offers.map(f => `<div class="offer"><div class="offer-row"><div class="offer-who"><b>${esc(profileOf(f.driverPhone).name)}</b><span>${esc(maskPhone(f.driverPhone))} · 電話接單後顯示</span></div><div class="offer-price"><b>$${money(f.price)}</b><span>${f.by === 'shipper' ? '出貨人還價' : '司機開價'} · ${f.status === 'accepted' ? '已接受' : f.status === 'declined' ? '已拒絕' : '待回覆'}</span></div></div>${f.note ? `<div class="offer-note">「${esc(f.note)}」</div>` : ''}</div>`).join('')}` : ''}
    </div>
    <div class="modal-foot"><button class="btn ghost" data-act="closeModal">閂</button></div>`);
}

/* ---------- 出貨人：接受 / 還價 / 拒絕 ---------- */
function acceptOffer(oid, fid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const f = (o.offers || []).find(x => x.id === fid); if(!f) return;
  if(o.status !== 'open') return toast('呢張單已經有人接咗', 'err');
  if(f.status !== 'open') return toast('呢個報價已經失效', 'err');
  o.status = 'accepted'; o.driverPhone = f.driverPhone; o.agreedPrice = f.price; o.acceptedAt = Date.now();
  (o.offers || []).forEach(x => { x.status = x.id === f.id ? 'accepted' : 'declined'; });
  if(session.phone === f.driverPhone){
    pushNotice(o.shipperPhone, '接貨人接受咗你嘅還價 $' + money(f.price), `${o.pickup.district} → ${o.drop.district} · 已配對，請準備交收`, o.id, 'accepted');
  }else{
    pushNotice(f.driverPhone, '出貨人接受咗你嘅出價 $' + money(f.price), `${o.pickup.district} → ${o.drop.district} · 請準備提貨`, o.id, 'accepted');
  }
  saveDB(); closeModal(); render();
  toast(session.phone === f.driverPhone ? '已接受 $' + money(f.price) + '，請準備提貨' : '已接受 $' + money(f.price) + '，等司機提貨', 'ok');
  openContactReveal(o);
}

function declineOffer(oid, fid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const f = (o.offers || []).find(x => x.id === fid); if(!f) return;
  f.status = 'declined';
  pushNotice(f.driverPhone, '出貨人拒絕咗你嘅出價 $' + money(f.price), `${o.pickup.district} → ${o.drop.district}`, o.id, 'declined');
  saveDB(); render(); toast('已拒絕呢個報價');
}

function openCounter(oid, fid, by){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const f = (o.offers || []).find(x => x.id === fid); if(!f) return;
  const isShipper = by === 'shipper';
  openModal(`
    <div class="modal-head">
      <div><h3>${isShipper ? '還價' : '再開價'}</h3><small>${esc(o.pickup.district)} → ${esc(o.drop.district)} · 而家 $${money(f.price)}</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      ${(f.history || []).length ? `<ul class="turns">${f.history.slice(-4).map(t => `<li><b class="${t.by === 'driver' ? 'who-driver' : 'who-shipper'}">${t.by === 'driver' ? '司機' : '出貨人'}</b><span>$${money(t.price)}</span></li>`).join('')}</ul>` : ''}
      <div class="field"><label>你嘅價（HK$）</label><input type="number" min="1" step="1" id="counterPrice" value="${f.price}"></div>
      <div class="field" style="margin-top:9px"><label>講兩句（可留空）</label><input type="text" id="counterNote" maxlength="60" placeholder="${isShipper ? '例：$90 就而家嚟收' : '例：要等 20 分鐘，$100 先做'}" value="${esc(f.note || '')}"></div>
      <div class="notice calm" style="margin-top:10px">${icoInfo()} 還價只係提出新價，未算成交；對方接受咗先會落實。</div>
    </div>
    <div class="modal-foot">
      <button class="btn warn" data-act="submitCounter" data-oid="${o.id}" data-fid="${f.id}" data-by="${by}">${isShipper ? '提出還價' : '再開價'}</button>
      <button class="btn ghost" data-act="closeModal">閂</button>
    </div>`);
}

function submitCounter(oid, fid, by){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const f = (o.offers || []).find(x => x.id === fid); if(!f) return;
  const price = num($('#counterPrice').value);
  const note = ($('#counterNote').value || '').trim();
  if(price <= 0) return toast('請填一個價', 'err');
  f.price = price; f.by = by; f.note = note; f.at = Date.now();
  f.history = f.history || [];
  f.history.push({ by, price, note, at: Date.now() });
  pushNotice(by === 'shipper' ? f.driverPhone : o.shipperPhone,
    (by === 'shipper' ? '出貨人還價 $' : '司機再出價 $') + money(price),
    `${o.pickup.district} → ${o.drop.district} · ${MODES[o.mode].name}`, o.id, 'counter');
  saveDB(); closeModal(); render();
  toast(by === 'shipper' ? '已還價 $' + money(price) : '已再開價 $' + money(price), 'ok');
}

/* ---------- 出貨人：取消 ---------- */
function openCancelOrder(oid){
  openModal(`
    <div class="modal-head">
      <div><h3>取消訂單</h3><small>取消之後，已接單嘅司機會收到通知</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="field"><label>原因（可留空）</label><input type="text" id="cancelReason" maxlength="50" placeholder="例：貨物改期"></div>
    </div>
    <div class="modal-foot">
      <button class="btn danger" data-act="confirmCancelOrder" data-id="${oid}">確認取消</button>
      <button class="btn ghost" data-act="closeModal">唔取消</button>
    </div>`);
}

function confirmCancelOrder(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  o.status = 'cancelled'; o.cancelNote = ($('#cancelReason').value || '').trim(); o.cancelledAt = Date.now();
  const targets = new Set();
  if(o.driverPhone) targets.add(o.driverPhone);
  (o.offers || []).forEach(f => { if(f.status === 'open' && f.driverPhone) targets.add(f.driverPhone); });
  targets.forEach(phone => pushNotice(phone, '出貨人取消咗張單',
    `${o.pickup.district} → ${o.drop.district}${o.cancelNote ? ' · ' + o.cancelNote : ''}`, o.id, 'cancelled'));
  saveDB(); closeModal(); render(); toast('訂單已取消');
}

/* ====== APPJS-D ====== */

/* =========================================================
   接貨人
   ========================================================= */
function renderDriver(p){
  const jobs = myJobs();
  const active = jobs.filter(o => ['accepted','picked'].includes(o.status)).length;
  const myBids = myOffers().filter(o => (o.offers || []).some(f => f.driverPhone === p.phone && f.status === 'open'));
  const tab = ui.tab;
  const title = { board:'接單大廳', jobs:'我的接單', offers:'我的報價', settings:'設定', rules:'規則' }[tab] || '接單大廳';
  const sub = {
    board:'只會見到同你送貨方式一樣嘅單；可以報價、可以直接接。',
    jobs:'提貨、交收、附加費，全部喺呢度完成。',
    offers:'你開出嘅價同出貨人還價，喺呢度回覆。',
    settings:'送貨方式、可接地區、上線同播報。',
    rules:'平台費 $0，司機自負牌照同保險。'
  }[tab] || '';
  let body = '';
  if(tab === 'board') body = renderBoard(p);
  else if(tab === 'jobs') body = renderJobs(p);
  else if(tab === 'offers') body = renderMyOffers(p);
  else if(tab === 'settings') body = renderSettings(p);
  else body = `<div class="order-layout"><div>${rulesBody()}</div></div>`;

  $('#app').innerHTML = `
    ${topBar(p)}
    <div class="wrap">
      ${pageHead('COURIER · 接貨人', title, sub, p, MODES[p.mode].name)}
      ${tabs([
        {k:'board', n:'接單大廳'},
        {k:'jobs', n:'我的接單', badge: active || ''},
        {k:'offers', n:'我的報價', badge: myBids.length || ''},
        {k:'settings', n:'設定'},
        {k:'rules', n:'規則'}
      ], tab)}
      ${body}
      <div class="foot-note">快送（示範版）· 平台費 $0，車費由你同出貨人直接交收。<br>你須確保車輛牌照、保險適合載貨；步兵須確保安全運送。</div>
    </div>`;
}

/* ---------- 接單大廳 ---------- */
function renderBoard(p){
  const m = MODES[p.mode];
  let list = db.orders.filter(o => o.status === 'open' && o.mode === p.mode && o.shipperPhone !== session.phone);
  if(p.areas && p.areas.length){
    list = list.filter(o => p.areas.includes(o.pickup.district) || p.areas.includes(o.drop.district));
  }
  if(ui.filter.district !== '全部') list = list.filter(o => o.pickup.district === ui.filter.district || o.drop.district === ui.filter.district);
  list.sort((a, b) => {
    if(ui.filter.sort === 'deadline') return timeToMin(a.drop.deadline) - timeToMin(b.drop.deadline);
    if(ui.filter.sort === 'price') return (b.askPrice || b.budget || 0) - (a.askPrice || a.budget || 0);
    return b.createdAt - a.createdAt;
  });

  return `
  <div class="board-head">
    <button class="switch ${p.online ? 'on' : ''}" data-act="toggleOnline">
      <span class="track"><span class="knob"></span></span>${p.online ? '上線中' : '離線'}
    </button>
    <button class="switch ${p.announce ? 'on' : ''}" data-act="toggleAnnounce">
      <span class="track"><span class="knob"></span></span>語音播報
    </button>
    <button class="btn sm ghost" data-act="testSpeech">測試語音</button>
    <button class="btn sm ghost" data-act="enablePush">開啟新單通知</button>
    <span class="badge ink">${m.name}</span>
    <span class="badge">${list.length} 張未接</span>
    <button class="btn sm ghost" style="margin-left:auto" data-act="openSettings">改送貨方式</button>
  </div>
  ${!p.online ? `<div class="notice" style="margin-bottom:10px">${icoInfo()} 你而家離線：唔會收到新單語音，但下面仍然可以睇單同報價。開返上線先會播報。</div>` : ''}
  <div class="filters">
    <select data-filter="district">
      <option ${ui.filter.district === '全部' ? 'selected' : ''}>全部</option>
      ${AREAS.map(a => `<option ${ui.filter.district === a ? 'selected' : ''}>${a}</option>`).join('')}
    </select>
    <select data-filter="sort">
      <option value="new" ${ui.filter.sort === 'new' ? 'selected' : ''}>最新</option>
      <option value="deadline" ${ui.filter.sort === 'deadline' ? 'selected' : ''}>最急</option>
      <option value="price" ${ui.filter.sort === 'price' ? 'selected' : ''}>價錢高</option>
    </select>
  </div>
  <div class="notice calm" style="margin-bottom:10px">${icoInfo()} 你只會見到 <b>${m.name}</b> 嘅單。想接其他類型，去「設定」改送貨方式。</div>
  ${list.length ? `<div class="orders">${list.map(o => boardCard(o, p)).join('')}</div>` :
    `<div class="empty"><b>而家未有${m.name}單</b>
      有新單會即時播報；你可以轉去「我的報價」睇下有冇出貨人還價。
      <div class="mini" style="margin-top:10px;line-height:1.7">如果出貨人話已經出單，請檢查：<br>
      ① 後端版：出貨人同接貨人可以用<b>兩部電話／兩個瀏覽器</b>；純靜態版只可以同一個瀏覽器<br>
      ② 用<b>另一個電話號碼</b>登入，唔好同出貨人同號碼<br>
      ③ 送貨方式要一樣（步兵／私家車／貨van）<br>
      ④ 大廳要顯示「上線中」同「語音播報」開啟<br>
      ⑤ 後端版要確認網址係後端主機，唔係 GitHub Pages</div>
    </div>`}`;
}

function boardCard(o, p){
  const m = MODES[o.mode];
  const mine = (o.offers || []).find(f => f.driverPhone === p.phone && f.status === 'open');
  const late = !o.tomorrow && timeToMin(o.drop.deadline) <= nowMin();
  const price = o.pricing === 'fixed'
    ? `<b>$${money(o.askPrice)}</b><small>出貨人定價</small>`
    : `<b>等報價</b><small>${o.budget ? '預算 $' + money(o.budget) + ' 內' : '出貨人冇設預算'}</small>`;
  return `
  <article class="card order-card">
    <div class="o-top">
      <div class="o-route">
        <div class="rd"><span class="dotpick"></span><b>${esc(o.pickup.district)}</b><span>${esc(o.pickup.addr)}</span></div>
        <div class="arw">↓</div>
        <div class="rd"><span class="dotdrop"></span><b>${esc(o.drop.district)}</b><span>${esc(o.drop.addr)}</span></div>
      </div>
      <div class="badges" style="margin:0">
        ${late ? `<span class="badge warn">已過時限</span>` : `<span class="badge haz">${tlab(o, o.drop.deadline)} 前到</span>`}
      </div>
    </div>
    <div class="badges">
      <span class="badge ${o.mode === 'van' ? 'van' : 'line'}">${m.name}</span>
      <span class="badge">${esc(o.weight)} kg</span>
      <span class="badge">${esc(o.goods.type)} · ${esc(o.goods.pieces)} 件</span>
      <span class="badge">${fmtKm(o.km)}</span>
      <span class="badge">提貨 ${tlab(o, o.pickup.from)}–${esc(o.pickup.to)}</span>
      ${o.mode !== 'walk' ? `<span class="badge">${o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</span>` : ''}
      ${o.upstairs ? `<span class="badge">可上樓 · 泊車約 $${UPSTAIRS_FEE}</span>` : ''}
    </div>
    <div class="o-foot">
      <div class="o-price" style="line-height:1.2">${price}</div>
      <div class="o-actions" style="margin:0">
        ${mine ? `<span class="badge line">${mine.by === 'shipper' ? '出貨人還價' : '你已出價'} $${money(mine.price)}</span>` : ''}
        ${o.pricing === 'fixed' ? `
          ${!mine ? `<button class="btn sm" data-act="acceptFixed" data-id="${o.id}">接單 $${money(o.askPrice)}</button>` : ''}
          ${mine && mine.by === 'shipper' ? `<button class="btn sm warn" data-act="acceptOffer" data-oid="${o.id}" data-fid="${mine.id}">接受 $${money(mine.price)}</button>` : ''}
          <button class="btn sm ghost" data-act="openQuote" data-id="${o.id}">${mine ? '改出價' : '出價'}</button>
        ` : `
          <button class="btn sm warn" data-act="openQuote" data-id="${o.id}">${mine ? '改出價' : '報價'}</button>
          ${mine && mine.by === 'shipper' ? `<button class="btn sm" data-act="acceptOffer" data-oid="${o.id}" data-fid="${mine.id}">接受 $${money(mine.price)}</button>` : ''}
        `}
      </div>
    </div>
    ${o.goods.buyFor ? `<div class="bid-hint" style="color:#8e3226">出貨人代購 · 要先收錢或交收後才安排運輸</div>` : ''}
    <div class="bid-hint">接單前唔會見到出貨人電話；一接單即彈出雙方資料，可以直接致電。</div>
  </article>`;
}

/* ---------- 報價 / 議價 ---------- */
function openQuote(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  if(o.status !== 'open') return toast('呢張單已經有人接咗', 'err');
  const mine = (o.offers || []).find(f => f.driverPhone === session.phone && f.status === 'open');
  const def = mine ? mine.price : (o.pricing === 'fixed' ? o.askPrice : (o.budget || ''));
  openModal(`
    <div class="modal-head">
      <div><h3>${mine ? '改出價' : (o.pricing === 'fixed' ? '向出貨人出價' : '開價')}</h3><small>${esc(o.pickup.district)} → ${esc(o.drop.district)} · ${MODES[o.mode].name} · ${esc(o.weight)}kg</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="summary-line"><span>出貨人</span><b>${o.pricing === 'fixed' ? '已定價 $' + money(o.askPrice) : '等司機開價' + (o.budget ? '（預算 $' + money(o.budget) + '）' : '')}</b></div>
      <div class="summary-line"><span>提貨</span><b>${tlab(o, o.pickup.from)}–${esc(o.pickup.to)}</b></div>
      <div class="summary-line"><span>送達時限</span><b>${tlab(o, o.drop.deadline)} 前</b></div>
      ${o.mode !== 'walk' ? `<div class="summary-line"><span>附加費</span><b>${o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</b></div>` : ''}
      ${o.upstairs ? `<div class="summary-line"><span>上樓</span><b>需要 · 泊車約 $${UPSTAIRS_FEE}（完成時按實際）</b></div>` : ''}
      <div class="field" style="margin-top:11px"><label>你開幾錢（HK$）</label><input type="number" min="1" step="1" id="quotePrice" value="${def}" placeholder="100"></div>
      <div class="field" style="margin-top:9px"><label>同出貨人講兩句（可留空）</label><input type="text" id="quoteNote" maxlength="60" placeholder="例：順路，45 分鐘到，隧道實報"></div>
      <div class="notice calm" style="margin-top:10px">${icoInfo()} ${o.upstairs ? `上樓泊車費約 $${UPSTAIRS_FEE}，完成時另加，唔包喺呢個報價。` : (o.pricing === 'fixed' ? '出貨人定價只係參考：你可以照價接單，亦可以出高過或低過嘅價；出貨人接受先算成交。' : '出價未算成交。出貨人可以接受、還價，或者揀其他司機。')}</div>
    </div>
    <div class="modal-foot">
      <button class="btn warn" data-act="submitQuote" data-id="${o.id}">${mine ? '更新出價' : '送出出價'}</button>
      <button class="btn ghost" data-act="closeModal">閂</button>
    </div>`);
}

function submitQuote(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  if(o.status !== 'open') return toast('呢張單已經有人接咗', 'err');
  const price = num($('#quotePrice').value);
  const note = ($('#quoteNote').value || '').trim();
  if(price <= 0) return toast('請填一個價', 'err');
  o.offers = o.offers || [];
  let f = o.offers.find(x => x.driverPhone === session.phone && x.status === 'open');
  if(f){
    f.price = price; f.note = note; f.by = 'driver'; f.at = Date.now();
    f.history = f.history || [];
    f.history.push({ by:'driver', price, note, at: Date.now() });
  }else{
    f = {
      id: uid(), driverPhone: session.phone, price, note, by:'driver',
      at: Date.now(), status:'open',
      history: [{ by:'driver', price, note, at: Date.now() }]
    };
    o.offers.push(f);
  }
  pushNotice(o.shipperPhone, '新出價 $' + money(price),
    `${me().name} · ${MODES[me().mode].name} · ${o.pickup.district} → ${o.drop.district}${note ? ' · 「' + note + '」' : ''}`, o.id, 'offer');
  saveDB(); closeModal(); render();
  toast('已出價 $' + money(price) + '，等出貨人回覆', 'ok');
}

function acceptFixed(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  if(o.status !== 'open') return toast('呢張單已經有人接咗', 'err');
  if(!me().online) return toast('請先喺大廳開返「上線」', 'err');
  if(o.mode !== me().mode) return toast('呢張單唔啱你嘅送貨方式', 'err');
  o.status = 'accepted'; o.driverPhone = session.phone; o.agreedPrice = o.askPrice; o.acceptedAt = Date.now();
  pushNotice(o.shipperPhone, '已接單 $' + money(o.askPrice),
    `${me().name} · ${MODES[me().mode].name} · 已接你張 ${o.pickup.district} → ${o.drop.district} 單`, o.id, 'accepted');
  saveDB();
  ui.tab = 'jobs'; render();
  toast('已接單 · 協定 $' + money(o.askPrice), 'ok');
  openContactReveal(o);
}

/* ---------- 成交後交換聯絡 ---------- */
function openContactReveal(o){
  if(!o || !o.driverPhone) return;
  const dp = profileOf(o.driverPhone);
  const isDriver = session.phone === o.driverPhone;
  const callPhone = isDriver ? o.shipperPhone : o.driverPhone;
  const callName = isDriver ? o.shipperName : dp.name;
  openModal(`
    <div class="modal-head">
      <div><h3>已配對 · 交換聯絡</h3><small>${esc(o.pickup.district)} → ${esc(o.drop.district)} · 協定 $${money(o.agreedPrice)}</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="notice" style="margin-bottom:10px">${icoCheck()} 由而家開始，雙方可以睇到對方電話。提貨碼由出貨人提供，交收碼由收貨人提供。</div>
      <div class="o-note" style="margin:0 0 8px">
        <span>出貨人：</span><b>${esc(o.shipperName)}</b><br>
        <a href="tel:${esc(o.shipperPhone)}">${esc(o.shipperPhone)}</a>
      </div>
      <div class="o-note" style="margin:0">
        <span>接貨人：</span><b>${esc(dp.name)}</b> · ${MODES[dp.mode] ? MODES[dp.mode].name : ''}${dp.plate ? ' · ' + esc(dp.plate) : ''}<br>
        <a href="tel:${esc(o.driverPhone)}">${esc(o.driverPhone)}</a>
      </div>
      <div class="summary-line" style="margin-top:10px"><span>提貨</span><b>${tlab(o, o.pickup.from)}–${esc(o.pickup.to)}</b></div>
      <div class="summary-line"><span>送達時限</span><b>${tlab(o, o.drop.deadline)} 前</b></div>
      <div class="summary-line"><span>貨物</span><b>${esc(o.goods.type)} · ${esc(o.goods.pieces)} 件 · ${esc(o.weight)}kg</b></div>
      ${o.mode !== 'walk' ? `<div class="summary-line"><span>附加費</span><b>${o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</b></div>` : ''}
      ${o.upstairs ? `<div class="summary-line"><span>上樓</span><b>需要 · 泊車約 $${UPSTAIRS_FEE}（完成時按實際）</b></div>` : ''}
      <div class="bid-hint" style="margin-top:10px">提貨前請先電話確認；送到門口或樓上，上樓加一小時泊車費（一般 $${UPSTAIRS_FEE}）。</div>
    </div>
    <div class="modal-foot">
      <a class="btn warn" href="tel:${esc(callPhone)}">致電${isDriver ? '出貨人' : '接貨人'} ${esc(callName)}</a>
      <button class="btn ghost" data-act="closeModal">閂</button>
    </div>`);
}

/* ---------- 我的接單 ---------- */
function renderJobs(p){
  const jobs = myJobs().sort((a, b) => (b.acceptedAt || 0) - (a.acceptedAt || 0));
  const active = jobs.filter(o => ['accepted','picked'].includes(o.status));
  const today = new Date(); const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const doneToday = jobs.filter(o => o.status === 'delivered' && (o.deliveredAt || 0) >= dayStart);
  const earned = doneToday.reduce((n, o) => n + (o.finalTotal || o.agreedPrice || 0), 0);
  return `
  <div class="kpis">
    <div class="kpi"><small>進行中</small><b>${active.length}<span>單</span></b></div>
    <div class="kpi"><small>今日完成</small><b>${doneToday.length}<span>單</span></b></div>
    <div class="kpi"><small>今日車費</small><b>$${money(earned)}</b></div>
    <div class="kpi"><small>接單上限</small><b>無</b></div>
  </div>
  ${jobs.length ? jobs.map(o => jobCard(o, p)).join('') : `<div class="empty"><b>仲未接過單</b>去「接單大廳」睇下有咩單啱你。</div>`}`;
}

function jobCard(o, p){
  const m = MODES[o.mode];
  const nav = o.status === 'picked' ? o.drop.addr : o.pickup.addr;
  const navD = o.status === 'picked' ? o.drop.district : o.pickup.district;
  return `
  <article class="card order-card">
    <div class="o-top">
      <div class="o-route">
        <div class="rd"><span class="dotpick"></span><b>${esc(o.pickup.district)}</b><span>${esc(o.pickup.addr)}</span></div>
        <div class="arw">↓</div>
        <div class="rd"><span class="dotdrop"></span><b>${esc(o.drop.district)}</b><span>${esc(o.drop.addr)}</span></div>
      </div>
      <div class="badges" style="margin:0">
        <span class="badge ${o.status === 'delivered' ? 'ok' : 'haz'}">${STATUS[o.status]}</span>
        <span class="badge ink">$${money(o.finalTotal || o.agreedPrice)}</span>
      </div>
    </div>
    <div class="badges">
      <span class="badge ${o.mode === 'van' ? 'van' : 'line'}">${m.name}</span>
      <span class="badge">${esc(o.weight)} kg</span>
      <span class="badge">${esc(o.goods.type)} · ${esc(o.goods.pieces)} 件</span>
      <span class="badge">${fmtKm(o.km)}</span>
      <span class="badge">提貨 ${tlab(o, o.pickup.from)}–${esc(o.pickup.to)}</span>
      <span class="badge">${tlab(o, o.drop.deadline)} 前</span>
      ${o.mode !== 'walk' ? `<span class="badge">${o.mode === 'car' ? '隧道／停車另議' : '隧道／停車另計'}</span>` : ''}
      ${o.upstairs ? `<span class="badge">可上樓 · 泊車約 $${UPSTAIRS_FEE}</span>` : ''}
    </div>
    ${stepBar(o.status)}
    <div class="o-note">
      <span>出貨人：</span><b>${esc(o.shipperName)}</b> · ${esc(o.shipperPhone)}<br>
      <span>收貨人：</span>${esc(o.consignee.name)} · ${esc(o.consignee.phone)}<br>
      <span>貨物：</span>${esc(o.goods.desc)}${o.goods.buyFor ? '（代購 · 要先收錢）' : ''}
      ${o.note ? `<br><span>備註：</span>${esc(o.note)}` : ''}
      ${o.mode !== 'walk' ? `<br><span>附加費：</span>${o.mode === 'car' ? '隧道／停車另議，完單輸入實報' : '隧道／停車另計'}` : ''}
    </div>
    <div class="o-actions">
      <a class="btn sm ghost" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navD + ' ' + nav)}" target="_blank" rel="noopener">導航</a>
      <a class="btn sm ghost" href="tel:${esc(o.shipperPhone)}">致電出貨人</a>
      ${o.status === 'accepted' ? `<button class="btn sm warn" data-act="openPickup" data-id="${o.id}">確認提貨</button>` : ''}
      ${o.status === 'picked' ? `<button class="btn sm warn" data-act="openDeliver" data-id="${o.id}">完成交收</button>` : ''}
      ${['accepted','picked'].includes(o.status) ? `<button class="btn sm danger" data-act="openCancelJob" data-id="${o.id}">取消</button>` : ''}
      ${o.status === 'delivered' ? `<span class="badge ok">實收 $${money(o.finalTotal || o.agreedPrice)} · ${esc(o.payMethod || '')}</span>` : ''}
    </div>
    ${o.status !== 'delivered' ? `<p class="bid-hint">提貨碼由出貨人提供；交收碼由收貨人提供，輸入正確先確認。</p>` : ''}
  </article>`;
}

/* ---------- 提貨 ---------- */
function openPickup(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  openModal(`
    <div class="modal-head">
      <div><h3>確認提貨</h3><small>${esc(o.pickup.district)} · ${esc(o.pickup.addr)}</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="notice calm">${icoInfo()} 問出貨人攞 4 位提貨碼，核對貨物同描述一樣先好收。</div>
      <div class="field" style="margin-top:11px"><label>提貨碼</label><input type="tel" inputmode="numeric" maxlength="4" id="pickupCode" placeholder="4 位數字"></div>
    </div>
    <div class="modal-foot">
      <button class="btn warn" data-act="confirmPickup" data-id="${o.id}">確認提貨</button>
      <button class="btn ghost" data-act="closeModal">閂</button>
    </div>`);
}
function confirmPickup(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const code = ($('#pickupCode').value || '').trim();
  if(code !== o.pickupCode) return toast('提貨碼唔啱，問清楚出貨人', 'err');
  o.status = 'picked'; o.pickedAt = Date.now();
  pushNotice(o.shipperPhone, '司機已提貨', `${o.pickup.district} → ${o.drop.district} · 正在送往收貨人`, o.id, 'picked');
  saveDB(); closeModal(); render(); toast('已確認提貨', 'ok');
}

/* ---------- 交收 ---------- */
function openDeliver(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const isCar = o.mode === 'car', isVan = o.mode === 'van';
  openModal(`
    <div class="modal-head">
      <div><h3>完成交收</h3><small>協定車費 $${money(o.agreedPrice)} · ${isVan ? '隧道／停車另計' : isCar ? '隧道／停車另議' : '步兵'}${o.upstairs ? ` · 上樓泊車約 $${UPSTAIRS_FEE}` : ''}</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="notice calm">${icoInfo()} 問收貨人攞 4 位交收碼；收到錢先好確認。</div>
      <div class="field" style="margin-top:11px"><label>交收碼</label><input type="tel" inputmode="numeric" maxlength="4" id="dropCode" placeholder="4 位數字"></div>
      ${(isCar || isVan) ? `
      <div class="grid two" style="margin-top:10px">
        <div class="field"><label>隧道費（HK$）</label><input type="number" min="0" step="1" id="tunnelFee" value="0"></div>
        <div class="field"><label>停車場費（HK$）</label><input type="number" min="0" step="1" id="parkingFee" value="0"></div>
      </div>` : ''}
      ${o.upstairs ? `
      <div class="field" style="margin-top:9px"><label>上樓泊車費（一般 $${UPSTAIRS_FEE}）</label><input type="number" min="0" step="1" id="upstairsFee" value="${UPSTAIRS_FEE}"></div>` : ''}
      <div class="field" style="margin-top:10px"><label>收款方式</label>
        <select id="payMethod">${PAYS.map(x => `<option>${x}</option>`).join('')}</select>
      </div>
      <label class="check" style="margin-top:10px">
        <input type="checkbox" id="paidCheck">
        <span>我已收妥車費同附加費，並核對貨物交到收貨人手上。</span>
      </label>
    </div>
    <div class="modal-foot">
      <button class="btn warn" data-act="confirmDeliver" data-id="${o.id}">確認完成</button>
      <button class="btn ghost" data-act="closeModal">閂</button>
    </div>`);
}
function confirmDeliver(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const code = ($('#dropCode').value || '').trim();
  if(code !== o.dropCode) return toast('交收碼唔啱，問清楚收貨人', 'err');
  if(!$('#paidCheck').checked) return toast('要先確認已收妥車費', 'err');
  const tunnel = num($('#tunnelFee') && $('#tunnelFee').value);
  const parking = num($('#parkingFee') && $('#parkingFee').value);
  const upstairs = num($('#upstairsFee') && $('#upstairsFee').value);
  const base = num(o.agreedPrice);
  o.finalFee = { base, tunnel, parking, upstairs };
  o.finalTotal = Math.round((base + tunnel + parking + upstairs) * 10) / 10;
  o.payMethod = $('#payMethod').value;
  o.status = 'delivered'; o.deliveredAt = Date.now();
  pushNotice(o.shipperPhone, '已完成交收 · 實收 $' + money(o.finalTotal), `${o.pickup.district} → ${o.drop.district} · ${o.payMethod}`, o.id, 'delivered');
  saveDB(); closeModal(); render();
  toast('已交收 · 實收 $' + money(o.finalTotal), 'ok');
}

/* ---------- 取消接單 ---------- */
function openCancelJob(oid){
  openModal(`
    <div class="modal-head">
      <div><h3>取消接單</h3><small>張單會重返大廳，其他司機會收到</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="field"><label>原因</label>
        <select id="cancelJobReason">
          <option>貨物同描述不符</option>
          <option>等太耐</option>
          <option>冇位泊車</option>
          <option>載唔到／太重</option>
          <option>有危險</option>
          <option>其他</option>
        </select>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn danger" data-act="confirmCancelJob" data-id="${oid}">確認取消</button>
      <button class="btn ghost" data-act="closeModal">閂</button>
    </div>`);
}
function confirmCancelJob(oid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const reason = $('#cancelJobReason').value;
  o.status = 'open'; o.driverPhone = null; o.agreedPrice = null; o.acceptedAt = null;
  o.cancelNote = '司機取消：' + reason;
  o.recastAt = Date.now();
  if(o.offers) o.offers.forEach(f => { if(f.status === 'accepted') f.status = 'open'; });
  pushNotice(o.shipperPhone, '接貨人取消咗', `${o.pickup.district} → ${o.drop.district} · 張單已重返大廳`, o.id, 'cancelled');
  saveDB(); closeModal(); render(); toast('已取消，張單重返大廳');
}

/* ---------- 我的報價 ---------- */
function renderMyOffers(p){
  const list = myOffers().sort((a, b) => b.createdAt - a.createdAt);
  return `
  ${list.length ? list.map(o => {
    const f = (o.offers || []).find(x => x.driverPhone === p.phone && x.status === 'open');
    if(!f) return '';
    const m = MODES[o.mode];
    return `
    <article class="card order-card">
      <div class="o-top">
        <div class="o-route">
          <div class="rd"><span class="dotpick"></span><b>${esc(o.pickup.district)}</b><span>${esc(o.pickup.addr)}</span></div>
          <div class="arw">↓</div>
          <div class="rd"><span class="dotdrop"></span><b>${esc(o.drop.district)}</b><span>${esc(o.drop.addr)}</span></div>
        </div>
        <div class="badges" style="margin:0"><span class="badge ink">$${money(f.price)}</span></div>
      </div>
      <div class="badges">
        <span class="badge">${m.name}</span>
        <span class="badge">${esc(o.weight)} kg</span>
        <span class="badge">${esc(o.goods.type)}</span>
        <span class="badge">${tlab(o, o.pickup.from)}–${esc(o.pickup.to)} 提貨</span>
        <span class="badge ${f.by === 'shipper' ? 'haz' : ''}">${f.by === 'shipper' ? '出貨人還價' : '你已開價'}</span>
      </div>
      ${(f.history || []).length ? `<ul class="turns">${f.history.slice(-3).map(t => `<li><b class="${t.by === 'driver' ? 'who-driver' : 'who-shipper'}">${t.by === 'driver' ? '你' : '出貨人'}</b><span>$${money(t.price)}</span></li>`).join('')}</ul>` : ''}
      ${f.note ? `<div class="offer-note">「${esc(f.note)}」</div>` : ''}
      <div class="o-actions">
        ${f.by === 'shipper' ? `<button class="btn sm warn" data-act="acceptOffer" data-oid="${o.id}" data-fid="${f.id}">接受 $${money(f.price)}</button>` : ''}
        <button class="btn sm ghost" data-act="openQuote" data-id="${o.id}">${f.by === 'shipper' ? '再還價' : '改報價'}</button>
        <button class="btn sm ghost" data-act="withdrawOffer" data-oid="${o.id}" data-fid="${f.id}">撤回</button>
      </div>
    </article>`;
  }).join('') : `<div class="empty"><b>你未有開出嘅報價</b>去「接單大廳」揀張單開價，出貨人接受咗就會出現喺「我的接單」。</div>`}`;
}

function withdrawOffer(oid, fid){
  const o = db.orders.find(x => x.id === oid); if(!o) return;
  const f = (o.offers || []).find(x => x.id === fid); if(!f) return;
  pushNotice(o.shipperPhone, '接貨人撤回咗出價 $' + money(f.price), `${o.pickup.district} → ${o.drop.district}`, o.id, 'withdrawn');
  o.offers = (o.offers || []).filter(x => x.id !== fid);
  saveDB(); render(); toast('已撤回報價');
}

/* ---------- 設定 ---------- */
function renderSettings(p){
  return `
  <div class="sec">
    <div class="sec-head"><span class="sec-no">1</span><h3>你嘅資料</h3><small>${serverMode ? '同步到後端' : '只存喺你部機'}</small></div>
    <div class="sec-body">
      <div class="grid two">
        <div class="field"><label>稱呼</label><input type="text" id="setName" maxlength="16" value="${esc(p.name)}"></div>
        <div class="field"><label>車牌（步兵可留空）</label><input type="text" id="setPlate" maxlength="10" value="${esc(p.plate || '')}" placeholder="AB 1234"></div>
      </div>
      <div class="field" style="margin-top:11px">
        <label>送貨方式（會決定你見到咩單）</label>
        <div class="mode-cards">
          ${Object.keys(MODES).map(k => `
            <button class="mode ${p.mode === k ? 'on' : ''}" data-act="setDriverMode" data-mode="${k}">
              <b>${MODES[k].name}</b><span>${MODES[k].tag}</span>
            </button>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-top:11px">
        <label>可接地區（唔揀即全港）</label>
        <div class="chips">
          ${AREAS.map(a => `<button class="chip ${p.areas && p.areas.includes(a) ? 'on' : ''}" data-act="toggleArea" data-a="${a}">${a}</button>`).join('')}
        </div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-act="saveSettings">儲存資料</button>
        <button class="btn ghost" data-act="goBoard">睇接單大廳</button>
      </div>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">2</span><h3>上線與播報</h3></div>
    <div class="sec-body">
      <div class="inline" style="gap:14px">
        <button class="switch ${p.online ? 'on' : ''}" data-act="toggleOnline"><span class="track"><span class="knob"></span></span>上線接單</button>
        <button class="switch ${p.announce ? 'on' : ''}" data-act="toggleAnnounce"><span class="track"><span class="knob"></span></span>語音播報</button>
        <button class="btn sm ghost" data-act="testVoice">試播報</button>
      </div>
      <div class="settings-hint" style="margin-top:8px">接單上限：無。你可以拒接、可以取消，平台唔會罰你。</div>
      <div class="inline" style="margin-top:9px">
        <button class="btn sm ghost" data-act="askNotify">開啟桌面通知</button>
        <button class="btn sm ghost" data-act="openNotices">通知中心</button>
      </div>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">3</span><h3>示範資料</h3></div>
    <div class="sec-body">
      <div class="settings-hint">${serverMode ? '後端版：資料會同步到伺服器；清除瀏覽器資料後重新登入會由後端取回。' : '純靜態版：所有資料只存喺瀏覽器（localStorage）；清除瀏覽器資料就會回復種子示範單。'}</div>
      <div class="btn-row" style="margin-top:9px">
        <button class="btn sm ghost" data-act="resetDemo">重設示範資料</button>
      </div>
    </div>
  </div>
  <div class="sec">
    <div class="sec-head"><span class="sec-no">4</span><h3>版本</h3></div>
    <div class="sec-body">
      <div class="summary-line"><span>而家版本</span><b>${APP_VER_TAG}（${APP_VERSION}）</b></div>
      <div class="settings-hint" style="margin-top:7px">新版上線會自動提示；更新只會換程式，訂單、帳戶同通知都會保留。</div>
      <div class="btn-row" style="margin-top:9px">
        <button class="btn sm ghost" data-act="checkUpdate">檢查更新</button>
      </div>
    </div>
  </div>`;
}

/* =========================================================
   互動
   ========================================================= */
function onClick(e){
  const el = e.target.closest('[data-act]');
  if(!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id, oid = el.dataset.oid, fid = el.dataset.fid;
  const p = me();

  /* 登入 */
  if(act === 'pickRole'){ ui.rolePick = el.dataset.role; renderLogin(); return; }
  if(act === 'pickMode'){ ui.modePick = el.dataset.mode; renderLogin(); return; }
  if(act === 'login'){ doLogin(); return; }

  /* 通用 */
  if(act === 'tab'){ ui.tab = el.dataset.tab; render(); return; }
  if(act === 'home'){ if(p) ui.tab = p.role === 'driver' ? 'board' : 'new'; render(); return; }
  if(act === 'closeModal'){ closeModal(); return; }
  if(act === 'closeAndOrders'){ closeModal(); ui.tab = 'orders'; render(); return; }
  if(act === 'help'){ openHelp(); return; }
  if(act === 'openNotices'){ openNotices(); return; }
  if(act === 'openNotice'){ openNotice(el.dataset.id); return; }
  if(act === 'askNotify'){ askNotify(); return; }
  if(act === 'enablePush'){ enableServerPush(true); return; }
  if(act === 'testSpeech'){
    if(!p) return;
    if(!('speechSynthesis' in window)){ toast('呢個瀏覽器未支援語音播報', 'err'); return; }
    unlockSpeech();
    speak('快送語音測試。步兵，東涌去機場，八公斤，等司機報價。');
    toast('已播放測試語音；如果冇聲，請檢查媒體音量／靜音掣', 'ok');
    return;
  }
  if(act === 'checkUpdate'){ checkUpdate(true); return; }
  if(act === 'doUpdate'){ applyUpdate(true); return; }
  if(act === 'hideUpdate'){ hideUpdateBar(); return; }
  if(act === 'logout'){ clearSession(); ui.draft = null; render(); toast('已登出'); return; }
  if(act === 'switchRole'){
    if(!p) return;
    p.role = p.role === 'shipper' ? 'driver' : 'shipper';
    saveDB();
    ui.tab = p.role === 'driver' ? 'board' : 'new';
    ui.draft = null;
    lastAnnouncedAt = Date.now();
    render();
    toast('已切換做' + (p.role === 'driver' ? '接貨人' : '出貨人'), 'ok');
    return;
  }

  /* 落單表 */
  if(act === 'setMode'){
    if(!ui.draft) return;
    ui.draft.mode = el.dataset.mode;
    render(); return;
  }
  if(act === 'setPricing'){ ui.draft.pricing = el.dataset.p; render(); return; }
  if(act === 'setGoods'){ ui.draft.goods = el.dataset.g; render(); return; }
  if(act === 'useRef'){ ui.draft.askPrice = el.dataset.ref; ui.draft.pricing = 'fixed'; render(); return; }
  if(act === 'toggleBuyFor'){ ui.draft.buyFor = !ui.draft.buyFor; render(); return; }
  if(act === 'submitOrder'){ submitOrder(); return; }

  /* 出貨人 */
  if(act === 'detail'){ openDetail(id); return; }
  if(act === 'recast'){
    const o = db.orders.find(x => x.id === id); if(!o) return;
    o.recastAt = Date.now(); notifyNewOrder(o); saveDB();
    speak(announceText(o)); render(); toast('已重新播報', 'ok'); return;
  }
  if(act === 'cancelOrder'){ openCancelOrder(id); return; }
  if(act === 'confirmCancelOrder'){ confirmCancelOrder(id); return; }
  if(act === 'acceptOffer'){ acceptOffer(oid, fid); return; }
  if(act === 'declineOffer'){ declineOffer(oid, fid); return; }
  if(act === 'counter'){ openCounter(oid, fid, 'shipper'); return; }
  if(act === 'driverCounter'){ openCounter(oid, fid, 'driver'); return; }
  if(act === 'acceptCounter'){ acceptOffer(oid, fid); return; }
  if(act === 'reveal'){ openContactReveal(db.orders.find(x => x.id === oid)); return; }
  if(act === 'submitCounter'){ submitCounter(oid, fid, el.dataset.by); return; }

  /* 接貨人 */
  if(act === 'openQuote'){ openQuote(id); return; }
  if(act === 'submitQuote'){ submitQuote(id); return; }
  if(act === 'acceptFixed'){ acceptFixed(id); return; }
  if(act === 'withdrawOffer'){ withdrawOffer(oid, fid); return; }

  if(act === 'openPickup'){ openPickup(id); return; }
  if(act === 'confirmPickup'){ confirmPickup(id); return; }
  if(act === 'openDeliver'){ openDeliver(id); return; }
  if(act === 'confirmDeliver'){ confirmDeliver(id); return; }
  if(act === 'openCancelJob'){ openCancelJob(id); return; }
  if(act === 'confirmCancelJob'){ confirmCancelJob(id); return; }

  /* 設定 */
  if(act === 'openSettings'){ ui.tab = 'settings'; render(); return; }
  if(act === 'goBoard'){ ui.tab = 'board'; render(); return; }
  if(act === 'toggleOnline'){ if(!p) return; p.online = !p.online; saveDB(); render(); toast(p.online ? '已上線，會收到新單播報' : '已離線'); return; }
  if(act === 'toggleAnnounce'){ if(!p) return; p.announce = !p.announce; saveDB(); render(); toast(p.announce ? '語音播報已開' : '語音播報已關'); if(!$('#modal').hidden) openNotices(); return; }
  if(act === 'testVoice'){
    speak('快送測試。步兵，東涌去機場，8 公斤，等司機報價。');
    toast('試播報（要先開聲）'); return;
  }
  if(act === 'setDriverMode'){
    if(!p) return;
    p.mode = el.dataset.mode; saveDB(); render();
    toast('已轉做' + MODES[p.mode].name + '，大廳只會見到呢類單', 'ok'); return;
  }
  if(act === 'toggleArea'){
    if(!p) return;
    p.areas = p.areas || [];
    const a = el.dataset.a;
    p.areas = p.areas.includes(a) ? p.areas.filter(x => x !== a) : p.areas.concat(a);
    saveDB(); render(); return;
  }
  if(act === 'saveSettings'){
    if(!p) return;
    p.name = ($('#setName').value || '').trim() || p.name;
    p.plate = ($('#setPlate').value || '').trim();
    saveDB(); render(); toast('已儲存', 'ok'); return;
  }
  if(act === 'resetDemo'){ openResetConfirm(); return; }
  if(act === 'confirmReset'){
    seedDB(); saveDB();
    if(session && !db.profiles[session.phone]) clearSession();
    ui.draft = null; ui.tab = session ? 'new' : 'new';
    closeModal(); render(); toast('已重設示範資料', 'ok'); return;
  }
}

/* ---------- 說明彈窗 ---------- */
function openHelp(){
  openModal(`
    <div class="modal-head">
      <div><h3>點樣試「快送」</h3><small>示範版 ${APP_VER_TAG} · 唔使電腦都得</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="notice">${icoInfo()} ${serverMode ? '後端版：開兩個瀏覽器／兩部電話，一個登入出貨人、一個登入接貨人，訂單會即時同步。' : '純靜態版：開兩個瀏覽器視窗（唔好「複製分頁」），一個登入出貨人、一個登入接貨人；只會喺同一個瀏覽器同步。'}</div>
      <div class="hr"></div>
      <div class="summary-line"><span>出貨人示範號</span><b>9123 4567</b></div>
      <div class="summary-line"><span>接貨人示範號</span><b>9876 5432</b></div>
      <div class="summary-line"><span>登入</span><b>輸入電話即可，唔使驗證碼</b></div>
      <div class="hr"></div>
      <p style="font-size:12.5px;line-height:1.7">
      1. 出貨人登入 → 落單：揀步兵／私家車／貨van、填 8kg、揀「我定價」或「由司機開價」。<br>
      2. 接貨人登入 → 大廳見到同類單 → 報價或直接接單。<br>
      3. 出貨人喺「我的訂單」睇出價 → 接受／還價 → 揀邊個送；一接受即彈出雙方電話。<br>
      4. 接貨人確認提貨（輸入提貨碼）→ 完成交收（輸入交收碼＋附加費）。</p>
      <div class="notice calm" style="margin-top:10px">${icoInfo()} ${serverMode ? '資料同步到後端；想由頭再試，去接貨人「設定」→ 重設示範資料。' : '資料只存喺你部機嘅瀏覽器。想由頭再試，去接貨人「設定」→ 重設示範資料。'}</div>
      <div class="summary-line" style="margin-top:10px"><span>而家版本</span><b>${APP_VER_TAG}（更新會保留舊資料）</b></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-act="closeModal">閂</button></div>`);
}

/* ---------- 通知中心 ---------- */
function openNotices(){
  const p = me(); if(!p) return;
  const mine = (db.notices || []).filter(n => n.phone === p.phone).sort((a, b) => b.at - a.at).slice(0, 30);
  const items = mine.map(n => `
    <button class="notice-item ${n.read ? '' : 'unread'}" data-act="openNotice" data-id="${n.id}">
      <b>${esc(n.title)}</b>
      <span>${esc(n.body)}</span>
      <small>${timeAgo(n.at)}</small>
    </button>`).join('');
  mine.forEach(n => n.read = true);
  saveDB(); render();
  const perm = notifyPermission();
  openModal(`
    <div class="modal-head">
      <div><h3>通知</h3><small>新單、出價、接單、交收都會喺呢度</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      ${perm === 'default' ? `<div class="notice calm" style="margin-bottom:9px">${icoInfo()} 開啟桌面通知，背景分頁都會彈提示。<div style="margin-top:7px"><button class="btn sm warn" data-act="askNotify">開啟桌面通知</button></div></div>` : ''}
      ${perm === 'denied' ? `<div class="notice warn" style="margin-bottom:9px">${icoWarn()} 瀏覽器已封鎖通知；可以喺網址列左邊嘅鎖圖示再開。站內通知照樣會收到。</div>` : ''}
      ${perm === 'unsupported' ? `<div class="notice calm" style="margin-bottom:9px">${icoInfo()} 呢個瀏覽器未支援桌面通知；站內通知照樣會收到。</div>` : ''}
      <div class="inline" style="justify-content:space-between;margin-bottom:9px">
        <button class="switch ${p.announce ? 'on' : ''}" data-act="toggleAnnounce"><span class="track"><span class="knob"></span></span>語音播報</button>
        <button class="btn sm ghost" data-act="checkUpdate">檢查更新</button>
      </div>
      <div class="notice-list">${items || `<div class="empty" style="padding:16px 0"><b>暫時未有通知</b>有新單、出價或者接單就會出現。</div>`}</div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-act="closeModal">閂</button></div>`);
}
function openNotice(id){
  const n = (db.notices || []).find(x => x.id === id); if(!n) return;
  n.read = true; saveDB();
  const p = me(); closeModal();
  if(p){
    if(p.role === 'shipper'){ ui.tab = 'orders'; }
    else{
      const o = db.orders.find(x => x.id === n.oid);
      ui.tab = (o && ['accepted','picked','delivered'].includes(o.status)) ? 'jobs' : (n.type === 'offer' ? 'offers' : 'board');
    }
  }
  render();
  toast(n.title);
}
async function askNotify(){
  if(serverMode){ await enableServerPush(true); openNotices(); return; }
  if(!('Notification' in window)){ toast('呢個瀏覽器未支援桌面通知', 'err'); return; }
  try{
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? '已開啟桌面通知' : '未開啟；可喺瀏覽器設定再開', r === 'granted' ? 'ok' : '');
    openNotices();
  }catch(e){ toast('開啟通知失敗，請喺瀏覽器設定手動開', 'err'); }
}

function openResetConfirm(){
  openModal(`
    <div class="modal-head">
      <div><h3>重設示範資料？</h3><small>會清走所有訂單同報價</small></div>
      <button class="x-btn" data-act="closeModal"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body"><div class="notice warn">${icoWarn()} 你出過嘅單、報價同帳戶資料都會清走，冇得復原。</div></div>
    <div class="modal-foot">
      <button class="btn danger" data-act="confirmReset">確認重設</button>
      <button class="btn ghost" data-act="closeModal">唔重設</button>
    </div>`);
}

/* ---------- 輸入同步 ---------- */
function syncDraft(el){
  if(!ui.draft) return;
  if(el.dataset.f){
    ui.draft[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
  }
  if(el.dataset.c){
    ui.draft[el.dataset.c] = el.checked;
  }
}
document.addEventListener('input', e => { syncDraft(e.target); });
document.addEventListener('change', e => {
  const el = e.target;
  if(el.dataset.filter){
    ui.filter[el.dataset.filter] = el.value;
    render(); return;
  }
  if(!el.dataset.f && !el.dataset.c) return;
  syncDraft(el);
  if(el.dataset.f === 'fromD' || el.dataset.f === 'toD'){
    ui.draft.km = String(estKm(ui.draft.fromD, ui.draft.toD));
  }
  if(el.dataset.f && el.dataset.rerender) render();
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closeModal();
  if(e.key === 'Enter' && ui.screen === 'login' && e.target.matches('[data-login]')){
    e.preventDefault(); doLogin();
  }
});
$('#modal').addEventListener('click', e => { if(e.target.id === 'modal') closeModal(); });

/* =========================================================
   示範資料
   ========================================================= */
function seedDB(){
  const base = Date.now();
  db.orders = [];
  db.notices = [];
  db.profiles = {
    '91234567': { phone:'91234567', role:'shipper', name:'陳記果欄', mode:'car', plate:'', online:false, announce:true, areas:[], createdAt: base - 86400000 },
    '91230000': { phone:'91230000', role:'driver', name:'阿強', mode:'car', plate:'AB 1234', online:true, announce:true, areas:[], createdAt: base - 86400000 }
  };

  const mk = (cfg, i) => {
    const f = clock(cfg.t1), t = clock(cfg.t2), dd = clock(cfg.t3);
    const o = {
      id: uid(), code: 'KS' + (2001 + i),
      shipperPhone: '91234567', shipperName: '陳記果欄',
      mode: cfg.mode, weight: cfg.weight, km: estKm(cfg.fromD, cfg.toD),
      pickup: { district: cfg.fromD, addr: cfg.fromAddr, from: f.t, to: t.t },
      drop: { district: cfg.toD, addr: cfg.toAddr, deadline: dd.t },
      goods: { type: cfg.goods, desc: cfg.desc, pieces: cfg.pieces, sealed: true, buyFor: !!cfg.buyFor },
      consignee: { name: cfg.cName, phone: cfg.cPhone },
      note: cfg.note || '',
      pricing: cfg.pricing,
      askPrice: cfg.pricing === 'fixed' ? cfg.price : null,
      budget: cfg.pricing === 'quote' ? (cfg.budget || null) : null,
      upstairs: !!cfg.upstairs,
      offers: [],
      status: 'open',
      createdAt: base - i * 60000, recastAt: base - i * 60000,
      tomorrow: dd.tomorrow || t.tomorrow,
      pickupCode: code4(), dropCode: code4(),
      driverPhone: null, agreedPrice: null
    };
    if(cfg.offer){
      o.offers.push({
        id: uid(), driverPhone: '91230000', price: cfg.offer, note: '順路，7 點前到；隧道實報',
        by:'driver', at: base, status:'open',
        history: [{ by:'driver', price: cfg.offer, note:'順路，7 點前到；隧道實報', at: base }]
      });
    }
    return o;
  };

  db.orders = [
    mk({ mode:'walk', weight:8, fromD:'離島', fromAddr:'東涌站 A 出口（路邊）', toD:'離島', toAddr:'機場一號客運大樓（路邊）',
         t1:45, t2:100, t3:190, goods:'包裹', desc:'2 件已封箱文件袋', pieces:2, cName:'陳太', cPhone:'61234567',
         pricing:'fixed', price:80, note:'今次唔使上樓，可以路邊交收' }, 0),
    mk({ mode:'walk', weight:1, fromD:'灣仔', fromAddr:'灣仔地鐵站 A3 出口', toD:'中西區', toAddr:'中環砵典乍街 12 號門口',
         t1:35, t2:75, t3:150, goods:'文件', desc:'一個 A4 公文袋，已封口', pieces:1, cName:'李小姐', cPhone:'62345678',
         pricing:'quote', budget:60, upstairs:true, note:'送到 3 樓，上樓泊車約 $20' }, 1),
    mk({ mode:'car', weight:12, fromD:'油尖旺', fromAddr:'油麻地果欄 A 座門口（路邊）', toD:'沙田', toAddr:'沙田第一城 49 座對出巴士站',
         t1:55, t2:110, t3:240, goods:'生果', desc:'3 箱日本蜜瓜，已封箱', pieces:3, cName:'黃先生', cPhone:'63456789',
         pricing:'quote', budget:180, offer:160, note:'果欄門口可以短暫停車' }, 2),
    mk({ mode:'car', weight:5, fromD:'深水埗', fromAddr:'深水埗福華街 118 號門口', toD:'觀塘', toAddr:'觀塘 APM 停車場入口（路邊）',
         t1:40, t2:85, t3:175, goods:'包裹', desc:'一箱電子零件，已封箱', pieces:1, cName:'Kelvin', cPhone:'64567890',
         pricing:'fixed', price:120 }, 3),
    mk({ mode:'van', weight:25, fromD:'油尖旺', fromAddr:'油麻地果欄 B 座門口（路邊）', toD:'荃灣', toAddr:'荃灣楊屋道 8 號樓下',
         t1:65, t2:120, t3:250, goods:'生果', desc:'5 箱時令生果，已封箱', pieces:5, cName:'何太', cPhone:'65678901',
         pricing:'fixed', price:180, upstairs:true, note:'要上 3 樓，上樓泊車約 $20' }, 4),
    mk({ mode:'van', weight:40, fromD:'觀塘', fromAddr:'觀塘偉業街 128 號停車場入口', toD:'沙田', toAddr:'沙田火炭山尾街 23 號地下',
         t1:75, t2:130, t3:270, goods:'其他', desc:'兩箱傢俬配件，已封箱', pieces:2, cName:'張太', cPhone:'66789012',
         pricing:'quote', budget:400, note:'要貨van，私家車載唔到' }, 5)
  ];
}

/* =========================================================
   跨視窗同步 + 播報
   ========================================================= */
function absorbNextDB(next){
  if(!next || next.orders === undefined) return;
  const prevProfiles = db && db.profiles ? db.profiles : {};
  const prevOrders = db && Array.isArray(db.orders) ? db.orders : [];
  db = migrateDB(next);
  // 保留本機未同步嘅新帳戶／新單，避免被較舊嘅遠端快照蓋走
  Object.keys(prevProfiles).forEach(phone => {
    if(!db.profiles[phone]) db.profiles[phone] = prevProfiles[phone];
  });
  prevOrders.forEach(o => {
    if(o && o.id && !db.orders.some(x => x.id === o.id)) db.orders.push(o);
  });
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  const p = me();
  if(p){
    const freshN = (db.notices || []).filter(n => n.phone === p.phone && n.at > lastNoticeAt);
    if(freshN.length){
      freshN.sort((a, b) => a.at - b.at).forEach((n, i) => {
        showSystemNotice(n);
        if(p.announce && n.type !== 'newOrder') setTimeout(() => speak(n.title + '。' + n.body), i * 350);
      });
      const lastN = freshN[freshN.length - 1];
      if(lastN.type === 'newOrder') toast('新單：' + lastN.body, 'ok');
      else toast(lastN.title);
      lastNoticeAt = lastN.at;
    }
  }
  if(p && p.role === 'driver' && p.online){
    const fresh = db.orders.filter(o => o.status === 'open' && o.mode === p.mode &&
      (o.recastAt || o.createdAt) > lastAnnouncedAt && o.shipperPhone !== p.phone);
    if(fresh.length){
      if(p.announce) fresh.forEach((o, i) => setTimeout(() => speak(announceText(o)), i * 400));
      toast('有 ' + fresh.length + ' 張新單／重新播報');
    }
    lastAnnouncedAt = Date.now();
  }
  if(!isTyping()) render();
}

function refreshFromDB(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    if(!raw) return;
    const next = JSON.parse(raw);
    if(!next || next.orders === undefined || next.rev === db.rev) return;
    absorbNextDB(next);
  }catch(e){}
}

/* =========================================================
   後端同步（同一份訂單喺所有裝置共享）
   ========================================================= */
async function fetchServerState(){
  try{
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const r = await fetch('./api/state?ts=' + Date.now(), { cache:'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if(!r.ok) return null;
    const data = await r.json();
    if(data && typeof data.rev === 'number' && data.db !== undefined) return data;
    return null;
  }catch(e){ return null; }
}

function queueServerSave(){
  if(!serverMode) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(pushServerState, 180);
}

async function pushServerState(){
  if(!serverMode) return;
  try{
    const r = await fetch('./api/state?ts=' + Date.now(), {
      method:'PUT',
      headers:{ 'Content-Type':'application/json' },
      cache:'no-store',
      body: JSON.stringify({ db })
    });
    if(!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    if(typeof data.rev === 'number') serverRev = data.rev;
  }catch(e){
    // 後端暫時離線：保留本機資料，稍後再試
    if(serverMode) setTimeout(() => { if(serverMode) pushServerState(); }, 2500);
  }
}

function startServerEvents(){
  if(!serverMode || typeof EventSource === 'undefined') return;
  try{
    const es = new EventSource('./api/events');
    es.addEventListener('state', async (ev) => {
      let info = null;
      try{ info = JSON.parse(ev.data); }catch(e){ return; }
      if(!info || typeof info.rev !== 'number' || info.rev === serverRev) return;
      const remote = await fetchServerState();
      if(remote && remote.rev !== serverRev){
        serverRev = remote.rev;
        absorbNextDB(remote.db);
      }
    });
  }catch(e){}
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function enableServerPush(requestPermission){
  if(!serverMode){
    if(requestPermission) toast('要使用後端版先可以跨裝置推送通知', 'err');
    return;
  }
  if(!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)){
    if(requestPermission) toast('呢個瀏覽器未支援 Web Push 通知', 'err');
    return;
  }
  if(!session){ if(requestPermission) toast('請先登入', 'err'); return; }
  let perm = Notification.permission;
  if(perm === 'default' && requestPermission){
    if(requestPermission) toast('正在開啟通知…');
    try{
      perm = await Promise.race([
        Notification.requestPermission(),
        new Promise(r => setTimeout(() => r('default'), 12000))
      ]);
    }catch(e){ perm = 'denied'; }
  }
  if(perm !== 'granted'){
    if(requestPermission) toast('通知未開啟；請喺瀏覽器設定允許通知', 'err');
    return;
  }
  try{
    let reg = await navigator.serviceWorker.getRegistration();
    if(!reg){
      reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(r => setTimeout(() => r(null), 5000))
      ]);
    }
    if(!reg) throw new Error('Service Worker 未就緒');
    const keyRes = await fetch('./api/push/key?ts=' + Date.now(), { cache:'no-store' });
    const keyData = await keyRes.json();
    if(!keyData.publicKey) throw new Error('no vapid key');
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });
    }
    await fetch('./api/push/subscribe', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ phone: session.phone, subscription: sub })
    });
    pushReady = true;
    if(requestPermission) toast('已開啟新單通知', 'ok');
  }catch(e){
    console.warn('push setup failed', e);
    if(requestPermission) toast('開啟通知失敗：' + (e.message || '請稍後再試'), 'err');
  }
}

function startSync(){
  try{
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = () => refreshFromDB();
  }catch(e){}
  window.addEventListener('storage', e => { if(e.key === DB_KEY) refreshFromDB(); });
  setInterval(refreshFromDB, 2000);
}

/* =========================================================
   版本檢查與自動更新
   ========================================================= */
let updateChecking = false, updateNewVer = null;
function checkUpdate(manual){
  if(location.protocol === 'file:'){ if(manual) toast('本機檔案版：直接開最新檔案就係最新版'); return; }
  if(updateChecking) return;
  updateChecking = true;
  fetch(location.pathname + '?kscheck=' + Date.now(), { cache:'no-store' })
    .then(r => r.ok ? r.text() : Promise.reject(new Error('http' + r.status)))
    .then(html => {
      const m = html.match(/<meta\s+name=["']app-version["']\s+content=["']([^"']+)["']/i);
      const v = m ? m[1] : null;
      if(v && v !== APP_VERSION){
        if(applyUpdate(false, v)) return;
        showUpdateBar(v);
      }else if(manual){
        toast('已經係最新版本 ' + APP_VER_TAG, 'ok');
      }
    })
    .catch(() => { if(manual) toast('檢查更新失敗，請稍後再試', 'err'); })
    .finally(() => { updateChecking = false; });
}
function applyUpdate(force, ver){
  const target = location.pathname + '?v=' + Date.now();
  if(force){ location.replace(target); return true; }
  const seen = sessionStorage.getItem('ks_autoupd') || '';
  if(ver && seen === ver) return false;
  const modalOpen = !$('#modal').hidden;
  // 有登入都照自動更新：session 同訂單存喺 localStorage，唔會清走
  if(!modalOpen && !isTyping()){
    sessionStorage.setItem('ks_autoupd', ver || APP_VERSION);
    location.replace(target);
    return true;
  }
  return false;
}
function showUpdateBar(v){
  if($('#updateBar') || sessionStorage.getItem('ks_update_skip') === v) return;
  updateNewVer = v;
  const el = document.createElement('div');
  el.id = 'updateBar'; el.className = 'update-bar';
  el.innerHTML = `<div><b>有新版本 ${esc(v)}</b><span>訂單同帳戶會保留，唔使清理資料</span></div>
    <button class="btn sm warn" data-act="doUpdate">立即更新</button>
    <button class="x" data-act="hideUpdate" title="稍後">×</button>`;
  document.body.appendChild(el);
}
function hideUpdateBar(){
  const b = $('#updateBar'); if(b) b.remove();
  sessionStorage.setItem('ks_update_skip', updateNewVer || '');
}
function startUpdateCheck(){
  setTimeout(() => checkUpdate(false), 2500);
  setInterval(() => checkUpdate(false), 600000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) checkUpdate(false); });
}

/* =========================================================
   啟動
   ========================================================= */
async function boot(){
  const local = loadDB();
  let remote = null;
  try{ remote = await fetchServerState(); }catch(e){}
  if(remote){
    serverMode = true;
    serverRev = remote.rev;
  }
  if(remote && remote.db && Array.isArray(remote.db.orders)){
    db = migrateDB(remote.db);
    // 後端空白時，沿用本機示範資料
    if(!db.orders.length && local.orders.length) db = local;
  }else{
    db = local;
  }
  if(!db.orders.length){
    seedDB();
    saveDB();
  }
  lastNoticeAt = Date.now();
  let raw = null;
  try{ raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); }catch(e){}
  try{ if(raw) session = JSON.parse(raw); }catch(e){ session = null; }
  if(session && !db.profiles[session.phone]) session = null;
  ui.draft = null;
  render();
  startSync();
  startServerEvents();
  startUpdateCheck();
  registerServiceWorker();
  listenServiceWorkerMessages((id) => {
    if((db.notices || []).some(n => n.id === id)) openNotice(id);
  });
  if(serverMode && session) setTimeout(() => enableServerPush(false), 500);
  try{
    const wanted = new URLSearchParams(location.search).get('notice');
    if(wanted) setTimeout(() => openNotice(wanted), 450);
  }catch(e){}
}

document.addEventListener('click', onClick);
boot();