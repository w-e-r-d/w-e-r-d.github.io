// ===== Config =====
const CSV_URL = './data/mw_words_rare.csv'; // place your CSV here
const SPOTIFY_CLIENT_ID = 'b0969ab732d74d4b86f84ed01ac31199'; // optional: fill to enable Connect Spotify
const SPOTIFY_SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-modify-playback-state', 'user-read-playback-state'
];

// ===== State =====
let persistence = 'session'; // or 'local'
let dataRows = [];
let songs = [];
let currentRare = null;
let spotifyToken = null;
let spotifyDeviceId = null;
let audioStartAt = 0;
let currentAudioTrack = null;

const els = {};

function q(id) { return document.getElementById(id); }

function selectEls() {
  const ids = [
    'scopeSelect','chkRandomStart','wordSpan','countInSong','countGlobal','songSearch','results','guessFeedback',
    'btnNewRare','btnReveal','btnStartAudio','btnPauseAudio','btnResumeAudio','songSearchAudio','resultsAudio','audioFeedback',
    'bestRare','bestAudio','attempts','rowCount','songCount','status','btnTogglePersist','btnConnectSpotify','errorBox'
  ];
  ids.forEach(k => els[k] = q(k));
  els.tabs = document.querySelectorAll('.tab');
  els.rarePanel = q('rarePanel');
  els.audioPanel = q('audioPanel');
}

// ===== Storage =====
function storage() { return persistence === 'local' ? localStorage : sessionStorage; }
function getScore(key, def=null) { try { return JSON.parse(storage().getItem('mwtrivia_' + key)) ?? def; } catch { return def; } }
function setScore(key, val) { storage().setItem('mwtrivia_' + key, JSON.stringify(val)); }
function updateScoreUI() {
  const rare = getScore('rare_best', 0) || 0;
  const audio = getScore('audio_best_ms', null);
  const attempts = getScore('attempts', 0) || 0;
  els.bestRare.textContent = rare;
  els.bestAudio.textContent = audio == null ? '—' : audio;
  els.attempts.textContent = attempts;
}

// ===== CSV Loading =====
async function loadCSV() {
  els.status.textContent = 'Fetching CSV…';
  els.errorBox.classList.add('hidden');
  try {
    const res = await fetch(CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
    if (parsed.errors && parsed.errors.length) {
      console.warn(parsed.errors.slice(0,3));
    }

    // Validate headers
    const required = ['song_title','album','release_type','is_album','is_feature','track_spotify_id','cover_url','word','count_in_song','count_global'];
    const headers = parsed.meta.fields || [];
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) {
      throw new Error('Missing columns: ' + missing.join(', '));
    }

    // Normalize types
    dataRows = parsed.data.map(r => ({
      song_title: r.song_title,
      album: r.album,
      release_type: r.release_type,
      is_album: (String(r.is_album).toLowerCase() === 'true' || String(r.is_album) === '1'),
      is_feature: (String(r.is_feature).toLowerCase() === 'true' || String(r.is_feature) === '1'),
      track_spotify_id: r.track_spotify_id,
      cover_url: r.cover_url,
      word: r.word,
      count_in_song: parseInt(r.count_in_song, 10) || 0,
      count_global: parseInt(r.count_global, 10) || 0,
    }));

    els.rowCount.textContent = String(dataRows.length);
    rebuildSongIndex();
    els.status.textContent = 'Ready';
    pickRareWord();
  } catch (e) {
    console.error(e);
    els.status.textContent = 'Error';
    els.errorBox.textContent = e.message;
    els.errorBox.classList.remove('hidden');
  }
}

