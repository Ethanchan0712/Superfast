/* =========================================================
   快送 · 粵語語音播報
   ========================================================= */
import { MODES, UPSTAIRS_FEE } from './config.js';

let voicesReady = false;
function pickVoice(){
  try{
    const vs = speechSynthesis.getVoices() || [];
    return vs.find(v => /zh[-_]HK|yue|Cantonese/i.test(v.lang + ' ' + v.name)) ||
           vs.find(v => /zh[-_]TW|zh[-_]CN|Chinese/i.test(v.lang + ' ' + v.name)) || null;
  }catch(e){ return null; }
}
export function speak(text){
  if(!('speechSynthesis' in window)) return;
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-HK'; u.rate = 0.92; u.pitch = 1;
    const v = pickVoice(); if(v) u.voice = v;
    speechSynthesis.speak(u);
  }catch(e){}
}
if('speechSynthesis' in window){
  speechSynthesis.onvoiceschanged = () => { voicesReady = true; };
}
export function announceText(o){
  const m = MODES[o.mode].name;
  const price = o.pricing === 'fixed' ? '出貨人定價 ' + o.askPrice + ' 蚊' :
    ('等司機報價' + (o.budget ? '，預算 ' + o.budget + ' 蚊內' : ''));
  return '快送新單。' + m + '，' + o.pickup.district + '去' + o.drop.district + '，' + o.weight + '公斤，' +
    price + '。' + (o.tomorrow ? '明日 ' : '') + o.pickup.from + ' 至 ' + o.pickup.to + ' 提貨，' +
    (o.tomorrow ? '明日 ' : '') + o.drop.deadline + ' 前送到。' +
    (o.upstairs ? '要上樓，泊車費約 ' + UPSTAIRS_FEE + ' 蚊。' : '');
}
