// ===== Config =====
const CSV_URL = './data/mw_words_rare.csv'; // your CSV path

// ===== State =====
let persistence = 'session';            // or 'local'
let dataRows = [];                      // raw rows from CSV
let songs = [];                         // unique song index for search box
let currentRare = null;                 // current picked row
let currentMode = null;                 // 'super-rare' | 'rare' | 'audio'
let docFreq = new Map();                // word -> number of unique songs containing it

// ===== DOM =====
const els = {};
function q(id){ return document.getElementById(id); }
function selectEls(){
  [
    'scopeSelect','btnTogglePersist',
    'modeGate','gameUI','scoreBar',
    'modeLabel','scoreBubbleBest','attempts',
    'gameTitle','wordSpan','countInSong','countGlobal',
    'songSearch','results','guessFeedback',
    'btnNewRare','btnReveal'
  ].forEach(k => els[k] = q(k));
  els.modeCards = Array.from(document.querySelectorAll('.modecard'));
}

// ===== Storage =====
function storage(){ return persistence === 'local' ? localStorage : sessionStorage; }
function getScore(key, def=null){ try{ return JSON.parse(storage().getItem('mwtrivia_'+key)) ?? def; }catch{ return def; } }
function setScore(key, val){ storage().setItem('mwtrivia_'+key, JSON.stringify(val)); }
function updateScoreUI(){
  const rare = getScore('rare_best', 0) || 0;
  const attempts = getScore('attempts', 0) || 0;
  els.scoreBubbleBest.textContent = rare;
  els.attempts.textContent = attempts;
}

// ===== CSV parsing =====
async function loadCSV(){
  const res = await fetch(CSV_URL, { cache: 'no-store' });
  if(!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const text = await res.text();
  dataRows = parseCSV(text);
  if (!dataRows.length) throw new Error('CSV had no rows.');
  rebuildSongIndex();
  buildDocFrequency();                 // compute songs-with-word counts
}

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
  const out = []; let cur = ''; let inQuotes = false;
  for (let i=0; i<line.length; i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQuotes && line[i+1] === '"'){ cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes){ out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}
function toBool(v){ const s = String(v).toLowerCase().trim(); return s === 'true' || s === '1'; }

// ===== Indexing / frequency =====
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

function buildDocFrequency(){
  // word -> set of unique track ids containing it
  const sets = new Map();
  for (const r of dataRows){
    const w = (r.word || '').toLowerCase();
    const id = r.track_spotify_id || r.song_title;
    if (!w || !id) continue;
    if (!sets.has(w)) sets.set(w, new Set());
    sets.get(w).add(id);
  }
  docFreq = new Map();
  sets.forEach((s, w) => docFreq.set(w, s.size));
}

// ===== Mode logic =====
function setMode(mode){
  currentMode = mode; // 'super-rare' | 'rare' | 'audio'

  // UI show/hide
  els.modeGate.classList.add('hidden');
  els.gameUI.classList.remove('hidden');
  els.scoreBar.classList.remove('hidden');

  if (mode === 'super-rare'){
    els.modeLabel.textContent = 'Super Rare Words';
    els.gameTitle.textContent = 'Super Rare Words';
    pickWordForCurrentMode();
  } else if (mode === 'rare'){
    els.modeLabel.textContent = 'Rare Words';
    els.gameTitle.textContent = 'Rare Words';
    pickWordForCurrentMode();
  } else if (mode === 'audio'){
    els.modeLabel.textContent = 'Guess the Song (Audio)';
    els.gameTitle.textContent = 'Guess the Song (Audio)';
    // For now, show a friendly placeholder (Spotify hookup to be added later)
    els.wordSpan.textContent = 'Coming soon';
    els.countInSong.textContent = '0';
    els.countGlobal.textContent = '0';
    els.guessFeedback.textContent = 'Audio mode will use your Spotify account to play a random track.';
  }
}

function poolFilterByMode(r){
  const scopeOK = (els.scopeSelect.value === 'all' || r.is_album);
  if (!scopeOK) return false;

  if (currentMode === 'super-rare'){
    // word appears in exactly one unique song across the dataset
    return (docFreq.get((r.word||'').toLowerCase()) === 1);
  }
  if (currentMode === 'rare'){
    // word appears fewer than 10 times globally across all songs
    return r.count_global < 10;
  }
  return false;
}

function pickWordForCurrentMode(){
  const pool = dataRows.filter(r => poolFilterByMode(r) && r.word && r.count_in_song > 0);
  if (!pool.length){
    currentRare = null;
    els.wordSpan.textContent = '—';
    els.countInSong.textContent = '0';
    els.countGlobal.textContent = '0';
    els.guessFeedback.textContent = 'No rows match this mode/scope.';
    return;
  }
  // Weight by rarity (inverse global count) but clamp to avoid extremes
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

// ===== UI helpers =====
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

// ===== Wiring =====
function wireModeGate(){
  els.modeCards.forEach(card => {
    const btn = card.querySelector('.btn');
    const mode = card.getAttribute('data-mode');
    btn.addEventListener('click', ()=>{
      if (mode === 'audio'){
        // Show the UI but as "coming soon" (no dead button)
        setMode('audio');
      } else {
        setMode(mode);
      }
    });
  });
}

function wireGame(){
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
  els.btnNewRare.addEventListener('click', pickWordForCurrentMode);
  els.btnReveal.addEventListener('click', ()=>{
    if (!currentRare) return;
    els.guessFeedback.innerHTML = `It was <b>${currentRare.song_title}</b>`;
  });
}

function wireFiltersAndPersist(){
  els.scopeSelect.addEventListener('change', ()=>{
    rebuildSongIndex();
    if (currentMode === 'super-rare' || currentMode === 'rare') pickWordForCurrentMode();
  });
  els.btnTogglePersist.addEventListener('click', ()=>{
    persistence = persistence === 'local' ? 'session' : 'local';
    els.btnTogglePersist.textContent = persistence === 'local' ? 'Using Local Storage' : 'Use Local Storage';
    updateScoreUI();
  });
}

// ===== Init =====
function init(){
  selectEls();
  wireModeGate();
  wireFiltersAndPersist();
  wireGame();
  updateScoreUI();
  loadCSV().catch(err => console.error(err));
}
window.addEventListener('DOMContentLoaded', init);
