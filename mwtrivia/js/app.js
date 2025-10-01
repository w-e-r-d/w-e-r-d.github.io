// ===== Config =====
const CSV_URL = './data/mw_words_rare.csv'; // your CSV path
const ROUNDS_PER_GAME = 3;
const WORDS_PER_ROUND = 10;

// ===== State =====
let persistence = 'session';            // or 'local'
let dataRows = [];                      // raw rows from CSV
let songs = [];                         // unique song index for search box
let docFreq = new Map();                // word -> number of unique songs containing it

let currentMode = null;                 // 'super-rare' | 'rare' | 'audio'
let currentWordItem = null;             // the active (song,word) row
let selectedSong = null;                // chosen song (must submit to grade)

// Game lifecycle state (memory only)
let game = null;                        // { mode, scope, roundIndex, wordIndex, rounds:[{score, items:[] }], total }
// item structure pushed into rounds[i].items: { word, song_title, album, cover_url, count_global, correct, points }

// ===== DOM =====
const els = {};
function q(id){ return document.getElementById(id); }
function selectEls(){
  [
    'scopeSelect','btnTogglePersist',
    'modeGate','gameUI','scoreBar',
    'modeLabel','scoreBubbleBest',
    'gameTitle','wordSpan','countInSong','countGlobal',
    'songSearch','results','guessFeedback',
    'btnSubmit','btnReveal','btnNext',
    'confettiLayer','wordBox','gameCard',
    'roundLabel','wordLabel',
    // Round summary + Game over
    'roundSummary','roundSummaryTitle','roundSummaryDesc','roundBreakdown','btnNextRound',
    'gameOver','goRounds','goTotal','btnDownloadImage','btnPlayAgain','goModeScope'
  ].forEach(k => els[k] = q(k));
  els.modeCards = Array.from(document.querySelectorAll('.modecard'));
}

// ===== Storage (kept for future; bubble now shows game score) =====
function storage(){ return persistence === 'local' ? localStorage : sessionStorage; }
function updateScoreBubble(){ els.scoreBubbleBest.textContent = String(game?.total || 0); }

