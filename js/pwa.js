/* =========================================================
   快送 · PWA（Service Worker／系統通知）
   ========================================================= */
const canUseSW = () => 'serviceWorker' in navigator && location.protocol !== 'file:';

export async function registerServiceWorker(){
  if(!canUseSW()) return null;
  try{
    const hadController = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register('./sw.js', { scope:'./', updateViaCache:'none' });
    if(reg && reg.update) reg.update().catch(() => {});
    // 新 Service Worker 接手後自動 reload 一次，確保 app.js 都更新
    if(hadController){
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if(refreshing) return;
        refreshing = true;
        location.reload();
      });
    }
    return reg;
  }catch(err){
    console.warn('SW register failed', err);
    return null;
  }
}

export async function showSystemNotification(title, body, tag){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    if(reg && 'showNotification' in reg){
      await reg.showNotification(title, {
        body,
        tag,
        icon:'./icons/icon-192.png',
        badge:'./icons/icon-192.png',
        data:{ tag },
        renotify:false
      });
      return;
    }
    const n = new Notification(title, { body, tag, icon:'./icons/icon-192.png' });
    n.onclick = () => { try{ window.focus(); }catch(e){} n.close(); };
  }catch(err){
    console.warn('notification failed', err);
  }
}

export function listenServiceWorkerMessages(cb){
  if(!canUseSW()) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if(data.type === 'ks-open-notice' && data.id) cb(data.id);
  });
}
