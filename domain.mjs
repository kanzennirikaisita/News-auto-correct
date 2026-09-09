export const categories = {'work':'Work','ai-dev':'AI / Dev','game':'Game','gadget':'Gadget'};
export const changedAt = item => item.updatedAt || item.detectedAt;
export const version = item => `${item.id}:${item.revision || item.contentHash || changedAt(item)}`;
export const isUnread = (item, state) => state.read[item.id] !== version(item);
export const sinceLastCheck = (item, state) => !state.cutoff || Date.parse(changedAt(item)) > Date.parse(state.cutoff);
export const byChange = (a,b) => Date.parse(changedAt(b)) - Date.parse(changedAt(a)) || a.id.localeCompare(b.id);
export const byImportance = (a,b) => b.importance - a.importance || byChange(a,b);
export function initialState(raw = {}) {
  const object = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  return {lastChecked:typeof raw.lastChecked === 'string' && Number.isFinite(Date.parse(raw.lastChecked)) ? raw.lastChecked : null,
    cutoff:typeof raw.cutoff === 'string' && Number.isFinite(Date.parse(raw.cutoff)) ? raw.cutoff : null,
    read:object(raw.read),saved:object(raw.saved),hidden:object(raw.hidden),
    category:Object.hasOwn(categories,raw.category) ? raw.category : 'all',
    theme:['system','light','dark'].includes(raw.theme) ? raw.theme : 'system', unread:raw.unread === true};
}
export function validItem(i) {
  return i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.sourceName === 'string'
    && Object.hasOwn(categories,i.category) && typeof i.url === 'string' && /^https?:\/\//i.test(i.url)
    && Number.isFinite(Date.parse(i.detectedAt)) && (!i.updatedAt || Number.isFinite(Date.parse(i.updatedAt)))
    && Number.isFinite(i.importance) && i.importance >= 0 && i.importance <= 100;
}
export function selectItems(items, state, {view='home',query='',hidden=false}={}) {
  const pool = view === 'saved' ? [...new Map([...Object.values(state.saved).filter(validItem), ...items.filter(i=>state.saved[i.id])].map(i=>[i.id,i])).values()] : items;
  return pool.filter(i => hidden ? state.hidden[i.id] : !state.hidden[i.id])
    .filter(i=>state.category === 'all' || i.category === state.category)
    .filter(i=>!state.unread || isUnread(i,state))
    .filter(i=>view !== 'new' || sinceLastCheck(i,state))
    .filter(i=>view !== 'important' || i.importance >= 60)
    .filter(i=>`${i.title} ${i.sourceName} ${(i.tags||[]).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort(view === 'important' ? byImportance : byChange);
}
export function acknowledge(state, items, generatedAt, now) {
  // The data watermark prevents marking a concurrently collected, unseen item as checked.
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) return state;
  const next = {...state, lastChecked:now, cutoff:generatedAt, read:{...state.read}};
  for (const item of items) if (!state.hidden[item.id]) next.read[item.id] = version(item);
  return next;
}