function rebuildSongIndex() {
  const scope = els.scopeSelect.value; // 'albums' | 'all'
  const map = new Map();
  for (const r of dataRows) {
    if (scope === 'albums' && !r.is_album) continue;
    const key = r.track_spotify_id || r.song_title;
    if (!map.has(key)) {
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
  els.songCount.textContent = String(songs.length);
}

function pickRareWord() {
  const scope = els.scopeSelect.value;
  const pool = dataRows.filter(r => (scope === 'all' || r.is_album) && r.word && r.count_in_song > 0);
  if (!pool.length) { currentRare = null; els.wordSpan.textContent = '—'; return; }
  // Weighted by rarity: 1 / count_global
  const weights = pool.map(r => 1 / Math.max(1, r.count_global));
  const total = weights.reduce((a,b)=>a+b,0);
  let pick = Math.random()*total;
  let chosen = pool[0];
  for (let i=0;i<pool.length;i++) { pick -= weights[i]; if (pick <= 0) { chosen = pool[i]; break; } }
  currentRare = chosen;
  els.wordSpan.textContent = chosen.word;
  els.countInSong.textContent = String(chosen.count_in_song);
  els.countGlobal.textContent = String(chosen.count_global);
  els.guessFeedback.textContent = '';
  els.songSearch.value = '';
  hideResults();
}

function hideResults() { els.results.classList.add('hidden'); els.results.innerHTML = ''; }
function hideResultsAudio() { els.resultsAudio.classList.add('hidden'); els.resultsAudio.innerHTML = ''; }

function renderResults(list, intoEl, onPick) {
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

function filterSongs(query) {
  const q = (query||'').trim().toLowerCase();
  if (!q) return [];
  return songs.filter(s => (s.song_title + ' ' + (s.album||'')).toLowerCase().includes(q)).slice(0, 20);
}

function wireRareMode() {
  els.songSearch.addEventListener('input', (e)=>{
    if (!currentRare) return;
    const list = filterSongs(e.target.value);
    renderResults(list, els.results, (s)=>{
      els.songSearch.value = s.song_title;
      hideResults();
      const correct = s.song_title === currentRare.song_title;
      const attempts = (getScore('attempts', 0) || 0) + 1;
      setScore('attempts', attempts);
      if (correct) {
        els.guessFeedback.innerHTML = `✅ Correct — <b>${currentRare.song_title}</b> <span class="muted">(${currentRare.album||''})</span>`;
        const pts = Math.max(50, Math.round(1000 / Math.max(1, currentRare.count_global)));
        const best = getScore('rare_best', 0) || 0;
        if (pts > best) setScore('rare_best', pts);
        updateScoreUI();
      } else {
        els.guessFeedback.textContent = '❌ Not that one. Try again!';
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
    els.guessFeedback.innerHTML = `🎯 It was <b>${currentRare.song_title}</b>`;
  });
}

// ===== Tabs & Filters =====
function wireTabsAndFilters() {
  els.tabs.forEach(t => t.addEventListener('click', () => {
    els.tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const mode = t.dataset.mode;
    if (mode === 'rare') { els.rarePanel.classList.remove('hidden'); els.audioPanel.classList.add('hidden'); }
    else { els.audioPanel.classList.remove('hidden'); els.rarePanel.classList.add('hidden'); }
  }));
  els.scopeSelect.addEventListener('change', ()=>{ rebuildSongIndex(); if (currentRare) pickRareWord(); });
}

// ===== Persistence toggle =====
function wirePersistenceToggle() {
  els.btnTogglePersist.addEventListener('click', ()=>{
    persistence = persistence === 'local' ? 'session' : 'local';
    els.btnTogglePersist.textContent = persistence === 'local' ? 'Using Local Storage' : 'Use Local Storage';
    updateScoreUI();
  });
}

// ===== Spotify (optional) =====
function authUrl() {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'token',
    redirect_uri: window.location.origin + window.location.pathname,
    scope: SPOTIFY_SCOPES.join(' '),
    show_dialog: 'true'
  });
  return 'https://accounts.spotify.com/authorize?' + params.toString();
}
function extractTokenFromHash() {
  if (window.location.hash.includes('access_token')) {
    const h = new URLSearchParams(window.location.hash.slice(1));
    spotifyToken = h.get('access_token');
    history.replaceState(null, '', window.location.pathname); // clean URL
  }
}
async function ensurePlayer() {
  if (!spotifyToken || !window.Spotify) return false;
  if (window._player) return true;
  return new Promise((resolve) => {
    window._player = new Spotify.Player({ name: 'MW Trivia Player', getOAuthToken: cb => cb(spotifyToken), volume: 1.0 });
    window._player.addListener('ready', ({ device_id }) => { spotifyDeviceId = device_id; resolve(true); });
    window._player.addListener('not_ready', ({ device_id }) => { console.warn('Device offline', device_id); });
    window._player.addListener('initialization_error', ({ message }) => console.error(message));
    window._player.addListener('authentication_error', ({ message }) => console.error(message));
    window._player.addListener('account_error', ({ message }) => console.error(message));
    window._player.connect();
  });
}
async function transferPlayback() {
  if (!spotifyToken || !spotifyDeviceId) return;
  await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT', headers: { 'Authorization': 'Bearer ' + spotifyToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [spotifyDeviceId], play: true })
  });
}
async function playTrack(trackId, positionMs = 0) {
  if (!spotifyToken || !spotifyDeviceId) throw new Error('No Spotify token or device');
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
    method: 'PUT', headers: { 'Authorization': 'Bearer ' + spotifyToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: positionMs })
  });
}
async function pausePlayback() {
  if (!spotifyToken) return; await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': 'Bearer ' + spotifyToken } });
}
async function resumePlayback() {
  if (!spotifyToken) return; await fetch('https://api.spotify.com/v1/me/player/play', { method: 'PUT', headers: { 'Authorization': 'Bearer ' + spotifyToken } });
}

