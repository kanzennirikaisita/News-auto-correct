import {categories, changedAt, version, isUnread, sinceLastCheck, byImportance, initialState, validItem, selectItems, acknowledge} from './domain.mjs';
const $ = selector => document.querySelector(selector);
const KEY = 'personal-radar:v1';
let state = initialState(), data = {items:[],sources:[],collector:{}}, view='home', query='', showHidden=false, limit=30, busy=false;
try { state=initialState(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { $('#storage-warning').hidden=false; }
function save() { try { localStorage.setItem(KEY,JSON.stringify(state)); } catch { $('#storage-warning').hidden=false; } }
function el(tag, text, className) { const n=document.createElement(tag); if(text !== undefined)n.textContent=text;if(className)n.className=className;return n; }
function button(text, action, id, className='') {const b=el('button',text,className);b.type='button';b.dataset.action=action;if(id)b.dataset.id=id;return b;}
function fmt(value) {const d=new Date(value);return value && Number.isFinite(+d) ? new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d) : '不明';}
function notify(text) {$('#message').textContent=text;$('#message').hidden=!text;}
function applyTheme() {document.documentElement.dataset.theme=state.theme;$('#theme').value=state.theme;}
function article(item, compact=false) {
  const row=el('article',undefined,`article ${isUnread(item,state)?'is-unread':''} ${compact?'compact':''}`);
  const meta=el('div',undefined,'article-meta');
  meta.append(el('span',categories[item.category],`category-label ${item.category}`),el('span',item.sourceName));
  const badge=el('span',item.changeType==='updated'?'UPDATE':'NEW',`badge ${item.changeType==='updated'?'updated':''}`);meta.append(badge);
  if(!isUnread(item,state))meta.append(el('span','既読','read-label'));
  const title=el('h3'); const link=el('a',item.title);link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.dataset.action='open';link.dataset.id=item.id;link.setAttribute('aria-label',`${item.title}（元サイトを新しいタブで開く）`);title.append(link);
  const tail=el('div',undefined,'article-tail');const level=item.importance>=80?'🔥 優先':item.importance>=60?'重要':'通常';
  const score=el('span',`${level} ${item.importance}`,`score ${item.importance>=80?'urgent':item.importance>=60?'important':''}`);score.title=(item.importanceReasons||[]).join('・');
  tail.append(score,el('span',item.publishedAt ? `公開 ${fmt(item.publishedAt)}` : item.sourceUpdatedAt ? `配信更新 ${fmt(item.sourceUpdatedAt)}` : '公開日時不明'));
  const detected=el('div',`検知 ${fmt(item.detectedAt)}${item.updatedAt?` · 更新検知 ${fmt(item.updatedAt)}`:''}`,'detected');
  const actions=el('div',undefined,'article-actions'); const favorite=button(state.saved[item.id]?'★ 保存済み':'☆ 保存','save',item.id);favorite.setAttribute('aria-pressed',String(Boolean(state.saved[item.id])));favorite.setAttribute('aria-label',`${item.title}を${state.saved[item.id]?'保存から解除':'保存'}`);
  actions.append(favorite,button(isUnread(item,state)?'既読にする':'未読に戻す','read',item.id),button(showHidden?'再表示':'非表示',showHidden?'restore':'hide',item.id));
  row.append(meta,title,tail,detected,actions);return row;
}
function renderOverview() {
  const root=$('#overview');root.replaceChildren();root.hidden=view!=='home';$('#priority').hidden=view!=='home';if(view!=='home')return;
  const changes=data.items.filter(i=>!state.hidden[i.id] && sinceLastCheck(i,state));
  const important=changes.filter(i=>i.importance>=60).sort(byImportance);
  const top=el('div',undefined,'overview-top');const label=el('div');label.append(el('p','前回確認','eyebrow'),el('p',state.lastChecked?fmt(state.lastChecked):'はじめてのチェック','last-check'));
  const ack=button('確認済みにする','ack',null,'ack');ack.disabled=!data.generatedAt;top.append(label,ack);
  const headline=el('h1',undefined,'headline');headline.id='overview-title';headline.append(el('span',String(important.length),'big-number'),el('span','件の重要な変化'));
  const sub=el('p',changes.length?`前回から ${changes.length} 件 · 新着 ${changes.filter(i=>i.changeType!=='updated').length} / 更新 ${changes.filter(i=>i.changeType==='updated').length}`:'確認済みです。次の変化を待ちましょう。','overview-sub');
  const cats=el('div',undefined,'category-counts');for(const [id,name] of Object.entries(categories)){const b=button('', 'category',id);b.append(el('span',name),el('strong',`+${changes.filter(i=>i.category===id).length}`));cats.append(b);}
  root.append(top,headline,sub,cats);
  const priority=$('#priority');priority.replaceChildren();const heading=el('div',undefined,'section-heading');const h=el('h2','今見るべきもの');h.id='priority-title';heading.append(h,el('span','重要度順 · 最大3件'));priority.append(heading);
  if(important.length) {for(const i of important.slice(0,3))priority.append(article(i,true));}else priority.append(el('p','前回確認後の重要な変化はありません。','clear-state'));
}
function render() {
  const focused=document.activeElement;const focusAction=focused?.dataset.action, focusId=focused?.dataset.id;
  applyTheme();renderOverview();
  for(const b of $('#navigation').querySelectorAll('button')) {if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  $('#feed-title').textContent=showHidden?'非表示の記事':({home:'新着・更新',new:'前回確認以降',important:'重要な情報',saved:'保存した情報',all:'すべての情報'}[view]);
  const cats=$('#categories');cats.replaceChildren();for(const [id,name] of [['all','すべて'],...Object.entries(categories)]) {const b=button(name,'category',id);b.setAttribute('aria-pressed',String(state.category===id));cats.append(b);}
  $('#unread').checked=state.unread;$('#show-hidden').textContent=showHidden?'通常の表示へ':'非表示を管理';
  const items=selectItems(data.items,state,{view,query,hidden:showHidden});$('#result-count').textContent=`${items.length} 件`;
  const feed=$('#feed');feed.replaceChildren();feed.setAttribute('aria-busy','false');
  for(const item of items.slice(0,limit))feed.append(article(item));
  if(!items.length)feed.append(el('p',view==='saved'?'保存した情報はここに残ります。記事の「☆ 保存」を押してください。':'該当する情報はありません。カテゴリや未読の条件を変更できます。','empty'));
  $('#more').hidden=items.length<=limit;
  $('#last-collected').textContent=`最終収集: ${fmt(data.generatedAt)}`;
  $('#connection').textContent=navigator.onLine?'':'オフライン';
  const stale=!data.generatedAt || Date.now()-Date.parse(data.generatedAt)>86400000;
  if(stale && !busy)notify(data.generatedAt?'⚠ 最終収集から24時間以上経過しています。情報源の状態を確認してください。':'まだ収集データがありません。初回の情報収集が必要です。');
  const success=data.collector?.success||0,total=data.sources.length;
  $('#health-summary').textContent=`${success} / ${total} sources OK${data.collector?.failed?' · 一部取得失敗':''}`;
  const health=$('#source-health');health.replaceChildren();
  for(const s of data.sources)health.append(el('li',`${s.name} — ${s.status==='ok'?'取得成功':'取得失敗'} · 最終成功 ${fmt(s.lastSuccess)}`));
  if(focusAction)for(const b of document.querySelectorAll('[data-action]'))if(b.dataset.action===focusAction && b.dataset.id===focusId){b.focus({preventScroll:true});break;}
}
async function refresh() {
  if(busy)return;busy=true;$('#refresh').disabled=true;$('#refresh').textContent='取得中…';notify('');
  try {
    const response=await fetch(new URL('./data/latest.json',import.meta.url),{cache:'no-store'});
    if(!response.ok)throw new Error('http');const next=await response.json();
    if(next.schemaVersion!==1 || !Array.isArray(next.items) || !next.items.every(validItem) || !Array.isArray(next.sources))throw new Error('schema');
    data=next;
    for(const item of data.items)if(state.saved[item.id])state.saved[item.id]=item;
    // Read/hidden maps are bounded to retained articles. Saved snapshots survive server retention.
    const retained=new Set([...data.items.map(i=>i.id),...Object.keys(state.saved)]);
    for(const field of ['read','hidden'])for(const id of Object.keys(state[field]))if(!retained.has(id))delete state[field][id];
    save();busy=false;render();
    if(response.headers.get('X-Radar-Cache')==='offline')notify('オフライン、または通信できないため、前回取得した内容を表示しています。');
  } catch {busy=false;render();notify('データを取得できません。通信状態を確認して「更新」を押してください。表示中の内容は保持しています。');}
  finally {busy=false;$('#refresh').disabled=false;$('#refresh').textContent='↻ 更新';}
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-action]');if(!b)return;const {action,id}=b.dataset;
  const item=data.items.find(i=>i.id===id)||state.saved[id];
  if(action==='category'){state.category=id;showHidden=false;limit=30;}
  if(action==='ack'){state=acknowledge(state,data.items,data.generatedAt,new Date().toISOString());notify('今回取得済みの情報を確認済みにしました。');}
  if(action==='save'&&item){if(state.saved[id])delete state.saved[id];else state.saved[id]=item;}
  if(action==='read'&&item){if(isUnread(item,state))state.read[id]=version(item);else delete state.read[id];}
  if(action==='open'&&item){state.read[id]=version(item);save();setTimeout(render,0);return;}
  if(action==='hide')state.hidden[id]=true;
  if(action==='restore')delete state.hidden[id];
  save();render();
});
$('#navigation').addEventListener('click',event=>{const b=event.target.closest('[data-view]');if(!b)return;view=b.dataset.view;showHidden=false;limit=30;render();window.scrollTo({top:0,behavior:'instant'});});
$('#refresh').addEventListener('click',refresh);
$('#search').addEventListener('input',event=>{query=event.target.value;limit=30;render();});
$('#unread').addEventListener('change',event=>{state.unread=event.target.checked;limit=30;save();render();});
$('#theme').addEventListener('change',event=>{state.theme=event.target.value;save();applyTheme();});
$('#show-all').addEventListener('click',()=>{view='all';showHidden=false;limit=30;render();});
$('#show-hidden').addEventListener('click',()=>{showHidden=!showHidden;limit=30;render();});
$('#more').addEventListener('click',()=>{limit+=30;render();});
window.addEventListener('online',refresh);window.addEventListener('offline',()=>{$('#connection').textContent='オフライン';});
window.addEventListener('storage',event=>{if(event.key===KEY){try{state=initialState(JSON.parse(event.newValue||'{}'));render();}catch{/* Ignore malformed writes in another tab. */}}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
applyTheme();
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready).then(registration=>registration.active?.postMessage('CACHE_FEED')).catch(()=>notify('オフライン用の準備ができませんでした。オンラインでは利用できます。'));}
refresh();
