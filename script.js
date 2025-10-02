// tiny tilt for the active nav tab
const tilt = (Math.random() * 8 - 4).toFixed(2) + 'deg';
document.documentElement.style.setProperty('--active-tilt', tilt);

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('home')) return;

// ===== tracks =====
  const SONGS = [
    "https://open.spotify.com/track/2QqDNk4meN58jBmUn0EBUi",
    "https://open.spotify.com/track/2TugrDKkd55mfVOMVZsfO8",
    "https://open.spotify.com/track/6QanbknK7HJMOaUqlNCxhz",
    "https://open.spotify.com/track/25ywKtUww26ABFd0tiGt9D",
    "https://open.spotify.com/track/47ojH5LeQhl1ZltSAHBEFF",
    "https://open.spotify.com/track/3RmFPuTTAjSQ2pbEd2j9oA",
    "https://open.spotify.com/track/0oBAbUchoN02dIccY8oZh6",
  ];

  const toId = (s) => {
    if (!s) return null;
    if (s.startsWith('spotify:track:')) return s.split(':').pop();
    if (s.includes('/track/')) return s.split('/track/')[1].split('?')[0].split('/')[0];
    return s; // assume raw ID
  };

  const ids = SONGS.map(toId).filter(Boolean);
  if (!ids.length) return;

  // DOM mount
  const mount = document.querySelector('#vinyl-player') || document.querySelector('main') || document.body;

  // Build player shell
  mount.innerHTML = `
    <div class="turntable">
      <div class="plinth">
        <div class="record-wrap">
          <div class="record">
            <div class="grooves"></div>
            <div class="label"></div>
            <div class="spindle"></div>
          </div>
          <div class="tonearm">
            <div class="headshell"></div>
          </div>
        </div>
        <div class="controls">
          <button class="vt-btn prev" aria-label="Previous">‹</button>
          <button class="vt-btn play" aria-label="Play/Pause">Play</button>
          <button class="vt-btn next" aria-label="Next">›</button>
        </div>
        <div class="track-meta">
          <div class="t-title">Loading…</div>
          <div class="t-artist"></div>
        </div>
      </div>
    </div>

    <div class="vinyl-modal" hidden>
      <div class="vinyl-modal-backdrop"></div>
      <div class="vinyl-modal-card">
        <button class="modal-close" aria-label="Close">✕</button>
        <iframe class="vinyl-embed" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
      </div>
    </div>
  `;

  const el = {
    record: mount.querySelector('.record'),
    label: mount.querySelector('.label'),
    tonearm: mount.querySelector('.tonearm'),
    title: mount.querySelector('.t-title'),
    artist: mount.querySelector('.t-artist'),
    btnPrev: mount.querySelector('.prev'),
    btnPlay: mount.querySelector('.play'),
    btnNext: mount.querySelector('.next'),
    modal: mount.querySelector('.vinyl-modal'),
    modalCard: mount.querySelector('.vinyl-modal-card'),
    modalClose: mount.querySelector('.modal-close'),
    embed: mount.querySelector('.vinyl-embed'),
    backdrop: mount.querySelector('.vinyl-modal-backdrop'),
  };

  let i = 0;
  let playing = false;

  // Cache of metadata: { id, title, author, thumb }
  const cache = new Map();

  function oembedUrl(trackId) {
    return `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${trackId}`)}`;
  }

  async function getMeta(trackId) {
    if (cache.has(trackId)) return cache.get(trackId);
    try {
      const res = await fetch(oembedUrl(trackId));
      const data = await res.json();
      const meta = {
        id: trackId,
        title: data.title || 'Unknown title',
        author: data.author_name || '',
        thumb: data.thumbnail_url || '',
      };
      cache.set(trackId, meta);
      return meta;
    } catch {
      const meta = { id: trackId, title: 'Unknown title', author: '', thumb: '' };
      cache.set(trackId, meta);
      return meta;
    }
  }

  function setEmbed(trackId) {
    el.embed.src = `https://open.spotify.com/embed/track/${trackId}?utm_source=generator`;
  }

  async function render(index) {
    const id = ids[index];
    const meta = await getMeta(id);

    // Update label art + meta
    if (meta.thumb) {
      el.label.style.backgroundImage = `url("${meta.thumb}")`;
    } else {
      el.label.style.backgroundImage = 'none';
    }
    el.title.textContent = meta.title;
    el.artist.textContent = meta.author;

    // Point modal to current track
    setEmbed(id);

    // Stop spin when switching
    playing = false;
    el.record.classList.remove('spin');
    el.tonearm.classList.remove('on-record');
    el.btnPlay.textContent = 'Play';
  }

  function openModal() {
    el.modal.hidden = false;
    // begin “spin” animation immediately for vibes; user still hits play in iframe
    playing = true;
    el.record.classList.add('spin');
    el.tonearm.classList.add('on-record');
    el.btnPlay.textContent = 'Pause';
    // focus the iframe for accessibility
    setTimeout(() => el.embed?.focus?.(), 0);
  }

  function closeModal() {
    el.modal.hidden = true;
    // pause vibes unless you want it to keep spinning
    playing = false;
    el.record.classList.remove('spin');
    el.tonearm.classList.remove('on-record');
    el.btnPlay.textContent = 'Play';
    // stop iframe to avoid background audio
    el.embed.src = el.embed.src; // reload clears playback
  }

  // Controls
  el.btnPrev.addEventListener('click', () => {
    i = (i - 1 + ids.length) % ids.length;
    render(i);
  });

  el.btnNext.addEventListener('click', () => {
    i = (i + 1) % ids.length;
    render(i);
  });

  el.btnPlay.addEventListener('click', () => {
    if (el.modal.hidden) {
      openModal();
    } else {
      closeModal();
    }
  });

  el.modalClose.addEventListener('click', closeModal);
  el.backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
    if (e.key === 'ArrowLeft')  el.btnPrev.click();
    if (e.key === 'ArrowRight') el.btnNext.click();
  });

  // Initialize
  render(i);
});
