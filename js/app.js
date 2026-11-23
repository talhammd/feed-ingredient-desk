'use strict';
const CATS = MASTER.cats; const CATNAME = Object.fromEntries(CATS);
const ING = MASTER.ingredients; const BYID = Object.fromEntries(ING.map(i => [i.id, i]));
const STANCE = {
  PHASE_OUT:{label:'Phase out', cls:'s-out', rank:0},
  BUY:{label:'Buy / lock', cls:'s-buy', rank:1},
  ACCUMULATE:{label:'Accumulate', cls:'s-acc', rank:2},
  WAIT:{label:'Wait', cls:'s-wait', rank:3},
  HAND:{label:'Hand-to-mouth', cls:'s-hand', rank:4},
  HOLD:{label:'Hold cover', cls:'s-hold', rank:5},
  QUOTE:{label:'Get quotes', cls:'s-quote', rank:6}
};
const IMPACT = {risk:'Supply risk', bullish:'Price up', bearish:'Price down', mixed:'Mixed', neutral:'Neutral'};
const UNIT = {kg:{f:1,l:'Rs/kg'}, '40kg':{f:1/40,l:'Rs/40kg'}, '50kg':{f:1/50,l:'Rs/50kg bag'}, '100kg':{f:1/100,l:'Rs/100kg'}, mt:{f:1/1000,l:'Rs/MT'}, usdmt:{f:1/1000,l:'US$/MT',usd:true}, usdkg:{f:1,l:'US$/kg',usd:true}};
const COLL = ['views','intel','bench','series','prices','decisions'];
const S = {dbState:'pending', db:null, user:null, uid:null, canWrite:null, mcp:null, sample:null, downloads:null, meta:null, loaded:{}, err:null,
  views:{}, intel:{}, bench:{}, series:{}, prices:{}, decisions:{}, tab:'board', open:null,
  f:{q:'', cat:'', use:'', stance:''}, fi:{imp:'', ing:''}, names:{}};

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeUrl(u){ try { const x = new URL(String(u)); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch(e){ return ''; } }
function n(v, d=1){ if(v == null || !isFinite(v)) return '—'; return Number(v).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d}); }
function pct(v, d=1){ if(v == null || !isFinite(v)) return '—'; return (v > 0 ? '+' : '') + n(v, d) + '%'; }
function cls(v){ return v == null ? 'flat' : v > 0.5 ? 'up' : v < -0.5 ? 'down' : 'flat'; }
function today(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function fmtDate(s){ if(!s) return '—'; const t = Date.parse(String(s).slice(0,10)); if(!isFinite(t)) return esc(s); const d = new Date(t); return d.getUTCDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].at(d.getUTCMonth()) + ' ' + d.getUTCFullYear(); }
function ageDays(s){ const t = Date.parse(String(s).slice(0,10)); return isFinite(t) ? Math.floor((Date.parse(today()) - t) / 864e5) : null; }
function shiftDate(s, days){ const t = Date.parse(s) + days*864e5; return new Date(t).toISOString().slice(0,10); }
function stancePill(st){ const s = STANCE[st] || STANCE.QUOTE; return '<span class="pill ' + s.cls + '">' + s.label + '</span>'; }
function fx(){ const b = S.bench.usdpkr; return b && isFinite(b.value) ? Number(b.value) : null; }
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }

/* ---------- price model ---------- */
function seriesPts(key, div=1){ const s = S.series[key]; return s && Array.isArray(s.points) ? s.points.filter(p => Array.isArray(p) && isFinite(p[1])).map(p => [String(p[0]), Number(p[1]) / div]) : []; }
function obsFor(id){
  const arr = Object.values(S.prices).filter(p => p && p.ing === id && isFinite(p.value)).map(p => ({date:String(p.date||'').slice(0,10), value:Number(p.value), kind:p.kind||'quote', source:p.source||p.supplier||'', p}));
  arr.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return arr;
}
function histFor(id){
  if(id === 'maize'){ const pts = seriesPts('maize_belt', 100); if(pts.length) return pts.map(p => ({date:p[0], value:p[1], kind:'mandi', source:'AMIS belt median'})); }
  return obsFor(id);
}
function roll(pts, days){ const out = []; for(let k = 0; k < pts.length; k++){ const from = shiftDate(pts[k][0], -days + 1); const win = []; for(let j = k; j >= 0 && pts[j][0] >= from; j--) win.push(pts[j][1]); win.sort((a,b) => a - b); const mid = win.length >> 1; out.push([pts[k][0], win.length % 2 ? win[mid] : (win[mid-1] + win[mid]) / 2]); } return out; }
function valueAt(h, date){ let best = null; for(const o of h){ if(o.date <= date) best = o; else break; } return best; }
function metricsFor(id){
  const h = histFor(id); if(!h.length) return {h};
  const last = h.at(-1); const m = {h, last};
  const ref30 = valueAt(h, shiftDate(last.date, -30)); if(ref30 && ref30 !== last) m.chg30 = (last.value / ref30.value - 1) * 100;
  const ref7 = valueAt(h, shiftDate(last.date, -7)); if(ref7 && ref7 !== last) m.chg7 = (last.value / ref7.value - 1) * 100;
  const refY = valueAt(h, shiftDate(last.date, -365)); if(refY && ageDaysBetween(refY.date, last.date) > 330) m.yoy = (last.value / refY.value - 1) * 100;
  const yr = h.filter(o => o.date > shiftDate(last.date, -365)).map(o => o.value);
  if(yr.length > 20){ const lo = Math.min(...yr), hi = Math.max(...yr); m.lo52 = lo; m.hi52 = hi; m.pos52 = hi > lo ? (last.value - lo) / (hi - lo) * 100 : null; }
  const wk = h.filter(o => o.date > shiftDate(last.date, -7)).map(o => o.value); if(wk.length >= 3) m.avg7 = wk.reduce((s,x) => s + x, 0) / wk.length;
  m.age = ageDays(last.date);
  return m;
}
function ageDaysBetween(a, b){ return (Date.parse(b) - Date.parse(a)) / 864e5; }

/* Petersen value: maize + SBM48 mix with the same AMEn and CP */
const REF = {m:BYID.maize.nut, s:BYID.sbm_hipro.nut};
function refPrices(){
  const add = Number($('vAdd') && $('vAdd').value) || 0;
  const mIn = $('vMaize') && Number($('vMaize').value); const sIn = $('vSbm') && Number($('vSbm').value);
  const mm = metricsFor('maize'); const sm = metricsFor('sbm_hipro');
  const pm = (isFinite(mIn) && mIn > 0) ? mIn : (mm.last ? mm.last.value : null);
  const ps = (isFinite(sIn) && sIn > 0) ? sIn : (sm.last ? sm.last.value : 135);
  return {pm: pm == null ? null : pm + add, ps: ps + add, sbmIsPlan: !(sm.last) && !(isFinite(sIn) && sIn > 0)};
}
function valueOf(nut, rp){
  if(!nut || !rp || rp.pm == null) return null;
  const det = REF.m.me * REF.s.cp - REF.s.me * REF.m.cp;
  const a = (nut.me * REF.s.cp - REF.s.me * nut.cp) / det; const b = (REF.m.me * nut.cp - REF.m.cp * nut.me) / det;
  return a * rp.pm + b * rp.ps;
}

/* data checks against the desk view */
function checks(id, v, m, rp){
  const out = []; const ing = BYID[id]; const st = v && v.stance;
  if(m.last && m.age != null && m.age > 21 && id !== 'maize') out.push({t:'Price ' + m.age + ' days old', k:'warn'});
  if(m.last && id === 'maize' && m.age != null && m.age > 3) out.push({t:'Mandi data ' + m.age + ' days old', k:'warn'});
  if(m.chg30 != null){ if(m.chg30 > 5 && (st === 'WAIT' || st === 'HAND')) out.push({t:'Up ' + n(m.chg30) + '% in 30 days against a soft view', k:'warn'});
    if(m.chg30 < -5 && (st === 'BUY' || st === 'ACCUMULATE')) out.push({t:'Down ' + n(Math.abs(m.chg30)) + '% in 30 days against a buy view', k:'warn'}); }
  if(ing.nut && ing.use.includes('P') && m.last && id !== 'maize' && id !== 'sbm_hipro'){ const val = valueOf(ing.nut, rp); if(val){ const r = val / m.last.value; if(r < 0.95 && (st === 'BUY' || st === 'ACCUMULATE')) out.push({t:'Offer ' + n((1/r - 1)*100, 0) + '% above nutrient value', k:'warn'}); } }
  return out;
}
function valueCheckCell(id, m, rp){
  const ing = BYID[id]; if(!ing.nut || !ing.use.includes('P') || id === 'maize' || id === 'sbm_hipro') return '<span class="muted small">—</span>';
  const val = valueOf(ing.nut, rp); if(val == null) return '<span class="muted small">—</span>';
  if(!m.last) return '<span class="small">Worth <span class="num">' + n(val) + '</span></span>';
  const r = val / m.last.value; const verdict = r >= 1.05 ? '<span class="tag src-mandi">Cheap</span>' : r <= 0.95 ? '<span class="tag flag-high">Dear</span>' : '<span class="tag">Fair</span>';
  return verdict + ' <span class="small muted">worth <span class="num">' + n(val) + '</span></span>';
}

