// MW Trivia app.js — consolidated & fixed
// If you see this log, the JS loaded correctly.
console.log('MW Trivia app.js loaded', new Date().toISOString());

// ===== Config =====
const CSV_URL = './data/mw_words_rare.csv'; // your CSV path
const ROUNDS_PER_GAME = 3;
const WORDS_PER_ROUND = 5;      // used for both word and audio modes
const ATTEMPTS_MAX = 3;         // cap per item
const SCORE_BY_ATTEMPT = [1000, 500, 150]; // for word modes only

// ===== State =====
let persistence = 'session';            // or 'local'
let dataRows = [];                      // raw rows from CSV
let songs = [];                         // unique song index for search box / audio mode
let docFreq = new Map();                // word -> number of unique songs containing it

let currentMode = null;                 // 'super-rare' | 'rare' | 'audio'
let currentWordItem = null;             // the active (song,word) row (word modes)
let selectedSong = null;                // chosen song (word modes)
let attemptIndex = 0;                   // 0-based counter for current word (word modes)
let wordResolved = false;               // lock once correct/revealed/exhausted (word modes)

// Game lifecycle state (shared across modes)
let game = null;                        // { mode, scope, roundIndex, wordIndex, rounds:[{score, items:[], picks:[] }], total, usedKeys:Set }
// items:
//  - word modes: { word, song_title, album, cover_url, count_global, correct, points }
//  - audio mode: { song_title, album, cover_url, time_ms, correct, points }

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
    'roundLabel','wordLabel','attemptsBadge',
    // Round summary + Game over
    'roundSummary','roundSummaryTitle','roundSummaryDesc','roundBreakdown','btnNextRound',
    'gameOver','goRounds','goTotal','btnDownloadImage','btnPlayAgain','goModeScope',
    // Audio mode
    'audioUI','btnSpotifyConnect','btnAudioStart','btnAudioNext','audioTimer','audioSongSearch','audioResults','btnAudioSubmit','audioAttemptsBadge','audioFeedback','audioStatus','spotifyPlayerContainer'
  ].forEach(k => els[k] = q(k));
  els.modeCards = Array.from(document.querySelectorAll('.modecard'));
}

