// ========== Config ==========
const CSV_URL = './data/mw_words_rare.csv'; // place your exported CSV here

// ========== State ==========
let persistence = 'session'; // or 'local'
let dataRows = [];
let songs = [];
let currentRare = null;

// ========== DOM ==========
const els = {};
function q(id){ return document.getElementById(id); }
function selectEls(){
  [
    'scopeSelect','wordSpan','countInSong','countGlobal','songSearch','results','guessFeedback',
    'btnNewRare','btnReveal','btnTogglePersist','scoreBubbleBest','attempts'
  ].forEach(k => els[k] = q(k));
}

// ========== Storage ==========
function storage(){ return persistence === 'local' ? localStorage : sessionStorage; }
function getScore(key, def=null){ try{ return JSON.parse(storage().getItem('mwtrivia_'+key)) ?? def; }catch{ return def; } }
function setScore(key, val){ storage().setItem('mwtrivia_'+key, JSON.stringify(val)); }
function updateScoreUI(){
  const rare = getScore('rare_best', 0) || 0;
  const attempts = getScore('attempts', 0) || 0;
  els.scoreBubbleBest.textContent = rare;
  els.attempts.textContent = attempts;
}

// ========== CSV ==========
async function loadCSV(){
  const res = await fetch(CSV_URL, { cache: 'no-store' });
  if(!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const text = await res.text();
  dataRows = parseCSV(text);
  if (!dataRows.length) throw new Error('CSV had no rows.');
  rebuildSongIndex();
  pickRareWord();
}

// Robust CSV parser (quotes + commas)
function parseCSV(text){
  const out = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if(!lines.length) return out;

  const headers = splitCSVRow(lines[0]).map(h => h.trim());
  const required = ['song_title','album','release_type','is_album','is_feature','track_spotify_id','cover_url','word','count_in_song','count_global'];
  const missing = required.filter(h => !headers.includes(h));
  if (missing.length){ throw new Error('Missing columns: ' + missing.join(', ')); }

  for (let i=1;i<lines.length;i++){
    const cols = splitCSVRow(lines[i]);
    if (!cols.length) continue;
    const row = {};
    headers.forEach((h, idx) => {
      let v = cols[idx] ?? '';
      v = v.replace(/^"(.*)"$/s, '$1').replace(/""/g, '"').trim();
      row[h] = v;
    });
    row.is_album = toBool(row.is_album);
    row.is_feature = toBool(row.is_feature);
    row.count_in_song = parseInt(row.count_in_song, 10) || 0;
    row.count_global = parseInt(row.count_global, 10) || 0;
    out.push(row);
  }
  return out;
}

function splitCSVRow(line){
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i=0; i<line.length; i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQuotes && line[i+1] === '"'){ cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes){
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
function toBool(v){ const s = String(v).toLowerCase().trim(); return s === 'true' || s === '1'; }

// ========== Core ==========
function rebuildSongIndex(){
  const scope = els.scopeSelect.value; // 'albums' | 'all'
  const map = new Map();
  for (const r of dataRows){
    if (scope === 'albums' && !r.is_album) continue;
    const key = r.track_spotify_id || r.song_title;
    if (!map.has(key)){
      map.set(key, {
        key,
        song_title: r.song_title,
        album: r.album,
        release_type: r.release_type,
        is_album: r.is_album,
        is_feature: r.is_feature,
        track_spotify_id: r.track_spotify_id,
        cover_url: r.cover_url,
      });
    }
  }
  songs = Array.from(map.values()).sort((a,b)=> a.song_title.localeCompare(b.song_title));
}

function pickRareWord(){
  const scope = els.scopeSelect.value;
  const pool = dataRows.filter(r => (scope === 'all' || r.is_album) && r.word && r.count_in_song > 0);
  if (!pool.length){
    currentRare = null;
    els.wordSpan.textContent = '—';
    els.countInSong.textContent = '0';
    els.countGlobal.textContent = '0';
    els.guessFeedback.textContent = 'No rows match this scope.';
    return;
  }
  // Weight by rarity (inverse global count)
  const weights = pool.map(r => 1 / Math.max(1, r.count_global));
  const total = weights.reduce((a,b)=>a+b,0);
  let pick = Math.random() * total;
  let chosen = pool[0];
  for (let i=0;i<pool.length;i++){ pick -= weights[i]; if (pick <= 0){ chosen = pool[i]; break; } }

  currentRare = chosen;
  els.wordSpan.textContent = chosen.word;
  els.countInSong.textContent = String(chosen.count_in_song);
  els.countGlobal.textContent = String(chosen.count_global);
  els.guessFeedback.textContent = '';
  els.songSearch.value = '';
  hideResults();
}

// ========== UI helpers ==========
function hideResults(){ els.results.classList.add('hidden'); els.results.innerHTML = ''; }
function renderResults(list, intoEl, onPick){
  intoEl.innerHTML = '';
  list.forEach(s => {
    const div = document.createElement('div');
    div.className = 'result';
    const img = document.createElement('img');
    img.className = 'cover';
    img.src = s.cover_url || '';
    img.alt = '';
    const span = document.createElement('div');
    span.className = 'songtitle';
    span.innerHTML = `<b>${s.song_title}</b> <span class="muted">— ${s.album || ''}</span>`;
    div.appendChild(img); div.appendChild(span);
    div.addEventListener('click', ()=> onPick(s));
    intoEl.appendChild(div);
  });
  if (list.length) intoEl.classList.remove('hidden'); else intoEl.classList.add('hidden');
}
function filterSongs(query){
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return songs.filter(s => (s.song_title + ' ' + (s.album||'')).toLowerCase().includes(q)).slice(0, 20);
}

// ========== Wiring ==========
function wireRareMode(){
  els.songSearch.addEventListener('input', (e)=>{
    if (!currentRare) return;
    const list = filterSongs(e.target.value);
    renderResults(list, els.results, (s)=>{
      els.songSearch.value = s.song_title;
      hideResults();
      const correct = s.song_title === currentRare.song_title;
      const attempts = (getScore('attempts', 0) || 0) + 1;
      setScore('attempts', attempts);
      if (correct){
        els.guessFeedback.innerHTML = `Correct — <b>${currentRare.song_title}</b> <span class="muted">(${currentRare.album || ''})</span>`;
        const pts = Math.max(50, Math.round(1000 / Math.max(1, currentRare.count_global)));
        const best = getScore('rare_best', 0) || 0;
        if (pts > best) setScore('rare_best', pts);
        updateScoreUI();
      } else {
        updateScoreUI();
        els.guessFeedback.textContent = 'Not that one. Try again!';
      }
    });
  });
  els.songSearch.addEventListener('focus', ()=>{
    const list = filterSongs(els.songSearch.value);
    renderResults(list, els.results, ()=>{});
  });
  document.addEventListener('click', (e)=>{
    if (!els.results.contains(e.target) && e.target !== els.songSearch) hideResults();
  });
  els.btnNewRare.addEventListener('click', pickRareWord);
  els.btnReveal.addEventListener('click', ()=>{
    if (!currentRare) return;
    els.guessFeedback.innerHTML = `It was <b>${currentRare.song_title}</b>`;
  });
}

function wireFiltersAndPersist(){
  els.scopeSelect.addEventListener('change', ()=>{ rebuildSongIndex(); if (currentRare) pickRareWord(); });
  els.btnTogglePersist.addEventListener('click', ()=>{
    persistence = persistence === 'local' ? 'session' : 'local';
    els.btnTogglePersist.textContent = persistence === 'local' ? 'Using Local Storage' : 'Use Local Storage';
    updateScoreUI();
  });
}

// ========== Init ==========
function init(){
  selectEls();
  updateScoreUI();
  wireFiltersAndPersist();
  wireRareMode();
  loadCSV().catch(err => console.error(err));
}
window.addEventListener('DOMContentLoaded', init);