/* ---------- rendering: header, KPIs ---------- */
function setStatus(kind, text){ $('statusDot').className = 'dot ' + kind; $('statusText').textContent = text; }
function renderStatus(){
  if(S.dbState !== 'ok'){ return; }
  const pend = COLL.filter(c => !S.loaded[c]);
  if(pend.length){ setStatus('warn', 'Loading shared data…'); return; }
  const lr = S.meta && S.meta.lastRefresh; const t = lr ? Date.parse(lr) : NaN;
  if(isFinite(t)){ const hrs = (Date.now() - t) / 36e5; const when = new Date(t).toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
    setStatus(hrs > 12 ? 'warn' : 'live', (hrs > 12 ? 'Last refresh ' : 'Refreshed ') + when + ' · updates 8 AM, 3 PM, 10 PM PKT'); }
  else setStatus('live', 'Live');
}
function spark(pts, w=150, h=26){
  if(pts.length < 2) return '';
  const vs = pts.map(p => p[1]); const lo = Math.min(...vs), hi = Math.max(...vs);
  const X = i => i / (pts.length - 1) * (w - 2) + 1; const Y = v => h - 2 - (hi > lo ? (v - lo) / (hi - lo) : .5) * (h - 4);
  const d = pts.map((p,i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '" style="fill:none;stroke:var(--accent);stroke-width:1.6"/><circle cx="' + X(pts.length-1).toFixed(1) + '" cy="' + Y(vs.at(-1)).toFixed(1) + '" r="2.4" style="fill:var(--accent)"/></svg>';
}
function kpi(k, v, d, extra=''){ return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div>' + extra + '</div>'; }
function renderKpis(){
  const b = S.bench; const out = [];
  const mm = metricsFor('maize');
  if(mm.last){ const pts = seriesPts('maize_belt', 100).filter(p => p[0] > shiftDate(mm.last.date, -120));
    out.push(kpi('Maize, belt mandis', 'Rs ' + n(mm.last.value), '<span class="' + cls(mm.chg30) + '">' + pct(mm.chg30) + ' 30d</span> · <span class="' + cls(mm.yoy) + '">' + pct(mm.yoy) + ' y/y</span> · ' + fmtDate(mm.last.date), spark(pts))); }
  if(b.cbot_sbm) out.push(kpi('CBOT soybean meal', '$' + n(b.cbot_sbm.value, 1), (b.cbot_sbm.chgWeek != null ? '<span class="' + cls(b.cbot_sbm.chgWeek) + '">' + (b.cbot_sbm.chgWeek > 0 ? '+' : '') + n(b.cbot_sbm.chgWeek, 1) + '/st on week</span> · ' : '') + fmtDate(b.cbot_sbm.date)));
  if(b.usdpkr) out.push(kpi('US$ / Rs', n(b.usdpkr.value, 2), (b.usdpkr.prev ? '<span class="' + cls((b.usdpkr.value / b.usdpkr.prev - 1)*100) + '">Rupee ' + pct(-(b.usdpkr.value / b.usdpkr.prev - 1)*100) + ' y/y</span> · ' : '') + fmtDate(b.usdpkr.date)));
  if(b.amis_wheat) out.push(kpi('Wheat, AMIS', 'Rs ' + n(b.amis_wheat.value/100), (b.amis_wheat.prev ? '<span class="' + cls((b.amis_wheat.value/b.amis_wheat.prev - 1)*100) + '">' + pct((b.amis_wheat.value/b.amis_wheat.prev - 1)*100) + ' since ' + fmtDate(b.amis_wheat.prevDate).slice(0,-5) + '</span> · ' : '') + fmtDate(b.amis_wheat.date)));
  if(b.urea_pbs) out.push(kpi('Urea, per bag', 'Rs ' + n(b.urea_pbs.value, 0), 'PBS average · ' + fmtDate(b.urea_pbs.date)));
  if(b.cbot_corn) out.push(kpi('CBOT corn', '$' + n(b.cbot_corn.value, 2) + '/bu', esc(String(b.cbot_corn.note || '').split(';')[0].slice(0, 40)) + ' · ' + fmtDate(b.cbot_corn.date)));
  const counts = {}; ING.forEach(i => { const st = (S.views[i.id] || {}).stance || 'QUOTE'; counts[st] = (counts[st] || 0) + 1; });
  out.push(kpi('Buy signals', String((counts.BUY||0) + (counts.ACCUMULATE||0)), ((counts.WAIT||0) + (counts.HAND||0)) + ' wait or hand-to-mouth · ' + (counts.PHASE_OUT||0) + ' phase out · ' + (counts.QUOTE||0) + ' need quotes'));
  $('kpis').innerHTML = out.join('') || '<div class="kpi"><div class="k">Market data</div><div class="v">—</div><div class="d">Loading…</div></div>';
}

/* ---------- board ---------- */
function rowsFiltered(){
  const q = S.f.q.trim().toLowerCase();
  return ING.filter(i => {
    if(S.f.cat && i.cat !== S.f.cat) return false;
    if(S.f.use && !i.use.includes(S.f.use)) return false;
    const st = (S.views[i.id] || {}).stance || 'QUOTE';
    if(S.f.stance && st !== S.f.stance) return false;
    if(q && !(i.erp.toLowerCase().includes(q) || i.mat.toLowerCase().includes(q))) return false;
    return true;
  });
}
function renderCalls(){
  const items = ING.map(i => ({i, v:S.views[i.id]})).filter(x => x.v && x.v.pri != null).sort((a,b) => a.v.pri - b.v.pri);
  const list = [];
  for(const x of items){ const prev = list.at(-1); if(prev && prev.v.pri === x.v.pri && prev.v.stance === x.v.stance){ prev.also = (prev.also ? prev.also + ', ' : '') + x.i.mat.toLowerCase(); continue; } list.push(x); }
  $('calls').innerHTML = list.slice(0, 10).map(x => '<button class="call" data-open="' + x.i.id + '"><span class="t">' + stancePill(x.v.stance) + '<span class="n">' + esc(x.i.mat) + (x.also ? ' &amp; ' + esc(x.also) : '') + '</span></span><span class="a">' + esc(x.v.act) + '</span><span class="c">Cover: ' + esc(x.v.cover) + ' · ' + fmtDate(x.v.updated) + '</span></button>').join('') || '<div class="empty card">No ranked calls in the latest data.</div>';
  const lu = Object.values(S.views).map(v => v.updated).filter(Boolean).sort().at(-1);
  $('callsHint').textContent = lu ? 'Ranked by impact · views as of ' + fmtDate(lu) : '';
}
function renderBoard(){
  if(S.dbState !== 'ok' || !S.loaded.views){
    const msg = S.dbState === 'none' ? 'The desk data could not be loaded. Check your connection and reload.' : 'Loading the desk views, prices and quotes…';
    $('calls').innerHTML = '<div class="empty card">' + msg + '</div>'; $('callsHint').textContent = '';
    $('boardBody').innerHTML = '<tr><td colspan="7" class="empty">' + msg + '</td></tr>'; $('boardCount').textContent = ''; return; }
  renderCalls();
  const rp = refPrices();
  const rows = rowsFiltered();
  rows.sort((a,b) => { const ca = CATS.findIndex(c => c[0] === a.cat), cb = CATS.findIndex(c => c[0] === b.cat); if(ca !== cb) return ca - cb;
    const sa = (STANCE[(S.views[a.id]||{}).stance] || STANCE.QUOTE).rank, sb = (STANCE[(S.views[b.id]||{}).stance] || STANCE.QUOTE).rank; if(sa !== sb) return sa - sb; return b.w - a.w; });
  let html = '', lastCat = null;
  for(const i of rows){
    if(i.cat !== lastCat){ html += '<tr class="cat-row"><td colspan="7">' + esc(CATNAME[i.cat]) + '</td></tr>'; lastCat = i.cat; }
    const v = S.views[i.id] || {}; const m = metricsFor(i.id);
    const price = m.last ? '<span class="num">' + n(m.last.value) + '</span><div class="tiny muted">' + (m.last.kind === 'quote' ? 'quote' : m.last.kind) + ' · ' + fmtDate(m.last.date) + '</div>' : '<span class="muted small">no price</span>';
    const chk = checks(i.id, v, m, rp);
    const flag = i.flag ? ' <span class="tag flag-' + (i.flagLevel === 'high' ? 'high' : 'med') + '" title="' + esc(i.flag) + '">' + (i.flagLevel === 'high' ? 'Risk' : 'Watch') + '</span>' : '';
    html += '<tr class="row" data-open="' + i.id + '" tabindex="0"><td>' + stancePill(v.stance || 'QUOTE') + chk.map(c => '<div style="margin-top:4px"><span class="tag warn">' + esc(c.t) + '</span></div>').join('') + '</td>' +
      '<td><div class="ing">' + esc(i.mat) + flag + '</div><div class="erp">' + esc(i.erp) + ' · ' + (i.use === 'PW' ? 'Poultry, wanda' : i.use === 'P' ? 'Poultry' : 'Wanda') + '</div></td>' +
      '<td class="r">' + price + '</td>' +
      '<td class="r hide-sm"><span class="num ' + cls(m.chg30) + '">' + pct(m.chg30) + '</span></td>' +
      '<td class="hide-sm">' + valueCheckCell(i.id, m, rp) + '</td>' +
      '<td class="small">' + esc(v.cover || '—') + '</td>' +
      '<td class="why hide-sm">' + esc(v.why || 'No desk view yet.') + '</td></tr>';
  }
  $('boardBody').innerHTML = html || '<tr><td colspan="7" class="empty">No ingredient matches these filters.</td></tr>';
  $('boardCount').textContent = rows.length + ' of ' + ING.length + ' ingredients';
}

/* ---------- value tab ---------- */
function renderValue(){
  const rp = refPrices(); const mm = metricsFor('maize'); const sm = metricsFor('sbm_hipro');
  if(document.activeElement !== $('vMaize') && !$('vMaize').value && mm.last) $('vMaize').placeholder = n(mm.last.value);
  if(document.activeElement !== $('vSbm') && !$('vSbm').value) $('vSbm').placeholder = sm.last ? n(sm.last.value) : '135.0';
  $('vMaizeSrc').textContent = mm.last ? 'Default: AMIS belt median, ' + fmtDate(mm.last.date) : 'Enter today\'s maize price';
  $('vSbmSrc').textContent = sm.last ? 'Default: latest quote, ' + fmtDate(sm.last.date) : 'No quote logged: Rs135 planning price. Enter today\'s quote.';
  const rows = ING.filter(i => i.nut && i.use.includes('P') && i.id !== 'maize' && i.id !== 'sbm_hipro').map(i => { const val = valueOf(i.nut, rp); const m = metricsFor(i.id); return {i, val, m}; });
  rows.sort((a,b) => (b.val || 0) - (a.val || 0));
  $('valueBody').innerHTML = rows.map(({i, val, m}) => {
    const offer = m.last ? m.last.value : null; const r = offer && val ? val / offer : null;
    const verdict = r == null ? '<span class="muted small">Need an offer</span>' : r >= 1.05 ? '<span class="tag src-mandi">Cheap · ' + n((r-1)*100, 0) + '% under value</span>' : r <= 0.95 ? '<span class="tag flag-high">Dear · ' + n((1/r-1)*100, 0) + '% over value</span>' : '<span class="tag">Fair</span>';
    const basis = offer || val; const rcp = basis && i.nut.cp > 0 ? basis / (i.nut.cp / 100) : null; const rme = basis && i.nut.me > 0 ? basis / (i.nut.me / 1000) : null;
    return '<tr class="row" data-open="' + i.id + '"><td><div class="ing" style="font-weight:600">' + esc(i.mat) + '</div><div class="tiny muted">' + esc(i.erp) + '</div></td><td class="r num">' + n(i.nut.cp) + '</td><td class="r num">' + n(i.nut.me, 0) + '</td><td class="r num" style="font-weight:600">' + (val == null ? '—' : n(val)) + '</td><td class="r num">' + (offer == null ? '<span class="muted">—</span>' : n(offer)) + '</td><td>' + verdict + '</td><td class="r num hide-sm">' + (rcp == null ? '—' : n(rcp, 0)) + '</td><td class="r num hide-sm">' + (rme == null ? '—' : n(rme)) + '</td><td class="hide-sm"><span class="tag">' + esc(i.nut.src) + '</span></td></tr>';
  }).join('');
}

/* ---------- import parity ---------- */
const PRESETS = [
  {id:'sbm_hipro', label:'Soybean meal 48% (imported meal)', cd:11, acd:2, rd:0, st:18, it:5.5, note:'Duties per USDA GAIN PK2026-0004. Meal imports also need a GM import licence, which the NBC deferred on 23 Oct 2026.'},
  {id:'soybean', label:'Soybeans (for crush parity)', cd:0, acd:2, rd:0, st:18, it:2, note:'Customs duty on soybeans was cut to zero in June 2025 (USDA GAIN PK2026-0004).'},
  {id:'canola_meal', label:'Canola / rapeseed seed', cd:3, acd:2, rd:0, st:18, it:2, note:'Rates for rapeseed and sunflower seed per USDA GAIN PK2026-0004.'},
  {id:'pkc', label:'Palm kernel cake', cd:null, note:'Enter duty rates from your clearing agent.'},
  {id:'mcp', label:'Monocalcium phosphate', cd:null, note:'Enter duty rates from your clearing agent.'},
  {id:'dlmet', label:'DL-Methionine', cd:null, note:'Enter duty rates from your clearing agent.'},
  {id:'lys_sulph', label:'Lysine sulphate', cd:null, note:'Enter duty rates from your clearing agent.'},
  {id:'thr', label:'L-Threonine', cd:null, note:'Enter duty rates from your clearing agent.'},
  {id:'choline', label:'Choline chloride 70%', cd:null, note:'Enter duty rates from your clearing agent.'},
  {id:'vit_premix', label:'Vitamin premix', cd:null, note:'Enter duty rates from your clearing agent.'},
  {id:'custom', label:'Other item', cd:null, note:'Enter every rate.'}
];
function initImport(){
  $('pPreset').innerHTML = PRESETS.map(p => '<option value="' + p.id + '">' + esc(p.label) + '</option>').join('');
  const saved = lsGet('fid.import'); if(saved && PRESETS.some(p => p.id === saved)) $('pPreset').value = saved;
  applyPreset();
}
function applyPreset(){
  const p = PRESETS.find(x => x.id === $('pPreset').value) || PRESETS[0];
  ['Cd','Acd','Rd','St','It'].forEach(k => { const key = k.toLowerCase(); $('p' + k).value = (p.cd == null) ? '' : (p[key] ?? 0); });
  if(!$('pFx').value && fx()) $('pFx').value = fx();
  $('pNote').textContent = p.note || '';
  lsSet('fid.import', p.id); calcImport();
}
function calcImport(){
  const g = k => { const v = Number($(k).value); return isFinite(v) ? v : 0; };
  $('pFx').placeholder = fx() ? n(fx(), 2) + ' (latest)' : '';
  const sbmRef = S.bench.cbot_sbm; $('pNote').textContent = ((PRESETS.find(x => x.id === $('pPreset').value) || {}).note || '') + (($('pPreset').value === 'sbm_hipro' && sbmRef) ? ' Reference: CBOT Dec-26 $' + n(sbmRef.value, 1) + '/short ton = $' + n(sbmRef.value * 1.10231, 1) + '/MT on ' + fmtDate(sbmRef.date) + '; add the origin basis and ocean freight for a CFR price.' : '');
  const cfr = g('pCfr'), fxr = g('pFx') || fx() || 0;
  if(!cfr || !fxr){ $('pOut').innerHTML = '<div class="muted">Enter a CFR price to see the landed cost.</div><div></div>'; $('pVerdict').innerHTML = ''; return; }
  const cif = cfr * (1 + g('pIns')/100);
  const av = cif * fxr; const cd = av * g('pCd')/100, acd = av * g('pAcd')/100, rd = av * g('pRd')/100;
  const stBase = av + cd + acd + rd; const st = stBase * g('pSt')/100; const it = (stBase + st) * g('pIt')/100;
  const port = g('pPort'); const fin = (av + cd + acd + rd + st + it + port) * g('pRate')/100 * g('pDays')/365;
  const gross = av + cd + acd + rd + st + it + port + fin; const net = gross - st - it;
  const row = (k, v) => '<div>' + k + '</div><div>' + n(v, 0) + '</div>';
  $('pOut').innerHTML = row('Assessed value (CIF)', av) + row('Customs duty', cd) + row('Additional customs duty', acd) + row('Regulatory duty', rd) + row('Sales tax', st) + row('Income tax at import', it) + row('Port, clearing, inland', port) + row('Finance cost', fin) +
    '<div style="font-weight:600;border-top:1px solid var(--line);padding-top:6px">Landed, Rs/MT</div><div style="font-weight:600;border-top:1px solid var(--line);padding-top:6px">' + n(gross, 0) + '</div>' +
    '<div class="muted">Net of adjustable sales and income tax</div><div class="muted">' + n(net, 0) + '</div>';
  const pid = $('pPreset').value; const m = BYID[pid] ? metricsFor(pid) : {};
  const perKg = gross / 1000, perKgNet = net / 1000;
  let verdict = '<div class="out">Rs ' + n(perKg, 1) + '/kg</div><div class="note">Rs ' + n(perKgNet, 1) + '/kg if sales and income tax are adjusted against output tax</div>';
  if(m.last){ const local = m.last.value; const diff = (perKgNet / local - 1) * 100;
    verdict += '<p style="margin:10px 0 0">Latest local ' + (m.last.kind === 'quote' ? 'quote' : 'price') + ': <b class="num">Rs ' + n(local) + '/kg</b> (' + fmtDate(m.last.date) + '). ' + (diff < -3 ? '<span class="tag src-mandi">Import is ' + n(-diff, 0) + '% cheaper net of taxes</span>' : diff > 3 ? '<span class="tag flag-high">Local is ' + n(diff, 0) + '% cheaper</span>' : '<span class="tag">Within 3%: buy local for speed</span>') + '</p>'; }
  else verdict += '<p class="note" style="margin:10px 0 0">Log a local quote on the Quotes tab to compare.</p>';
  $('pVerdict').innerHTML = verdict;
}

/* ---------- intel ---------- */
function renderIntel(){
  const items = Object.entries(S.intel).map(([id, d]) => ({id, ...d})).filter(d => d && d.title);
  items.sort((a,b) => String(b.date) < String(a.date) ? -1 : String(b.date) > String(a.date) ? 1 : 0);
  const f = items.filter(d => (!S.fi.imp || d.impact === S.fi.imp || (S.fi.imp === 'mixed' && d.impact === 'neutral')) && (!S.fi.ing || (Array.isArray(d.tags) && d.tags.includes(S.fi.ing))));
  $('intelList').innerHTML = f.map(d => intelCard(d)).join('') || '<div class="empty card">No notes match. Add one below, or wait for the daily refresh.</div>';
  $('intelCount').textContent = f.length + ' notes';
}
function intelCard(d){
  const url = safeUrl(d.url); const tags = (Array.isArray(d.tags) ? d.tags : []).filter(t => BYID[t]).slice(0, 6);
  return '<article class="intel-item"><div class="dt">' + fmtDate(d.date) + '</div><div><h3>' + esc(d.title) + '</h3>' + (d.summary ? '<p>' + esc(d.summary) + '</p>' : '') +
    '<div class="meta"><span class="pill imp-' + esc(d.impact || 'neutral') + '">' + esc(IMPACT[d.impact] || 'Note') + '</span>' + tags.map(t => '<button class="tag" style="cursor:pointer" data-open="' + t + '">' + esc(BYID[t].mat) + '</button>').join('') +
    (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(d.source || 'Source') + '</a>' : '<span class="muted">' + esc(d.source || '') + '</span>') + '</div></div></article>';
}

/* ---------- desk: quotes & decisions ---------- */
function ingOptions(sel){ return CATS.map(([k, label]) => '<optgroup label="' + esc(label) + '">' + ING.filter(i => i.cat === k).map(i => '<option value="' + i.id + '"' + (i.id === sel ? ' selected' : '') + '>' + esc(i.mat) + ' — ' + esc(i.erp) + '</option>').join('') + '</optgroup>').join(''); }
function who(uid){ if(!uid) return '<span class="muted">—</span>'; if(String(uid).startsWith('Claude')) return '<span class="muted small">Claude</span>'; if(uid === S.uid) return 'You'; const nm = S.names[uid]; return nm ? esc(nm) : '<span class="muted">Team</span>'; }
async function resolveNames(ids){ if(!S.user || !ids.length) return; try { const ps = await S.user.profiles(ids); let changed = false; for(const id of ids){ const nm = ps && ps[id] && ps[id].name; if(nm && S.names[id] !== nm){ S.names[id] = nm; changed = true; } } if(changed) schedule(); } catch(e){} }
function renderDesk(){
  const qs = Object.entries(S.prices).map(([id, d]) => ({id, ...d})).filter(d => d.kind === 'quote');
  qs.sort((a,b) => String(b.createdAt || b.date) < String(a.createdAt || a.date) ? -1 : 1);
  $('quoteBody').innerHTML = qs.slice(0, 200).map(d => '<tr><td class="num small">' + fmtDate(d.date) + '</td><td>' + esc((BYID[d.ing] || {}).mat || d.ing) + '</td><td>' + esc(d.supplier || '') + '</td><td class="r num">' + n(d.value) + '</td><td class="hide-sm small num">' + esc(d.raw != null ? n(d.raw, 2) + ' ' + ((UNIT[d.rawUnit] || {}).l || d.rawUnit || '') : '') + '</td><td class="hide-sm small">' + esc([d.basis, d.terms].filter(Boolean).join(' · ')) + '</td><td class="hide-sm small">' + esc(d.note || '') + (d.validTill ? ' <span class="muted">valid till ' + fmtDate(d.validTill) + '</span>' : '') + '</td><td class="small">' + who(d.by) + '</td><td>' + (d.by && d.by === S.uid ? '<button class="btn sm" data-del-quote="' + esc(d.id) + '">Delete</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="9" class="empty">No quotes yet. Log the first supplier quote above; every quote feeds the board, the value check and the import comparison.</td></tr>';
  const ds = Object.entries(S.decisions).map(([id, d]) => ({id, ...d}));
  ds.sort((a,b) => String(b.createdAt || b.date) < String(a.createdAt || a.date) ? -1 : 1);
  $('decBody').innerHTML = ds.slice(0, 200).map(d => { const m = metricsFor(d.ing); const mk = m.last ? m.last.value : null; const qty = Number(d.qtyMT) || 0; const px = Number(d.value);
    const gl = (mk != null && isFinite(px) && qty && /Bought|Contracted/.test(d.action || '')) ? (mk - px) * qty * 1000 : null;
    return '<tr><td class="num small">' + fmtDate(d.date) + '</td><td>' + esc((BYID[d.ing] || {}).mat || d.ing) + '</td><td>' + esc(d.action || '') + '</td><td class="r num">' + (qty ? n(qty, 1) : '—') + '</td><td class="r num">' + (isFinite(px) ? n(px) : '—') + '</td><td class="r num hide-sm">' + (mk == null ? '—' : n(mk)) + '</td><td class="r num hide-sm ' + (gl == null ? '' : gl >= 0 ? 'down' : 'up') + '">' + (gl == null ? '—' : (gl < 0 ? '(' + n(-gl/1e6, 2) + 'm)' : n(gl/1e6, 2) + 'm')) + '</td><td class="hide-sm small">' + esc(d.note || '') + (d.supplier ? ' <span class="muted">· ' + esc(d.supplier) + '</span>' : '') + '</td><td class="small">' + who(d.by) + '</td></tr>'; }).join('') || '<tr><td colspan="9" class="empty">No decisions yet. Log what you bought, deferred or rejected; bought and contracted lines are marked to the market here.</td></tr>';
  const ids = [...new Set([...qs, ...ds].map(d => d.by).filter(x => x && !String(x).startsWith('Claude') && x !== S.uid && !S.names[x]))]; resolveNames(ids.slice(0, 64));
}
function convertQuote(){
  const p = Number($('qPrice').value); const u = UNIT[$('qUnit').value]; if(!isFinite(p) || p <= 0){ $('qConv').textContent = ''; return null; }
  let rskg = p * u.f; if(u.usd){ const r = fx(); if(!r){ $('qConv').textContent = 'No exchange rate loaded'; return null; } rskg = rskg * r; }
  $('qConv').textContent = '= Rs ' + n(rskg, 2) + '/kg'; return rskg;
}

/* ---------- drawer ---------- */
function openDrawer(id){ if(!BYID[id]) return; S.open = id; renderDrawer(true); }
function closeDrawer(){ S.open = null; $('drawerHost').innerHTML = ''; }
const CHART = {};
function lineChart(key, series, opt={}){
  const W = 620, H = opt.h || 210, L = 46, R = 10, T = 10, B = 24;
  const all = series.flatMap(s => s.pts); if(all.length < 2) return '';
  const ts = all.map(p => Date.parse(p[0])); const x0 = Math.min(...ts), x1 = Math.max(...ts);
  const vs = all.map(p => p[1]); let y0 = Math.min(...vs), y1 = Math.max(...vs); const pad = (y1 - y0) * .08 || Math.abs(y1) * .05 || 1; y0 -= pad; y1 += pad;
  const X = t => L + (t - x0) / ((x1 - x0) || 1) * (W - L - R); const Y = v => T + (1 - (v - y0) / ((y1 - y0) || 1)) * (H - T - B);
  const step = (y1 - y0) / 4; let g = '';
  for(let k = 0; k <= 4; k++){ const v = y0 + step * k; g += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text x="' + (L - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + n(v, v < 100 ? 1 : 0) + '</text>'; }
  const months = []; const d0 = new Date(x0); let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
  while(cur <= x1){ months.push(cur); const d = new Date(cur); cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  const every = Math.max(1, Math.ceil(months.length / 8));
  months.forEach((t, k) => { if(k % every) return; const d = new Date(t); g += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].at(d.getUTCMonth()) + (d.getUTCMonth() === 0 ? ' ' + String(d.getUTCFullYear()).slice(2) : '') + '</text>'; });
  let p = '';
  series.forEach(s => { if(s.pts.length < 1) return; const d = s.pts.map((q, k) => (k ? 'L' : 'M') + X(Date.parse(q[0])).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join('');
    p += '<path d="' + d + '" style="fill:none;stroke:' + s.color + ';stroke-width:' + (s.w || 1.6) + ';stroke-linejoin:round' + (s.dash ? ';stroke-dasharray:4 3' : '') + '"/>';
    const lq = s.pts.at(-1); p += '<circle cx="' + X(Date.parse(lq[0])).toFixed(1) + '" cy="' + Y(lq[1]).toFixed(1) + '" r="3" style="fill:' + s.color + '"/>'; });
  CHART[key] = {series, X, Y, x0, x1, L, R, W, H, T, B};
  return '<div class="chart-wrap" data-chart="' + key + '"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.label || 'Price history') + '">' + g + p + '<line class="hov" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--faint);stroke-dasharray:3 3" visibility="hidden"/><rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"/></svg><div class="tip" hidden></div></div>' +
    '<div class="legend">' + series.map(s => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('') + '</div>';
}
function chartHover(e){
  const wrap = e.target.closest && e.target.closest('.chart-wrap'); if(!wrap) return; const c = CHART[wrap.dataset.chart]; if(!c) return;
  const svg = wrap.querySelector('svg'); const r = svg.getBoundingClientRect(); const sx = (e.clientX - r.left) / r.width * c.W;
  if(sx < c.L || sx > c.W - c.R){ hideTip(wrap); return; }
  const t = c.x0 + (sx - c.L) / (c.W - c.L - c.R) * (c.x1 - c.x0);
  const lines = []; let lx = null;
  c.series.forEach(s => { let best = null, bd = Infinity; for(const q of s.pts){ const dd = Math.abs(Date.parse(q[0]) - t); if(dd < bd){ bd = dd; best = q; } } if(best && bd < 6*864e5){ lines.push('<div><b style="color:' + s.color + '">●</b> ' + esc(s.name) + ': <span class="num">' + n(best[1]) + '</span> <span class="muted">' + fmtDate(best[0]) + '</span></div>'); if(lx == null) lx = c.X(Date.parse(best[0])); } });
  const hov = svg.querySelector('.hov'); const tip = wrap.querySelector('.tip');
  if(!lines.length){ hideTip(wrap); return; }
  hov.setAttribute('x1', lx); hov.setAttribute('x2', lx); hov.setAttribute('visibility', 'visible');
  tip.innerHTML = lines.join(''); tip.hidden = false; const px = lx / c.W * r.width; tip.style.left = Math.min(Math.max(px - 80, 0), r.width - 200) + 'px'; tip.style.top = '4px';
}
function hideTip(wrap){ const t = wrap.querySelector('.tip'); if(t) t.hidden = true; const h = wrap.querySelector('.hov'); if(h) h.setAttribute('visibility', 'hidden'); }
function drawerPriceSection(id){
  const m = metricsFor(id); let html = '<h3>Price</h3>';
  if(!m.last){ return html + '<p class="muted" style="margin:0">No price yet for this ingredient. Log a supplier quote below; the board starts checking the view against it at once.</p>'; }
  html += '<div class="stats">' +
    '<div class="stat"><div class="k">Latest</div><div class="v">Rs ' + n(m.last.value) + '</div><div class="tiny muted">' + esc(m.last.kind) + ' · ' + fmtDate(m.last.date) + '</div></div>' +
    (m.avg7 != null ? '<div class="stat"><div class="k">7-day average</div><div class="v">Rs ' + n(m.avg7) + '</div></div>' : '') +
    '<div class="stat"><div class="k">30-day</div><div class="v ' + cls(m.chg30) + '">' + pct(m.chg30) + '</div></div>' +
    (m.yoy != null ? '<div class="stat"><div class="k">Year on year</div><div class="v ' + cls(m.yoy) + '">' + pct(m.yoy) + '</div></div>' : '') +
    (m.pos52 != null ? '<div class="stat"><div class="k">52-week range</div><div class="v">' + n(m.pos52, 0) + '%</div><div class="tiny muted">Rs ' + n(m.lo52) + ' – ' + n(m.hi52) + '</div></div>' : '') + '</div>';
  if(id === 'maize'){
    const series = [{name:'Belt median', color:'var(--accent)', pts:seriesPts('maize_belt', 100), w:2}, {name:'Other mandis, 7-day median', color:'var(--blue)', pts:roll(seriesPts('maize_other', 100), 7), w:1.4, dash:true}];
    html += '<div style="margin-top:10px">' + lineChart('maize-all', series, {label:'Maize mandi prices, Rs per kg'}) + '</div>';
    const cities = [['Okara','var(--ink)'],['Sahiwal','var(--green)'],['PakPattan','var(--violet)'],['ArifWala','var(--lime)'],['Faisalabad','var(--red)'],['Multan','var(--amber)']];
    const cs = cities.map(([c, col]) => ({name:c, color:col, pts:seriesPts('maize_' + c.toLowerCase(), 100).filter(p => p[0] >= shiftDate(m.last.date, -122)), w:1.4})).filter(s => s.pts.length);
    if(cs.length) html += '<div style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">By mandi, last four months (Rs/kg)</div>' + lineChart('maize-cities', cs, {h:200, label:'Maize by mandi'}) + '</div>';
    const b = S.series.amis_board_latest; const rows = b && b.boards && Array.isArray(b.boards.maize) ? b.boards.maize : [];
    if(rows.length) html += '<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Mandi, ' + fmtDate(b.date) + '</th><th class="r">Min</th><th class="r">Max</th><th class="r">FQP Rs/kg</th></tr></thead><tbody>' + rows.slice().sort((a,b2) => a.fqp - b2.fqp).map(r => '<tr><td>' + esc(r.city) + '</td><td class="r num">' + n(r.min/100) + '</td><td class="r num">' + n(r.max/100) + '</td><td class="r num">' + n(r.fqp/100) + '</td></tr>').join('') + '</tbody></table></div>';
  } else if(m.h.length > 1){
    html += '<div style="margin-top:10px">' + lineChart('ing-' + id, [{name:BYID[id].mat, color:'var(--accent)', pts:m.h.map(o => [o.date, o.value]), w:2}], {h:180}) + '</div>';
  }
  return html;
}
function drawerValueSection(id){
  const i = BYID[id]; if(!i.nut) return '';
  const rp = refPrices(); const val = (id === 'maize' || id === 'sbm_hipro' || !i.use.includes('P')) ? null : valueOf(i.nut, rp);
  let html = '<h3>Nutrient value</h3><div class="stats"><div class="stat"><div class="k">CP</div><div class="v">' + n(i.nut.cp) + '%</div></div><div class="stat"><div class="k">AMEn</div><div class="v">' + n(i.nut.me, 0) + '</div><div class="tiny muted">kcal/kg · ' + esc(i.nut.src) + '</div></div>';
  if(val != null) html += '<div class="stat"><div class="k">Value now</div><div class="v">Rs ' + n(val) + '</div><div class="tiny muted">maize ' + n(rp.pm) + ' · SBM ' + n(rp.ps) + (rp.sbmIsPlan ? ' (plan)' : '') + '</div></div>';
  html += '</div>';
  if(Array.isArray(i.subs) && i.subs.length) html += '<p class="small" style="margin:10px 0 0">Substitutes: ' + i.subs.filter(s => BYID[s]).map(s => '<button class="tag" style="cursor:pointer" data-open="' + s + '">' + esc(BYID[s].mat) + '</button>').join(' ') + '</p>';
  return html;
}
function drawerDynamic(id){
  const i = BYID[id]; const v = S.views[id] || {}; const m = metricsFor(id); const rp = refPrices(); const chk = checks(id, v, m, rp);
  const refs = (Array.isArray(v.refs) ? v.refs : []).map(r => S.intel[r] ? {id:r, ...S.intel[r]} : null).filter(Boolean);
  const tagged = Object.entries(S.intel).map(([k, d]) => ({id:k, ...d})).filter(d => Array.isArray(d.tags) && d.tags.includes(id) && !refs.some(r => r.id === d.id));
  const quotes = obsFor(id).filter(o => o.kind === 'quote').slice(-8).reverse();
  const decs = Object.values(S.decisions).filter(d => d.ing === id).sort((a,b) => String(b.date) < String(a.date) ? -1 : 1).slice(0, 6);
  let html = '<section class="dr-sec"><h3>Desk view</h3><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">' + stancePill(v.stance || 'QUOTE') + '<b>' + esc(v.cover || '') + '</b>' + (v.lock ? '<span class="tag">Locked by the team</span>' : '') + '</div>' +
    '<p style="margin:0 0 6px">' + esc(v.why || 'No desk view yet.') + '</p>' + (v.act ? '<p style="margin:0 0 6px"><b>Next action:</b> ' + esc(v.act) + '</p>' : '') +
    chk.map(c => '<span class="tag warn">' + esc(c.t) + '</span> ').join('') +
    '<p class="tiny muted" style="margin:6px 0 0">Updated ' + fmtDate(v.updated) + ' by ' + (v.by && String(v.by).startsWith('Claude') ? 'Claude' : who(v.by)) + '</p>' +
    (refs.length ? '<div style="margin-top:8px" class="small">' + refs.map(r => { const u = safeUrl(r.url); return '<div>· ' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(r.title) + '</a>' : esc(r.title)) + ' <span class="muted">' + fmtDate(r.date) + '</span></div>'; }).join('') + '</div>' : '') + '</section>';
  if(i.flag) html += '<section class="dr-sec"><h3>Risk, compliance and quality</h3><p style="margin:0"><span class="tag flag-' + (i.flagLevel === 'high' ? 'high' : 'med') + '">' + (i.flagLevel === 'high' ? 'High' : 'Watch') + '</span> ' + esc(i.flag) + '</p></section>';
  html += '<section class="dr-sec">' + drawerPriceSection(id) + '</section>';
  const vs = drawerValueSection(id); if(vs) html += '<section class="dr-sec">' + vs + '</section>';
  html += '<section class="dr-sec"><h3>Quotes</h3>' + (quotes.length ? '<div class="scroll"><table><thead><tr><th>Date</th><th>Supplier</th><th class="r">Rs/kg</th><th>Terms</th></tr></thead><tbody>' + quotes.map(q => '<tr><td class="small num">' + fmtDate(q.date) + '</td><td>' + esc(q.p.supplier || q.source) + '</td><td class="r num">' + n(q.value) + '</td><td class="small">' + esc([q.p.basis, q.p.terms].filter(Boolean).join(' · ')) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted small" style="margin:0">No quotes yet.</p>') + '</section>';
  if(decs.length) html += '<section class="dr-sec"><h3>Decisions</h3>' + decs.map(d => '<div class="small">' + fmtDate(d.date) + ' · ' + esc(d.action) + (d.qtyMT ? ' · ' + n(d.qtyMT, 1) + ' MT' : '') + (isFinite(Number(d.value)) ? ' at Rs ' + n(d.value) : '') + (d.note ? ' — ' + esc(d.note) : '') + '</div>').join('') + '</section>';
  if(tagged.length) html += '<section class="dr-sec"><h3>Related intel</h3><div class="intel">' + tagged.sort((a,b) => String(b.date) < String(a.date) ? -1 : 1).slice(0, 5).map(intelCard).join('') + '</div></section>';
  return html;
}
function renderDrawer(full){
  const id = S.open; if(!id) return; const i = BYID[id];
  if(full || !$('drDyn')){
    $('drawerHost').innerHTML = '<div class="drawer-back" data-close="1"></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drTitle">' +
      '<div class="dr-head"><div style="flex:1;min-width:0"><div class="tiny muted">' + esc(CATNAME[i.cat]) + ' · ' + esc(i.origin) + (i.mapped ? ' · ERP name mapped' : '') + '</div><h2 id="drTitle">' + esc(i.mat) + '</h2><div class="small muted">' + esc(i.erp) + (i.note ? ' · ' + esc(i.note) : '') + '</div></div><button class="btn sm" data-close="1" aria-label="Close">Close</button></div>' +
      '<div class="dr-body"><div id="drDyn" style="display:flex;flex-direction:column;gap:14px"></div>' +
      '<section class="dr-sec" id="drForms"><h3>Act on it</h3>' +
        '<form id="drQuote" class="form" autocomplete="off"><div class="field"><label for="drqPrice">Quote</label><input id="drqPrice" type="number" step="0.01" min="0" required inputmode="decimal"></div><div class="field"><label for="drqUnit">Unit</label><select id="drqUnit">' + Object.entries(UNIT).map(([k,u]) => '<option value="' + k + '">' + u.l + '</option>').join('') + '</select></div><div class="field"><label for="drqSup">Supplier</label><input id="drqSup" maxlength="120" required></div><div class="formbar wide"><button class="btn primary sm" type="submit">Save quote</button><span class="note" id="drqMsg"></span></div></form>' +
        '<details style="margin-top:12px" id="drViewBox"><summary style="cursor:pointer;font-weight:600">Change the desk view</summary><form id="drView" class="form" style="margin-top:10px" autocomplete="off"><div class="field"><label for="drvStance">Signal</label><select id="drvStance">' + Object.entries(STANCE).map(([k, s]) => '<option value="' + k + '">' + s.label + '</option>').join('') + '</select></div><div class="field"><label for="drvCover">Cover</label><input id="drvCover" maxlength="60"></div><div class="field wide"><label for="drvWhy">Why</label><textarea id="drvWhy" rows="3" maxlength="800"></textarea></div><div class="field wide"><label for="drvAct">Next action</label><input id="drvAct" maxlength="300"></div><div class="formbar wide"><button class="btn primary sm" type="submit">Save and lock</button><button class="btn sm" type="button" id="drvUnlock">Release to daily refresh</button><span class="note" id="drvMsg"></span></div></form></details>' +
      '</section></div></aside>';
    const v = S.views[id] || {};
    $('drvStance').value = v.stance || 'QUOTE'; $('drvCover').value = v.cover || ''; $('drvWhy').value = v.why || ''; $('drvAct').value = v.act || '';
    applyWriteGate();
    setTimeout(() => { const c = document.querySelector('.dr-head [data-close]'); if(c) c.focus(); }, 0);
  }
  $('drDyn').innerHTML = drawerDynamic(id);
}

/* ---------- writes ---------- */
function applyWriteGate(){
  const can = false;
  document.querySelectorAll('#quoteForm button[type=submit], #decForm button[type=submit], #intelForm button[type=submit], #drQuote button[type=submit], #drView button, #drvUnlock').forEach(b => { b.disabled = !can; });
  const msg = 'Read-only copy: log quotes, decisions, notes and view changes in the Claude desk; they appear here after the next update.';
  ['qMsg','dMsg','intelMsg','drqMsg','drvMsg'].forEach(k => { const el = $(k); if(el && msg) el.textContent = msg; });
}
async function guardedWrite(fn, msgEl){
  if(!S.db){ if(msgEl) msgEl.textContent = 'Not connected to the shared desk.'; return false; }
  try { await fn(); if(msgEl){ msgEl.className = 'note ok'; msgEl.textContent = 'Saved.'; setTimeout(() => { if(msgEl.textContent === 'Saved.') msgEl.textContent = ''; }, 2500); } return true; }
  catch(e){ const code = e && e.code; if(msgEl){ msgEl.className = 'note err'; msgEl.textContent = code === 'invalid_argument' ? 'Not saved: your access does not allow changes here.' : code === 'quota_exceeded' ? 'Not saved: the desk store is full. Delete old quotes.' : code === 'resource_exhausted' ? 'Not saved: too many changes at once. Try again in a moment.' : 'Not saved. Try again.'; }
    if(code === 'invalid_argument'){ S.canWrite = false; applyWriteGate(); } return false; }
}
function quoteDoc(ing, price, unitKey, supplier, extra={}){
  const u = UNIT[unitKey]; let rskg = price * u.f; if(u.usd){ const r = fx(); if(!r) throw {code:'no_fx'}; rskg *= r; }
  return {ing, date:today(), value:Math.round(rskg * 100) / 100, raw:price, rawUnit:unitKey, kind:'quote', supplier, by:S.uid || null, createdAt:new Date().toISOString(), ...extra};
}

/* ---------- AI brief & refresh ---------- */
function boardSnapshot(){
  const rp = refPrices();
  const rows = ING.map(i => { const v = S.views[i.id] || {}; const m = metricsFor(i.id); const val = i.nut ? valueOf(i.nut, rp) : null;
    return {item:i.mat, erp:i.erp, use:i.use, signal:v.stance || 'QUOTE', cover:v.cover || '', why:v.why || '', act:v.act || '', priceRsKg:m.last ? m.last.value : null, priceDate:m.last ? m.last.date : null, chg30:m.chg30 != null ? Math.round(m.chg30 * 10) / 10 : null, valueRsKg:val != null ? Math.round(val * 10) / 10 : null, flag:i.flag || ''}; });
  const intel = Object.values(S.intel).filter(d => d.date >= shiftDate(today(), -45)).map(d => ({date:d.date, title:d.title, summary:d.summary, impact:d.impact}));
  const bench = Object.fromEntries(Object.entries(S.bench).map(([k, b]) => [k, {value:b.value, unit:b.unit, date:b.date, note:b.note || ''}]));
  const quotes = Object.values(S.prices).filter(p => p.kind === 'quote' && p.date >= shiftDate(today(), -30)).map(p => ({item:(BYID[p.ing] || {}).mat, rsKg:p.value, supplier:p.supplier, date:p.date, terms:p.terms || ''}));
  return {asOf:today(), referencePrices:{maizeRsKg:rp.pm, sbmRsKg:rp.ps, sbmIsPlanPrice:rp.sbmIsPlan}, benchmarks:bench, ingredients:rows, recentQuotes:quotes, intel};
}
async function runBrief(){
  const host = $('briefHost'); if(!S.sample) return;
  host.innerHTML = '<div class="drawer-back" data-close-brief="1"></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="brTitle"><div class="dr-head"><div style="flex:1"><h2 id="brTitle">Today\'s buy plan</h2><div class="small muted">Drafted by Claude from the data on this desk. Check it before acting.</div></div><button class="btn sm" data-close-brief="1">Close</button></div><div class="dr-body"><div class="dr-sec"><div class="brief" id="briefOut">Thinking…</div></div></div></aside>';
  const out = $('briefOut');
  const prompt = 'You are the head of procurement for a poultry-feed and cattle-feed (wanda) mill in Punjab, Pakistan. The mill pays cash. Using ONLY the JSON below, write today\'s buy plan.\n' +
    'Format: a one-line headline, then 6 to 10 numbered actions, most urgent first. Each action: ingredient, what to do (buy, lock, accumulate, wait, hand-to-mouth, phase out), days of cover, a price ceiling in Rs/kg where the data supports one, and the reason with its date. Then a short "Risks to watch" list of 3 items.\n' +
    'Rules: never invent a price, a source or a date that is not in the JSON; where an item has no price, say "get quotes". Prices are Rs/kg unless stated. Plain text, no markdown tables.\n\nJSON:\n' + JSON.stringify(boardSnapshot());
  try { const r = await S.sample(prompt, {onText:({text}) => { out.textContent = text; }, modelTier:'default', cache:false}); out.textContent = r.text + (r.truncated ? '\n\n[Cut short.]' : ''); }
  catch(e){ out.textContent = e && e.code === 'not_granted' ? 'Drafting needs your permission to let this page ask Claude. Allow it from the page\'s permissions to use this.' : e && e.code === 'rate_limited' ? 'Too many drafts just now. Try again in a minute.' : ((e && e.text) ? e.text + '\n\n[Stopped early.]' : 'The draft could not be produced. Try again later.'); }
}
async function runRefresh(){
  const btn = $('btnRefresh'); const trig = S.meta && S.meta.triggerId; if(!S.mcp || !trig) return;
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Starting refresh…';
  try { await S.mcp.callTool('Claude Code Remote', 'fire_trigger', {trigger_id:String(trig)}); btn.textContent = 'Refresh running: data updates here in 5–15 min'; setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 90000); }
  catch(e){ const c = e && e.code; btn.disabled = false;
    btn.textContent = c === 'server_not_connected' ? 'Add Claude Code Remote in Settings → Connectors' : c === 'needs_reauth' ? 'Reconnect Claude Code Remote in Settings → Connectors' : (c === 'not_in_manifest' || c === 'approval_required') ? 'Refresh needs your approval: click again' : c === 'tool_error' ? 'Only the desk owner can run the refresh' : c === 'server_unavailable' ? 'Refresh service busy: try again shortly' : 'Refresh did not start';
    setTimeout(() => { btn.textContent = old; }, 8000); }
}
function csv(rows){ return rows.map(r => r.map(x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n'); }
async function exportCsv(kind){
  if(!S.downloads) return; let rows;
  if(kind === 'quotes'){ rows = [['date','ingredient','erp_name','supplier','rs_per_kg','as_quoted','unit','basis','terms','valid_till','note']].concat(Object.values(S.prices).filter(p => p.kind === 'quote').map(p => [p.date, (BYID[p.ing]||{}).mat, (BYID[p.ing]||{}).erp, p.supplier, p.value, p.raw, p.rawUnit, p.basis, p.terms, p.validTill, p.note])); }
  else { rows = [['date','ingredient','decision','qty_mt','rs_per_kg','supplier','reason']].concat(Object.values(S.decisions).map(d => [d.date, (BYID[d.ing]||{}).mat, d.action, d.qtyMT, d.value, d.supplier, d.note])); }
  try { await S.downloads.save({filename:'ingredient-desk-' + kind + '-' + today() + '.csv', data:csv(rows)}); } catch(e){}
}

/* ---------- render loop ---------- */
let raf = 0;
function schedule(){ if(raf) return; raf = requestAnimationFrame(() => { raf = 0; renderAll(); }); }
function renderAll(){
  renderStatus(); renderKpis();
  if(S.tab === 'board') renderBoard();
  if(S.tab === 'value') renderValue();
  if(S.tab === 'intel') renderIntel();
  if(S.tab === 'desk') renderDesk();
  if(S.tab === 'import') calcImport();
  if(S.open) renderDrawer(false);
  const sch = S.meta && S.meta.schedule; $('schedNote').textContent = sch ? 'Automatic refresh: ' + sch + '.' + (S.meta.lastRefresh ? ' Last run ' + new Date(S.meta.lastRefresh).toLocaleString('en-GB') + (S.meta.refreshNote ? ' — ' + S.meta.refreshNote : '') : '') : '';
  $('btnRefresh').hidden = !(S.mcp && S.meta && S.meta.triggerId);
}
function setTab(t){
  if(!document.querySelector('[data-panel="' + t + '"]')) t = 'board';
  S.tab = t; document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== t; });
  if(location.hash !== '#' + t){ try { history.replaceState(null, '', '#' + t); } catch(e){} }
  lsSet('fid.tab', t); renderAll();
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const tb = e.target.closest('nav.tabs button'); if(tb){ setTab(tb.dataset.tab); return; }
  if(e.target.closest('[data-close]')){ closeDrawer(); return; }
  if(e.target.closest('[data-close-brief]')){ $('briefHost').innerHTML = ''; return; }
  const op = e.target.closest('[data-open]'); if(op && !e.target.closest('a')){ openDrawer(op.dataset.open); return; }
  const u = e.target.closest('#fUse button'); if(u){ S.f.use = u.dataset.use; document.querySelectorAll('#fUse button').forEach(b => b.setAttribute('aria-pressed', b === u ? 'true' : 'false')); renderBoard(); return; }
  const im = e.target.closest('#iImp button'); if(im){ S.fi.imp = im.dataset.imp; document.querySelectorAll('#iImp button').forEach(b => b.setAttribute('aria-pressed', b === im ? 'true' : 'false')); renderIntel(); return; }
  const dq = e.target.closest('[data-del-quote]'); if(dq){ const id = dq.dataset.delQuote; guardedWrite(() => S.db.collection('prices').doc(id).delete(), $('qMsg')); return; }
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){ if($('briefHost').innerHTML){ $('briefHost').innerHTML = ''; } else if(S.open) closeDrawer(); }
  if(e.key === 'Enter' && e.target.matches && e.target.matches('tr.row')) openDrawer(e.target.dataset.open);
});
document.addEventListener('mousemove', chartHover);
document.addEventListener('mouseleave', e => { if(e.target && e.target.classList && e.target.classList.contains('chart-wrap')) hideTip(e.target); }, true);
$('fQ').addEventListener('input', e => { S.f.q = e.target.value; renderBoard(); });
$('fCat').addEventListener('change', e => { S.f.cat = e.target.value; renderBoard(); });
$('fStance').addEventListener('change', e => { S.f.stance = e.target.value; renderBoard(); });
$('iIng').addEventListener('change', e => { S.fi.ing = e.target.value; renderIntel(); });
['vMaize','vSbm','vAdd'].forEach(k => $(k).addEventListener('input', () => renderValue()));
['pCfr','pIns','pFx','pCd','pAcd','pRd','pSt','pIt','pPort','pDays','pRate'].forEach(k => $(k).addEventListener('input', calcImport));
$('pPreset').addEventListener('change', applyPreset);
$('qPrice').addEventListener('input', convertQuote); $('qUnit').addEventListener('change', convertQuote);
$('quoteForm').addEventListener('submit', async e => { e.preventDefault(); const price = Number($('qPrice').value); if(!(price > 0)) return;
  let doc; try { doc = quoteDoc($('qIng').value, price, $('qUnit').value, $('qSupplier').value.trim(), {basis:$('qBasis').value, terms:$('qTerms').value, validTill:$('qValid').value || null, note:$('qNote').value.trim()}); } catch(err){ $('qMsg').textContent = 'Load the exchange rate before saving a US$ quote.'; return; }
  const ok = await guardedWrite(() => S.db.collection('prices').add(doc), $('qMsg')); if(ok){ $('qPrice').value = ''; $('qNote').value = ''; $('qConv').textContent = ''; } });
$('decForm').addEventListener('submit', async e => { e.preventDefault(); const qty = Number($('dQty').value); const px = Number($('dPrice').value);
  const doc = {ing:$('dIng').value, date:today(), action:$('dAction').value, qtyMT:isFinite(qty) && qty > 0 ? qty : null, value:isFinite(px) && px > 0 ? px : null, supplier:$('dSupplier').value.trim(), note:$('dNote').value.trim(), by:S.uid || null, createdAt:new Date().toISOString()};
  const ok = await guardedWrite(() => S.db.collection('decisions').add(doc), $('dMsg')); if(ok){ $('dQty').value = ''; $('dPrice').value = ''; $('dNote').value = ''; } });
$('intelForm').addEventListener('submit', async e => { e.preventDefault(); const t = $('inTitle').value.trim(); if(!t) return;
  const doc = {date:$('inDate').value || today(), title:t, summary:$('inSummary').value.trim(), url:safeUrl($('inUrl').value) || '', impact:$('inImpact').value, tags:$('inTag').value ? [$('inTag').value] : [], source:'Desk note', by:S.uid || null, createdAt:new Date().toISOString()};
  const ok = await guardedWrite(() => S.db.collection('intel').add(doc), $('intelMsg')); if(ok){ $('inTitle').value = ''; $('inSummary').value = ''; $('inUrl').value = ''; } });
document.addEventListener('submit', async e => {
  if(e.target.id === 'drQuote'){ e.preventDefault(); const price = Number($('drqPrice').value); if(!(price > 0)) return; let doc;
    try { doc = quoteDoc(S.open, price, $('drqUnit').value, $('drqSup').value.trim(), {basis:'', terms:'', note:''}); } catch(err){ $('drqMsg').textContent = 'Load the exchange rate first.'; return; }
    const ok = await guardedWrite(() => S.db.collection('prices').add(doc), $('drqMsg')); if(ok){ $('drqPrice').value = ''; } }
  if(e.target.id === 'drView'){ e.preventDefault(); const id = S.open; const prev = S.views[id] || {};
    const doc = {...prev, stance:$('drvStance').value, cover:$('drvCover').value.trim(), why:$('drvWhy').value.trim(), act:$('drvAct').value.trim(), updated:today(), by:S.uid || null, lock:true};
    await guardedWrite(() => S.db.collection('views').doc(id).set(doc), $('drvMsg')); }
}, true);
document.addEventListener('click', async e => { if(e.target.id === 'drvUnlock'){ const id = S.open; const prev = S.views[id]; if(!prev) return; await guardedWrite(() => S.db.collection('views').doc(id).set({...prev, lock:false}), $('drvMsg')); } });
$('btnBrief').addEventListener('click', runBrief);
$('btnRefresh').addEventListener('click', runRefresh);
$('expQuotes').addEventListener('click', () => exportCsv('quotes'));
$('expDec').addEventListener('click', () => exportCsv('decisions'));
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if(h) setTab(h); });

/* ---------- boot ---------- */
(function init(){
  $('fCat').innerHTML += CATS.map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('');
  $('fStance').innerHTML += Object.entries(STANCE).map(([k, s]) => '<option value="' + k + '">' + s.label + '</option>').join('');
  $('iIng').innerHTML += ING.map(i => '<option value="' + i.id + '">' + esc(i.mat) + '</option>').join('');
  $('inTag').innerHTML = '<option value="">None</option>' + ING.map(i => '<option value="' + i.id + '">' + esc(i.mat) + '</option>').join('');
  $('qIng').innerHTML = ingOptions('maize'); $('dIng').innerHTML = ingOptions('maize');
  $('inDate').value = today(); initImport();
  const h = location.hash.slice(1); const saved = lsGet('fid.tab'); setTab(h || saved || 'board');
})();
/* ---------- standalone data loader (replaces the claude.ai shared database) ---------- */
const DATA_BASE = 'data/base/', DATA_INDEX = 'data/updates/index.json', DATA_DIR = 'data/updates/';
function applyOp(st, op){
  const c = op.c || op.collection, id = op.id || op.doc_id; if(!c || !id) return; st[c] = st[c] || {};
  const strip = o => { const r = {}; for(const [k, v] of Object.entries(o || {})){ if(!(v && typeof v === 'object' && !Array.isArray(v) && v.__delete__)) r[k] = v; } return r; };
  if(op.op === 'delete'){ delete st[c][id]; return; }
  if(op.op === 'set'){ st[c][id] = strip(op.data); return; }
  const cur = st[c][id] || {};
  if(op.op === 'merge' || op.op === 'update'){ const nx = {...cur}; for(const [k, v] of Object.entries(op.data || {})){ if(v && typeof v === 'object' && !Array.isArray(v) && v.__delete__) delete nx[k]; else nx[k] = v; } st[c][id] = nx; return; }
  if(op.op === 'append'){ const pts = Array.isArray(cur.points) ? cur.points.slice() : [];
    for(const p of (op.points || [])){ if(!Array.isArray(p)) continue; const k = pts.findIndex(q => q[0] === p[0]); if(k >= 0) pts[k] = p; else pts.push(p); }
    pts.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); st[c][id] = {...cur, ...(op.data || {}), points:pts}; }
}
async function getJson(u){ const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), {cache:'no-store'}); if(!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
async function loadData(first){
  try {
    const man = await getJson(DATA_BASE + 'index.json'); const st = {}; const parts = await Promise.all((man.files || []).map(f => getJson(DATA_BASE + f.file).then(d => [f.c, d])));
    parts.forEach(([c, d]) => { st[c] = Object.assign(st[c] || {}, d || {}); }); if(!Object.keys(st.views || {}).length) throw new Error('no base data');
    let files = []; try { const ix = await getJson(DATA_INDEX); files = Array.isArray(ix.files) ? ix.files.slice().sort() : []; } catch(e){}
    const ups = await Promise.all(files.map(f => getJson(DATA_DIR + encodeURIComponent(f)).catch(() => null)));
    ups.forEach(u => { if(u && Array.isArray(u.ops)) u.ops.forEach(op => { try { applyOp(st, op); } catch(e){} }); });
    COLL.forEach(c => { S[c] = st[c] || {}; S.loaded[c] = true; });
    S.meta = (st.meta && st.meta.status) || null; S.dbState = 'ok'; S.err = null;
    if(first) $('banner').innerHTML = '';
    schedule();
  } catch(e){
    S.err = e; if(first){ S.dbState = 'none'; renderAll(); }
    setStatus('off', first ? 'Data file could not load' : 'Could not reach the latest data; showing the last copy');
    if(first) $('banner').innerHTML = '<div class="banner">The desk data could not be loaded. Check your internet connection and reload the page.</div>';
  }
}
S.downloads = {save:({filename, data}) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], {type:'text/csv'})); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }};
$('expQuotes').hidden = false; $('expDec').hidden = false;
S.canWrite = false; applyWriteGate();
loadData(true);
setInterval(() => loadData(false), 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') loadData(false); });