// ===== Storage (bubble shows live game total) =====
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
    // sanitize visible strings
    row.song_title = sanitizeText(row.song_title);
    row.album = sanitizeText(row.album);
    row.word = sanitizeText(row.word);

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
  // Scope removed: always include everything (albums, singles, features)
  const map = new Map();
  for (const r of dataRows){
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

function updateAttemptsBadge(){
  if (!els.attemptsBadge) return;
  const left = Math.max(0, ATTEMPTS_MAX - attemptIndex);
  els.attemptsBadge.textContent = wordResolved ? 'Resolved' : ('Attempts left: ' + left);
}

// ===== Mode / Game helpers (word modes) =====
function poolFilterByMode(r){
  // Scope removed: always include everything
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
  if (pool.length <= WORDS_PER_ROUND) return pool.slice(0, WORDS_PER_ROUND);
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

  els.modeLabel.textContent = mode === 'super-rare' ? 'Super Rare Words' : 'Rare Words';
  els.gameTitle.textContent = els.modeLabel.textContent;

  game = {
    mode,
    scope: 'all',
    roundIndex: 0,
    wordIndex: 0,
    rounds: Array.from({length: ROUNDS_PER_GAME}, ()=>({ score:0, items:[], picks:[] })),
    usedKeys: new Set(),
    total: 0,
  };

  // Pre-sample all rounds for determinism in this session
  for (let r = 0; r < ROUNDS_PER_GAME; r++){
    const picks = sampleRoundWords(game.usedKeys);
    picks.forEach(p => game.usedKeys.add(p.word + '||' + p.song_title));
    game.rounds[r].picks = picks; // store source rows
  }

  updateScoreBubble();
  showWord();
}

function showWord(){
  setRoundLabel(`Round ${game.roundIndex+1} of ${ROUNDS_PER_GAME}`);
  setWordLabel(`Word ${game.wordIndex+1} / ${WORDS_PER_ROUND}`);
  els.guessFeedback.textContent = '';
  els.songSearch.value = '';
  els.songSearch.classList.remove('error');
  els.btnSubmit.disabled = true;
  els.btnNext.disabled = true;
  selectedSong = null;
  attemptIndex = 0;
  wordResolved = false;
  updateAttemptsBadge();

  const row = game.rounds[game.roundIndex].picks[game.wordIndex];
  currentWordItem = row;
  els.wordSpan.textContent = sanitizeText(row.word);
  els.countInSong.textContent = String(row.count_in_song);
  els.countGlobal.textContent = String(row.count_global);
  hideResults();
}

function gradeSelection(){
  if (!currentWordItem) return;
  if (wordResolved) return; // already resolved
  if (!selectedSong){
    els.songSearch.classList.add('error');
    flash(els.wordBox, 'shake', 450);
    els.guessFeedback.textContent = 'Pick a song from the list, then press Submit.';
    return;
  }

  const correct = selectedSong.song_title === currentWordItem.song_title;

  if (correct){
    const pts = SCORE_BY_ATTEMPT[Math.min(attemptIndex, SCORE_BY_ATTEMPT.length-1)];
    game.rounds[game.roundIndex].score += pts;
    game.total += pts;
    updateScoreBubble();
    els.guessFeedback.innerHTML = `Correct - <b>${sanitizeText(currentWordItem.song_title)}</b> <span class="muted">(${sanitizeText(currentWordItem.album || '')})</span> (+${pts})`;
    flash(els.wordBox, 'success', 500);
    launchConfetti();

    // record item
    game.rounds[game.roundIndex].items.push({
      word: currentWordItem.word,
      song_title: currentWordItem.song_title,
      album: currentWordItem.album,
      cover_url: currentWordItem.cover_url,
      count_global: currentWordItem.count_global,
      correct: true,
      points: pts
    });

    wordResolved = true;
    updateAttemptsBadge();
    els.btnSubmit.disabled = true;
    els.btnNext.disabled = false;
    return;
  }

  // Wrong guess path
  attemptIndex += 1;
  updateAttemptsBadge();
  const remaining = Math.max(0, ATTEMPTS_MAX - attemptIndex);
  els.guessFeedback.textContent = remaining > 0 ? `Wrong. Attempts left: ${remaining}` : 'Out of attempts!';
  els.songSearch.classList.add('error');
  flash(els.wordBox, 'shake', 450);

  if (attemptIndex >= ATTEMPTS_MAX){
    // auto reveal and record zero points
    const curRound = game.rounds[game.roundIndex];
    if (!curRound.items.find(it => it.word === currentWordItem.word && it.song_title === currentWordItem.song_title)){
      curRound.items.push({
        word: currentWordItem.word,
        song_title: currentWordItem.song_title,
        album: currentWordItem.album,
        cover_url: currentWordItem.cover_url,
        count_global: currentWordItem.count_global,
        correct: false,
        points: 0
      });
    }
    els.guessFeedback.innerHTML = 'It was ' + '<b>' + sanitizeText(currentWordItem.song_title) + '</b>';
    wordResolved = true;
    updateAttemptsBadge();
    els.btnSubmit.disabled = true;
    els.btnNext.disabled = false;
  }
}

function nextStep(){
  if (game.wordIndex + 1 < WORDS_PER_ROUND){
    game.wordIndex += 1;
    showWord();
    return;
  }
  // Round complete
  showRoundSummary();
}

function showRoundSummary(){
  const r = game.roundIndex;
  els.roundSummaryTitle.textContent = `Round ${r+1} Complete`;
  els.roundSummaryDesc.textContent = `You scored ${game.rounds[r].score} points this round.`;
  els.roundBreakdown.innerHTML = '';
  game.rounds[r].items.forEach(it => {
    const div = document.createElement('div');
    // Handle both word-mode and audio-mode items
    if (it.word){
      div.innerHTML = `• <b>${sanitizeText(it.word)}</b> ? ${sanitizeText(it.song_title)} <span class="muted">(+${it.points})</span>`;
    } else {
      const t = it.time_ms != null ? ` @ ${formatMs(it.time_ms)}` : '';
      div.innerHTML = `• ${sanitizeText(it.song_title)} <span class="muted">(+${it.points}${t})</span>`;
    }
    els.roundBreakdown.appendChild(div);
  });
  els.roundSummary.classList.remove('hidden');
}

function closeRoundSummaryAndAdvance(){
  els.roundSummary.classList.add('hidden');
  if (game.roundIndex + 1 < ROUNDS_PER_GAME){
    game.roundIndex += 1;
    game.wordIndex = 0;
    if (game.mode === 'audio') {
      updateAudioRoundHeader();
      resetAudioUIForNextSong();
      audioState.song = null;
    } else {
      showWord();
    }
  } else {
    showGameOver();
  }
}

function showGameOver(){
  els.goRounds.innerHTML = '';
  let modeName = 'Rare Words';
  if (game.mode === 'super-rare') modeName = 'Super Rare Words';
  if (game.mode === 'audio') modeName = 'Guess the Song';
  const scopeName = 'Everything';
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
  const W = 1200, H = 628;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0, '#22c55e');
  g.addColorStop(.6, '#0ea5e9');
  g.addColorStop(1, '#0ea5e9');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  ctx.fillStyle = 'rgba(255,255,255,.95)';
  roundRect(ctx, 48, 48, W-96, H-96, 24, true, false);

  ctx.fillStyle = '#0e1116';
  ctx.font = '700 44px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  ctx.fillText('Morgan Wallen Trivia — Score', 76, 120);

  ctx.font = '400 24px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  let modeName = 'Rare Words';
  if (game.mode === 'super-rare') modeName = 'Super Rare Words';
  if (game.mode === 'audio') modeName = 'Guess the Song';
  const scopeName = 'Everything';
  ctx.fillStyle = '#374151';
  ctx.fillText(`${modeName} · ${scopeName}`, 76, 160);

  ctx.fillStyle = '#0e1116';
  ctx.font = '600 28px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  let y = 230;
  game.rounds.forEach((r, i)=>{ ctx.fillText(`Round ${i+1}: ${r.score} pts`, 76, y); y += 46; });

  ctx.font = '800 56px Segoe UI, system-ui, -apple-system, Roboto, Arial';
  ctx.fillText(`Total: ${game.total} pts`, 76, y + 24);

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
    img.src = sanitizeText(s.cover_url || '');
    img.alt = '';
    const span = document.createElement('div');
    span.className = 'songtitle';
    const t = sanitizeText(s.song_title);
    const a = sanitizeText(s.album || '');
    span.innerHTML = `<b>${t}</b> <span class="muted"> - ${a}</span>`;
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

// Text sanitizer
function sanitizeText(s){
  if (!s) return '';
  return String(s)
    .replace(/\uFFFD/g, '')                // remove replacement char
    .replace(/[\u2013\u2014]/g, '-')      // en/em dash -> hyphen
    .replace(/[\u2018\u2019]/g, "'")    // curly -> '
    .replace(/[\u201C\u201D]/g, '"')     // curly -> "
    .replace(/[\u00A0]/g, ' ')            // nbsp -> space
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // control chars
    .trim();
}

// ===== Wiring =====
function wireModeGate(){
  els.modeCards.forEach(card => {
    const btn = card.querySelector('.btn');
    const mode = card.getAttribute('data-mode');
    btn.addEventListener('click', ()=>{
      if (mode === 'audio'){
        startAudioMode();
      } else {
        startNewGame(mode);
      }
    });
  });
}

function wireGame(){
  // typing clears selection (word modes)
  els.songSearch.addEventListener('input', (e)=>{
    selectedSong = null;
    els.btnSubmit.disabled = true;
    els.songSearch.classList.remove('error');
    if (!currentWordItem) return;
    const list = filterSongs(e.target.value);
    renderResults(list, els.results, (s)=>{
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

  // Next
  els.btnNext.addEventListener('click', nextStep);

  // Round summary controls
  els.btnNextRound.addEventListener('click', closeRoundSummaryAndAdvance);

  // Game over controls
  els.btnPlayAgain.addEventListener('click', ()=>{ location.reload(); });
  els.btnDownloadImage.addEventListener('click', downloadScoreImage);

  // Audio mode wiring
  wireAudio();
}

function wireFiltersAndPersist(){
  if (els.scopeSelect){
    els.scopeSelect.addEventListener('change', rebuildSongIndex);
  }
  if (els.btnTogglePersist){
    els.btnTogglePersist.addEventListener('click', ()=>{
      persistence = persistence === 'local' ? 'session' : 'local';
      els.btnTogglePersist.textContent = persistence === 'local' ? 'Using Local Storage' : 'Use Local Storage';
    });
  }
}

// ===== Init =====
function init(){
  try {
    selectEls();
    wireModeGate();
    wireFiltersAndPersist();
    wireGame();
    updateScoreBubble();
    loadCSV().catch(err => console.error(err));
  } catch (e){
    console.error('Init error:', e);
  }
}
window.addEventListener('DOMContentLoaded', init);

// ===== Audio Mode (Spotify) =====
const SPOTIFY_CLIENT_ID = '01757ce8e3694d6ba472ecd373e28087'; // <-- set this
const SPOTIFY_REDIRECT_URI = location.origin + location.pathname; // also add in Spotify Dashboard
const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';

let spotifyToken = null;
let spotifyPlayer = null;
let spotifyDeviceId = null;

const audioState = {
  song: null,          // chosen song object from songs[]
  attempts: 0,
  timerId: null,       // interval for SDK polling
  done: false,
  selected: null,      // chosen guess
};

function startAudioMode(){
  currentMode = 'audio';
  els.modeGate.classList.add('hidden');
  els.gameUI.classList.remove('hidden');
  els.scoreBar.classList.remove('hidden');

  els.modeLabel.textContent = 'Guess the Song';
  els.gameTitle.textContent = 'Guess the Song';

  // Initialize game meta for audio mode
  game = {
    mode: 'audio',
    scope: 'all',
    roundIndex: 0,
    wordIndex: 0, // acts as song index per round
    rounds: Array.from({length: ROUNDS_PER_GAME}, ()=>({ score:0, items:[], picks:[] })),
    usedKeys: new Set(),
    total: 0,
  };

  // Pre-sample all rounds of songs based on full catalog (songs[] already built from ALL rows)
  for (let r = 0; r < ROUNDS_PER_GAME; r++){
    const picks = sampleAudioSongs(game.usedKeys);
    picks.forEach(p => game.usedKeys.add(p.track_spotify_id || p.song_title));
    game.rounds[r].picks = picks;
  }

  // Show audio card, hide word card
  els.gameCard.classList.add('hidden');
  els.audioUI.classList.remove('hidden');
  updateAudioRoundHeader();
  resetAudioUIForNextSong(true);
}

function sampleAudioSongs(excludeSet){
  // Use the current songs[] list (full catalog). Do NOT filter by album.
  const pool = songs.filter(s => !excludeSet.has(s.track_spotify_id || s.song_title));
  if (pool.length <= WORDS_PER_ROUND) return shuffle(pool.slice());
  const picks = [];
  const used = new Set();
  while (picks.length < WORDS_PER_ROUND && used.size < pool.length){
    const idx = Math.floor(Math.random()*pool.length);
    if (used.has(idx)) continue;
    used.add(idx);
    picks.push(pool[idx]);
  }
  return picks;
}

function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }

function updateAudioRoundHeader(){
  setRoundLabel(`Round ${game.roundIndex+1} of ${ROUNDS_PER_GAME}`);
  setWordLabel(`Song ${game.wordIndex+1} / ${WORDS_PER_ROUND}`);
}

function resetAudioUIForNextSong(initial=false){
  els.audioFeedback.textContent = '';
  els.audioSongSearch.value = '';
  els.audioResults.classList.add('hidden');
  els.btnAudioSubmit.disabled = true;
  els.audioAttemptsBadge.textContent = 'Attempts left: ' + ATTEMPTS_MAX;
  els.audioStatus.textContent = initial ? '' : 'Ready';
  updateAudioTimerDisplay(0);
  audioState.attempts = 0;
  audioState.selected = null;
  setStartButtonState('start');
  if (els.btnAudioNext) els.btnAudioNext.disabled = true;
}

// Score: 1000 at <=1s, then linear down to 0 at 60s
function scoreFromMs(ms){
  if (ms <= 1000) return 1000;
  if (ms >= 60000) return 0;
  const rem = 60000 - 1000; // 59s span
  const frac = 1 - ((ms - 1000) / rem);
  return Math.max(0, Math.round(1000 * frac));
}

// Timer uses actual playback position from the SDK, not wall-clock
async function startPlaybackAndPoll(song){
  try {
    await ensureSpotifyToken();
    await setupSpotifyPlayer();
    updateSpotifyConnectUI(true);
  } catch (e){
    els.audioStatus.textContent = 'Spotify connection failed. Premium required.';
    return false;
  }

  try {
    await transferAndPlay(song.track_spotify_id);
  } catch (e){
    els.audioStatus.textContent = 'Could not start playback.';
    return false;
  }

  // Wait until the SDK reports playing state
  await waitUntilPlaying(song.track_spotify_id, 5000);
  els.audioStatus.textContent = 'Playing...';

  // Begin polling SDK position
  startPositionPolling();
  setStartButtonState('pause');
  return true;
}

function startPositionPolling(){
  stopPositionPolling();
  els.audioTimer.textContent = '0:00.0';
  audioState.timerId = setInterval(updateTimerFromSDK, 150);
  updateTimerFromSDK();
}

function stopPositionPolling(){
  if (audioState.timerId){ clearInterval(audioState.timerId); audioState.timerId = null; }
}

async function updateTimerFromSDK(){
  const pos = await getCurrentPlaybackPositionMs();
  if (pos != null) updateAudioTimerDisplay(pos);
}

function updateAudioTimerDisplay(ms){
  els.audioTimer.textContent = formatMs(ms);
}

async function waitUntilPlaying(expectedTrackId, timeoutMs){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    const st = await spotifyPlayer.getCurrentState();
    if (st && !st.paused && st.position != null){
      return true;
    }
    await new Promise(r=>setTimeout(r, 150));
  }
  return false;
}

async function getCurrentPlaybackPositionMs(){
  if (!spotifyPlayer) return null;
  const st = await spotifyPlayer.getCurrentState();
  if (!st) return null;
  return st.position || 0;
}

function pauseAudioForGuess(){
  if (!spotifyToken || !spotifyDeviceId) return;
  fetch('https://api.spotify.com/v1/me/player/pause', { method:'PUT', headers:{ 'Authorization':'Bearer '+spotifyToken } });
  els.audioStatus.textContent = 'Paused';
  setStartButtonState('play');
}

function resumeAudio(){
  if (!spotifyToken || !spotifyDeviceId) return;
  // Resume current playback without resetting to 0 — no URIs or position sent.
  fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`, {
    method:'PUT',
    headers:{ 'Authorization':'Bearer '+spotifyToken }
  });
  els.audioStatus.textContent = 'Playing...';
  setStartButtonState('pause');
}

function stopAudio(){
  stopPositionPolling();
  if (spotifyToken){
    fetch('https://api.spotify.com/v1/me/player/pause', { method:'PUT', headers:{ 'Authorization':'Bearer '+spotifyToken } });
  }
}

function getFrozenMsForScoring(){
  // read once from SDK (position is frozen because we pause on input)
  return getCurrentPlaybackPositionMs();
}

function setStartButtonState(state){
  if (!els.btnAudioStart) return;
  if (state === 'pause') els.btnAudioStart.textContent = 'Pause';
  else if (state === 'play') els.btnAudioStart.textContent = 'Play';
  else els.btnAudioStart.textContent = 'Start';
}

function setRoundLabel(text) {
  document.querySelectorAll('#roundLabel').forEach(el => { el.textContent = text; });
}
function setWordLabel(text) {
  document.querySelectorAll('#wordLabel').forEach(el => { el.textContent = text; });
}

function submitAudioGuess(){
  if (audioState.done) return;
  if (!audioState.selected){ els.audioFeedback.textContent = 'Pick a song, then Submit.'; return; }
  const correct = audioState.selected.song_title === audioState.song.song_title;
  (async()=>{
    const ms = await getFrozenMsForScoring() || 0;
    let pts = 0;
    if (correct){
      pts = scoreFromMs(ms);
      audioState.done = true;
      stopAudio();
      els.audioFeedback.textContent = 'Correct - ' + sanitizeText(audioState.song.song_title) + ' at ' + formatMs(ms) + ` (+${pts})`;
      launchConfetti();
      setStartButtonState('play');
    } else {
      audioState.attempts += 1;
      const left = Math.max(0, ATTEMPTS_MAX - audioState.attempts);
      els.audioAttemptsBadge.textContent = 'Attempts left: ' + left;
      if (audioState.attempts >= ATTEMPTS_MAX){
        audioState.done = true;
        stopAudio();
        els.audioFeedback.textContent = 'Out of attempts. It was ' + sanitizeText(audioState.song.song_title);
        setStartButtonState('play');
      } else {
        els.audioFeedback.textContent = 'Wrong - resuming...';
        resumeAudio();
        return; // don't record yet
      }
    }

    // Record item to round
    const r = game.roundIndex;
    const round = game.rounds[r];
    round.items.push({ song_title: audioState.song.song_title, album: audioState.song.album, cover_url: audioState.song.cover_url, time_ms: ms, correct, points: pts });
    round.score += pts;
    game.total += pts;
    updateScoreBubble();

    // Enable Next
    if (els.btnAudioNext) els.btnAudioNext.disabled = false;
  })();
}

async function handleAudioStart(){
  const r = game.roundIndex;
  const idx = game.wordIndex;
  const picks = game.rounds[r].picks;
  if (!picks || !picks.length){ els.audioFeedback.textContent = 'No songs available for this scope.'; return; }
  const song = picks[idx];

  // If no song started yet for this index, start it
  if (!audioState.song || (audioState.song.track_spotify_id !== song.track_spotify_id)){
    audioState.song = song;
    audioState.done = false;
    audioState.attempts = 0;
    els.audioAttemptsBadge.textContent = 'Attempts left: ' + ATTEMPTS_MAX;
    els.audioFeedback.textContent = '';
    els.btnAudioSubmit.disabled = true;
    const ok = await startPlaybackAndPoll(song);
    if (!ok) return;
    return;
  }

  // Otherwise toggle play/pause based on current player state
  const st = await (spotifyPlayer ? spotifyPlayer.getCurrentState() : null);
  if (st && !st.paused){
    pauseAudioForGuess();
  } else {
    resumeAudio();
  }
}

function nextAudio(){
  // advance song index or show round summary
  if (game.wordIndex + 1 < WORDS_PER_ROUND){
    game.wordIndex += 1;
    updateAudioRoundHeader();
    resetAudioUIForNextSong();
    audioState.song = null; // force new song start on next press
  } else {
    // Round finished
    stopAudio();
    showRoundSummary();
  }
}

// ===== Audio wiring (UI) =====
function wireAudio(){
  // Connect / auth
  els.btnSpotifyConnect.addEventListener('click', beginSpotifyLogin);
  // Start/Play-Pause toggle
  els.btnAudioStart.addEventListener('click', handleAudioStart);
  // Next song
  if (els.btnAudioNext){ els.btnAudioNext.addEventListener('click', ()=>{ if (!els.btnAudioNext.disabled){ els.btnAudioNext.disabled = true; nextAudio(); } }); }

  // Search interactions
  els.audioSongSearch.addEventListener('input', (e)=>{
    pauseAudioForGuess();
    audioState.selected = null;
    els.btnAudioSubmit.disabled = true;
    const list = filterSongs(e.target.value);
    renderResults(list, els.audioResults, (s)=>{
      audioState.selected = s;
      els.audioSongSearch.value = s.song_title;
      els.audioResults.classList.add('hidden');
      els.btnAudioSubmit.disabled = false;
    });
  });
  els.audioSongSearch.addEventListener('focus', ()=>{
    pauseAudioForGuess();
    const list = filterSongs(els.audioSongSearch.value);
    renderResults(list, els.audioResults, (s)=>{
      audioState.selected = s;
      els.audioSongSearch.value = s.song_title;
      els.audioResults.classList.add('hidden');
      els.btnAudioSubmit.disabled = false;
    });
  });
  document.addEventListener('click', (e)=>{
    if (!els.audioResults.contains(e.target) && e.target !== els.audioSongSearch) els.audioResults.classList.add('hidden');
  });

  els.btnAudioSubmit.addEventListener('click', submitAudioGuess);
  els.audioSongSearch.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); submitAudioGuess(); }});
}

// ===== Spotify Auth / SDK =====
function updateSpotifyConnectUI(connected){
  if (!els.btnSpotifyConnect) return;
  if (connected){
    els.btnSpotifyConnect.textContent = 'Spotify Connected';
    els.btnSpotifyConnect.classList.add('success');
    els.btnSpotifyConnect.disabled = true;
  } else {
    els.btnSpotifyConnect.textContent = 'Connect Spotify';
    els.btnSpotifyConnect.classList.remove('success');
    els.btnSpotifyConnect.disabled = false;
  }
}

async function ensureSpotifyToken(){
  const st = sessionStorage.getItem('mw_spotify_token');
  if (st){ spotifyToken = st; updateSpotifyConnectUI(true); return; }
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code && sessionStorage.getItem('spotify_code_verifier')){
    await exchangeSpotifyCode(code);
    params.delete('code'); params.delete('state');
    history.replaceState({}, '', `${location.pathname}${params.toString() ? ('?'+params.toString()) : ''}`);
    updateSpotifyConnectUI(true);
    return;
  }
  updateSpotifyConnectUI(false);
  throw new Error('No token');
}

async function beginSpotifyLogin(){
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('spotify_code_verifier', verifier);
  const state = Math.random().toString(36).slice(2);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
  url.searchParams.set('scope', SPOTIFY_SCOPES);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  location.assign(url.toString());
}

async function exchangeSpotifyCode(code){
  const verifier = sessionStorage.getItem('spotify_code_verifier');
  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: verifier
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!res.ok) throw new Error('Token exchange failed');
  const json = await res.json();
  spotifyToken = json.access_token;
  sessionStorage.setItem('mw_spotify_token', spotifyToken);
}

function generateCodeVerifier(){
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let out = '';
  for (let i=0;i<64;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}
async function generateCodeChallenge(verifier){
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return b64;
}

async function setupSpotifyPlayer(){
  if (spotifyPlayer && spotifyDeviceId) return; // already ready
  await new Promise((resolve)=>{
    if (window.Spotify) return resolve();
    const iv = setInterval(()=>{ if (window.Spotify){ clearInterval(iv); resolve(); } }, 100);
  });
  if (!spotifyPlayer){
    spotifyPlayer = new Spotify.Player({
      name: 'MW Trivia Player',
      getOAuthToken: cb => { cb(spotifyToken); },
      volume: 0.8
    });
    spotifyPlayer.addListener('ready', ({ device_id }) => { spotifyDeviceId = device_id; updateSpotifyConnectUI(true); });
    spotifyPlayer.addListener('initialization_error', ({message}) => { console.error(message); });
    spotifyPlayer.addListener('authentication_error', ({message}) => { console.error(message); updateSpotifyConnectUI(false); });
    spotifyPlayer.addListener('account_error', ({message}) => { console.error(message); });
    await spotifyPlayer.connect();
  }
}

async function transferAndPlay(trackId){
  await fetch('https://api.spotify.com/v1/me/player', {
    method:'PUT',
    headers:{ 'Authorization':'Bearer '+spotifyToken, 'Content-Type':'application/json' },
    body: JSON.stringify({ device_ids: [spotifyDeviceId], play: true })
  });
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}` ,{
    method:'PUT',
    headers:{ 'Authorization':'Bearer '+spotifyToken, 'Content-Type':'application/json' },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: 0 })
  });
}

// ===== Utilities =====
function formatMs(ms){
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const r = s % 60;
  const tenths = Math.floor((ms%1000)/100);
  return `${m}:${String(r).padStart(2,'0')}.${tenths}`;
}
