/* =========================================================
   快送 · 純工具函式
   ========================================================= */
import { DISTRICTS } from './config.js';

export const $ = (s, r) => (r || document).querySelector(s);
export const pad2 = n => String(n).padStart(2, '0');
export function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function money(n){ n = Number(n) || 0; return (Math.round(n * 10) / 10).toLocaleString('en-HK', {minimumFractionDigits: 0, maximumFractionDigits: 1}); }
export function num(v, d){ const x = parseFloat(v); return isNaN(x) ? (d || 0) : x; }
export function fmtKm(k){ return (Math.round(k * 10) / 10) + ' 公里'; }
export function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
export function code4(){ return String(Math.floor(1000 + Math.random() * 9000)); }
export function nowMin(){ const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
export function timeToMin(t){ if(!t) return 0; const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
export function tlab(o, t){ return o && o.tomorrow ? '明日 ' + t : t; }
export function clockLabel(m){
  m = ((m % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}
export function clock(offset){
  const m = nowMin() + offset;
  return { t: clockLabel(m), tomorrow: m >= 1440 };
}
export function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* 兩點距離：Haversine × 1.35（香港道路繞行） */
export function haversine(a, b){
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const x = Math.sin(dLat/2)**2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function estKm(fromD, toD){
  if(fromD === toD) return 2.5;
  const a = DISTRICTS[fromD], b = DISTRICTS[toD];
  if(!a || !b) return 5;
  const km = Math.round(haversine(a, b) * 1.35 * 2) / 2;
  return Math.max(1.5, km);
}

/* 市區紅的跳錶（只用嚟做私家車參考價） */
export function meterFare(km){
  const units = Math.max(0, Math.ceil(km * 5) - 10); // 首 2 公里 = 10 個 200 米
  let fare = 29;
  for(let i = 0; i < units; i++){
    const step = fare >= 102.5 ? 1.4 : 2.1;
    fare = Math.round((fare + step) * 10) / 10;
  }
  return fare;
}