// ===== CSV parsing =====
async function loadCSV(){
  const res = await fetch(CSV_URL, { cache: 'no-store' });
  if(!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const text = await res.text();
  dataRows = parseCSV(text);
  if (!dataRows.length) throw new Error('CSV had no rows.');
  rebuildSongIndex();
  buildDocFrequency();
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
  const sets = new Map(); // word -> set(track ids)
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

// ===== Game helpers =====
function poolFilterByMode(r){
  const scopeOK = (els.scopeSelect.value === 'all' || r.is_album);
  if (!scopeOK) return false;
  if (currentMode === 'super-rare'){
    return (docFreq.get((r.word||'').toLowerCase()) === 1);
  }
  if (currentMode === 'rare'){
    return r.count_global < 10;
  }
  return false; // audio handled separately
}

function sampleRoundWords(excludeSet){
  const pool = dataRows.filter(r => poolFilterByMode(r) && r.word && r.count_in_song > 0 && !excludeSet.has(r.word + '||' + r.song_title));
  if (pool.length < WORDS_PER_ROUND) return pool.slice(0, WORDS_PER_ROUND);
  // Weighted by rarity (inverse global count)
  const weights = pool.map(r => 1 / Math.max(1, r.count_global));
  const picks = [];
  const usedIdx = new Set();
  while (picks.length < WORDS_PER_ROUND && usedIdx.size < pool.length){
    const total = weights.reduce((a,b)=>a+b,0);
    let t = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++){
      t -= weights[idx];
      if (t <= 0) break;
    }
    if (!usedIdx.has(idx)){
      usedIdx.add(idx);
      picks.push(pool[idx]);
    }
  }
  return picks;
}

function startNewGame(mode){
  currentMode = mode; // 'super-rare' | 'rare'
  els.modeGate.classList.add('hidden');
  els.gameUI.classList.remove('hidden');
  els.scoreBar.classList.remove('hidden');

  els.modeLabel.textContent = mode === 'super-rare' ? 'Super Rare Words' : (mode === 'rare' ? 'Rare Words' : 'Guess the Song');
  els.gameTitle.textContent = els.modeLabel.textContent;

  game = {
    mode,
    scope: els.scopeSelect.value,
    roundIndex: 0,
    wordIndex: 0,
    rounds: Array.from({length: ROUNDS_PER_GAME}, ()=>({ score:0, items:[] })),
    usedKeys: new Set(),
    total: 0,
  };

  // Pre-sample all rounds now (so game is deterministic for this session)
  for (let r = 0; r < ROUNDS_PER_GAME; r++){
    const picks = sampleRoundWords(game.usedKeys);
    picks.forEach(p => game.usedKeys.add(p.word + '||' + p.song_title));
    game.rounds[r].picks = picks; // store source rows
  }

  updateScoreBubble();
  showWord();
}

function showWord(){
  els.roundLabel.textContent = `Round ${game.roundIndex+1} of ${ROUNDS_PER_GAME}`;
  els.wordLabel.textContent = `Word ${game.wordIndex+1} / ${WORDS_PER_ROUND}`;
  els.guessFeedback.textContent = '';
  els.songSearch.value = '';
  els.songSearch.classList.remove('error');
  els.btnSubmit.disabled = true;
  els.btnNext.disabled = true;
  selectedSong = null;

  const row = game.rounds[game.roundIndex].picks[game.wordIndex];
  currentWordItem = row;
  els.wordSpan.textContent = row.word;
  els.countInSong.textContent = String(row.count_in_song);
  els.countGlobal.textContent = String(row.count_global);
  hideResults();
}

function gradeSelection(){
  if (!currentWordItem) return;
  if (!selectedSong){
    els.songSearch.classList.add('error');
    flash(els.wordBox, 'shake', 450);
    els.guessFeedback.textContent = 'Pick a song from the list, then press Submit.';
    return;
  }
  const correct = selectedSong.song_title === currentWordItem.song_title;
  let points = 0;
  if (correct){
    points = Math.max(50, Math.round(1000 / Math.max(1, currentWordItem.count_global)));
    game.rounds[game.roundIndex].score += points;
    game.total += points;
    updateScoreBubble();
    els.guessFeedback.innerHTML = `Correct — <b>${currentWordItem.song_title}</b> <span class="muted">(${currentWordItem.album || ''})</span>`;
    flash(els.wordBox, 'success', 500);
    launchConfetti();
  } else {
    els.guessFeedback.textContent = 'Not that one. Try again!';
    els.songSearch.classList.add('error');
    flash(els.wordBox, 'shake', 450);
    // Keep current word until they get it right or hit Reveal
  }

  // Record item result (only on first correct submission)
  if (correct){
    game.rounds[game.roundIndex].items.push({
      word: currentWordItem.word,
      song_title: currentWordItem.song_title,
      album: currentWordItem.album,
      cover_url: currentWordItem.cover_url,
      count_global: currentWordItem.count_global,
      correct: true,
      points
    });
    els.btnNext.disabled = false;
  }
}

function nextStep(){
  // Advance within round
  if (game.wordIndex + 1 < WORDS_PER_ROUND){
    game.wordIndex += 1;
    showWord();
    return;
  }
  // Round complete -> round summary or next round / game over
  showRoundSummary();
}

function showRoundSummary(){
  const r = game.roundIndex;
  els.roundSummaryTitle.textContent = `Round ${r+1} Complete`;
  els.roundSummaryDesc.textContent = `You scored ${game.rounds[r].score} points this round.`;
  // breakdown list
  els.roundBreakdown.innerHTML = '';
  game.rounds[r].items.forEach(it => {
    const div = document.createElement('div');
    div.innerHTML = `• <b>${it.word}</b> ? ${it.song_title} <span class="muted">(+${it.points})</span>`;
    els.roundBreakdown.appendChild(div);
  });
  els.roundSummary.classList.remove('hidden');
}

function closeRoundSummaryAndAdvance(){
  els.roundSummary.classList.add('hidden');
  if (game.roundIndex + 1 < ROUNDS_PER_GAME){
    game.roundIndex += 1;
    game.wordIndex = 0;
    showWord();
  } else {
    // Game over
    showGameOver();
  }
}

function showGameOver(){
  els.goRounds.innerHTML = '';
  const modeName = game.mode === 'super-rare' ? 'Super Rare Words' : (game.mode === 'rare' ? 'Rare Words' : 'Guess the Song');
  const scopeName = game.scope === 'albums' ? 'Albums only' : 'Everything';
  els.goModeScope.textContent = `${modeName} · ${scopeName}`;
  game.rounds.forEach((r, idx) => {
    const div = document.createElement('div');
    div.innerHTML = `<b>Round ${idx+1}:</b> ${r.score} pts`;
    els.goRounds.appendChild(div);
  });
  els.goTotal.textContent = String(game.total);
  els.gameOver.classList.remove('hidden');
}

// ===== Export image =====
function downloadScoreImage(){
  // Render a simple 1200x628 PNG with scores
  const W = 1200, H = 628;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // background gradient
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0, '#22c55e');
  g.addColorStop(.6, '#0ea5e9');
  g.addColorStop(1, '#0ea5e9');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // card area
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  roundRect(ctx, 48, 48, W-96, H-96, 24, true, false);

  // header
  ctx.fillStyle = '#0e1116';
  ctx.font = '700 44px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  ctx.fillText('Morgan Wallen Trivia — Score', 76, 120);

  // mode/scope
  ctx.font = '400 24px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  const modeName = game.mode === 'super-rare' ? 'Super Rare Words' : (game.mode === 'rare' ? 'Rare Words' : 'Guess the Song');
  const scopeName = game.scope === 'albums' ? 'Albums only' : 'Everything';
  ctx.fillStyle = '#374151';
  ctx.fillText(`${modeName} · ${scopeName}`, 76, 160);

  // rounds
  ctx.fillStyle = '#0e1116';
  ctx.font = '600 28px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  let y = 230;
  game.rounds.forEach((r, i)=>{
    ctx.fillText(`Round ${i+1}: ${r.score} pts`, 76, y);
    y += 46;
  });

  // total
  ctx.font = '800 56px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  ctx.fillText(`Total: ${game.total} pts`, 76, y + 24);

  // save
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `mwtrivia_score_${Date.now()}.png`; a.click();
}