function wireSpotify() {
  els.btnConnectSpotify.addEventListener('click', ()=>{ window.location.href = authUrl(); });
  q('btnStartAudio').addEventListener('click', async ()=>{
    if (!songs.length) { els.audioFeedback.textContent = 'Dataset not loaded yet.'; return; }
    extractTokenFromHash();
    const ok = await ensurePlayer();
    if (!ok) { els.audioFeedback.textContent = 'Spotify SDK not ready or no token (Premium required).'; return; }
    await transferPlayback();
    const scopeSongs = songs.filter(s => !!s.track_spotify_id);
    const s = scopeSongs[Math.floor(Math.random()*scopeSongs.length)];
    currentAudioTrack = s;
    const randomize = els.chkRandomStart.checked;
    const startMs = randomize ? Math.floor(Math.random()*90000) : 0;
    try {
      await playTrack(s.track_spotify_id, startMs);
      audioStartAt = performance.now();
      els.audioFeedback.textContent = 'Playing…';
    } catch (e) {
      console.error(e); els.audioFeedback.textContent = 'Playback failed. Check Premium, token, and device transfer.';
    }
  });
  q('btnPauseAudio').addEventListener('click', ()=> pausePlayback());
  q('btnResumeAudio').addEventListener('click', ()=> resumePlayback());

  els.songSearchAudio.addEventListener('focus', async ()=>{ if (!spotifyToken) return; await pausePlayback(); });
  els.songSearchAudio.addEventListener('input', ()=>{
    const list = filterSongs(els.songSearchAudio.value);
    renderResults(list, els.resultsAudio, async (s)=>{
      els.songSearchAudio.value = s.song_title;
      hideResultsAudio();
      if (!currentAudioTrack) return;
      const elapsed = Math.max(0, Math.round(performance.now() - audioStartAt));
      if (s.song_title === currentAudioTrack.song_title) {
        const best = getScore('audio_best_ms', null);
        if (best == null || elapsed < best) setScore('audio_best_ms', elapsed);
        els.audioFeedback.textContent = `✅ Correct in ${elapsed} ms — ${currentAudioTrack.song_title}`;
        updateScoreUI();
      } else {
        els.audioFeedback.textContent = '❌ Nope — resuming…';
        await resumePlayback();
      }
    });
  });
  els.songSearchAudio.addEventListener('focus', ()=>{ const list = filterSongs(els.songSearchAudio.value); renderResults(list, els.resultsAudio, ()=>{}); });
}

// ===== Init =====
function init() {
  selectEls();
  updateScoreUI();
  wireTabsAndFilters();
  wirePersistenceToggle();
  wireRareMode();
  wireSpotify();
  loadCSV();
}

window.addEventListener('DOMContentLoaded', init);
```

---

## Data placement

Place your generated CSV at:

```
/mwtrivia/data/mw_words_rare.csv
```

Recommended for performance: export a filtered CSV (e.g., `count_global <= 3` or `<= 5`) so the page loads fast. Ensure **headers exactly match**:

```
song_title,album,release_type,is_album,is_feature,track_spotify_id,cover_url,word,count_in_song,count_global
```

Booleans can be `true/false` or `1/0`.

---

## Deploy steps (GitHub Pages)

1. In your site repo, create the `/mwtrivia/` folder and subfolders as shown.
2. Add the three files above and your CSV to `/data/`.
3. Commit + push. Your page will be at `https://drewlefebvre.com/mwtrivia/`.
4. (Optional) Spotify playback: create a Spotify app, add Redirect URI `https://drewlefebvre.com/mwtrivia/`, then set `SPOTIFY_CLIENT_ID` in `js/app.js`.
5. Hard-refresh the page (Ctrl/Cmd+Shift+R) to bypass cache when updating CSV.