function roundRect(ctx, x, y, w, h, r, fill, stroke){
  if (typeof r === 'number') r = {tl:r,tr:r,br:r,bl:r};
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
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

// Anim helpers
function flash(el, className, ms=500){ el.classList.add(className); setTimeout(()=> el.classList.remove(className), ms); }
function launchConfetti(){
  const layer = els.confettiLayer;
  layer.classList.remove('hidden');
  const colors = ['#10b981','#0ea5e9','#22c55e','#f59e0b','#ef4444','#a78bfa'];
  const count = 90;
  for (let i=0;i<count;i++){
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const left = Math.random()*100;
    const size = 6 + Math.random()*8;
    const color = colors[Math.floor(Math.random()*colors.length)];
    const duration = 1.2 + Math.random()*0.9;
    const delay = Math.random()*0.3;
    piece.style.left = left + 'vw';
    piece.style.width = size + 'px';
    piece.style.height = (size*1.6) + 'px';
    piece.style.background = color;
    piece.style.animationDuration = `${duration}s, ${duration*0.8}s`;
    piece.style.animationDelay = `${delay}s, ${delay}s`;
    piece.style.setProperty('--twist', `rotate(${Math.random()*360}deg)`);
    layer.appendChild(piece);
  }
  setTimeout(()=> { layer.innerHTML = ''; layer.classList.add('hidden'); }, 2200);
}

// ===== Wiring =====
function wireModeGate(){
  els.modeCards.forEach(card => {
    const btn = card.querySelector('.btn');
    const mode = card.getAttribute('data-mode');
    btn.addEventListener('click', ()=>{
      if (mode === 'audio'){
        // still show coming soon; not wired to game rounds yet
        document.querySelector('#modeGate .modecard[data-mode="audio"] .btn').textContent = 'Coming Soon';
        return;
      }
      startNewGame(mode);
    });
  });
}

function wireGame(){
  // typing clears selection
  els.songSearch.addEventListener('input', (e)=>{
    selectedSong = null;
    els.btnSubmit.disabled = true;
    els.songSearch.classList.remove('error');
    if (!currentWordItem) return;
    const list = filterSongs(e.target.value);
    renderResults(list, els.results, (s)=>{
      // choose a song from results (but do not grade yet)
      selectedSong = s;
      els.songSearch.value = s.song_title;
      hideResults();
      els.btnSubmit.disabled = false;
    });
  });

  els.songSearch.addEventListener('focus', ()=>{
    const list = filterSongs(els.songSearch.value);
    renderResults(list, els.results, (s)=>{
      selectedSong = s;
      els.songSearch.value = s.song_title;
      hideResults();
      els.btnSubmit.disabled = false;
    });
  });

  document.addEventListener('click', (e)=>{
    if (!els.results.contains(e.target) && e.target !== els.songSearch) hideResults();
  });

  // Submit to grade
  els.btnSubmit.addEventListener('click', gradeSelection);
  els.songSearch.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); gradeSelection(); }});

  // Reveal (marks item as correct zero points, advances)
  els.btnReveal.addEventListener('click', ()=>{
    if (!currentWordItem) return;
    els.guessFeedback.innerHTML = `It was <b>${currentWordItem.song_title}</b>`;
    // record zero-point item if not already recorded for this index
    const curRound = game.rounds[game.roundIndex];
    if (!curRound.items.find(it => it.word === currentWordItem.word && it.song_title === currentWordItem.song_title)){
      curRound.items.push({ word: currentWordItem.word, song_title: currentWordItem.song_title, album: currentWordItem.album, cover_url: currentWordItem.cover_url, count_global: currentWordItem.count_global, correct:false, points:0 });
    }
    els.btnNext.disabled = false;
  });

  // Next
  els.btnNext.addEventListener('click', nextStep);

  // Round summary controls
  els.btnNextRound.addEventListener('click', closeRoundSummaryAndAdvance);

  // Game over controls
  els.btnPlayAgain.addEventListener('click', ()=>{ location.reload(); });
  els.btnDownloadImage.addEventListener('click', downloadScoreImage);
}

function wireFiltersAndPersist(){
  els.scopeSelect.addEventListener('change', ()=>{
    rebuildSongIndex();
    // game continues but future word pools honor new scope (only impacts next game ideally)
  });
  els.btnTogglePersist.addEventListener('click', ()=>{
    persistence = persistence === 'local' ? 'session' : 'local';
    els.btnTogglePersist.textContent = persistence === 'local' ? 'Using Local Storage' : 'Use Local Storage';
  });
}

// ===== Init =====
function init(){
  selectEls();
  wireModeGate();
  wireFiltersAndPersist();
  wireGame();
  updateScoreBubble();
  loadCSV().catch(err => console.error(err));
}
window.addEventListener('DOMContentLoaded', init);