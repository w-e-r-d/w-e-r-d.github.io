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

  // ===== mount vinyl player =====
  const main = document.querySelector('main') || document.body;
  let mount = document.querySelector('#vinyl-player');
  if (!mount) {
    mount = document.createElement('section');
    mount.id = 'vinyl-player';
    main.appendChild(mount);
  }

  mount.innerHTML = `
    <div class="turntable">
      <div class="plinth" style="position:relative;">
        <div class="record-wrap">
          <div class="record" aria-hidden="true">
            <div class="grooves"></div>
            <div class="label"></div>
            <div class="spindle"></div>
          </div>
          <div class="tonearm" aria-hidden="true">
            <div class="headshell"></div>
          </div>
        </div>

        <div class="controls">
          <button class="vt-btn prev" aria-label="Previous">‹</button>
          <button class="vt-btn play" aria-label="Play/Pause">Play</button>
          <button class="vt-btn next" aria-label="Next">›</button>
        </div>

        <div class="track-meta">
          <a class="t-title" target="_blank" rel="noopener">Loading…</a>
          <div class="t-artist"></div>
        </div>

        <!-- compact embed tucked in bottom-right like a little screen -->
        <div class="mini-embed"
             style="
               position:absolute;
               right:12px; bottom:12px;
               width:280px; height:152px;
               border:2px solid var(--black);
               border-radius:12px;
               overflow:hidden;
               box-shadow:4px 4px 0 var(--black);
               background:#000;
             ">
          <iframe class="spotify-mini"
                  title="Spotify preview"
                  style="width:100%; height:100%; border:0; display:block;"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"></iframe>
        </div>
      </div>
    </div>
  `;

  const el = {
    record: mount.querySelector('.record'),
    label: mount.querySelector('.label'),
    tonearm: mount.querySelector('.tonearm'),
    titleLink: mount.querySelector('.t-title'),
    artist: mount.querySelector('.t-artist'),
    btnPrev: mount.querySelector('.prev'),
    btnPlay: mount.querySelector('.play'),
    btnNext: mount.querySelector('.next'),
    mini: mount.querySelector('.spotify-mini'),
  };

  let i = 0;
  let spinning = false;

  // ===== simple oEmbed fetch for title/artist/thumb =====
  const cache = new Map();
  const trackUrl = (id) => `https://open.spotify.com/track/${id}`;
  const oembedUrl = (id) => `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl(id))}`;

  async function getMeta(id) {
    if (cache.has(id)) return cache.get(id);
    try {
      const res = await fetch(oembedUrl(id));
      const data = await res.json();
      const meta = {
        id,
        title: data.title || 'Unknown title',
        author: data.author_name || '',
        thumb: data.thumbnail_url || '',
        url: trackUrl(id),
      };
      cache.set(id, meta);
      return meta;
    } catch {
      const meta = { id, title: 'Unknown title', author: '', thumb: '', url: trackUrl(id) };
      cache.set(id, meta);
      return meta;
    }
  }

  function setMiniEmbed(id) {
    // compact embed = same URL, but the iframe height makes it compact (152px)
    el.mini.src = `https://open.spotify.com/embed/track/${id}?utm_source=generator`;
  }

  async function render(index) {
    const id = ids[index];
    const meta = await getMeta(id);

    // update label + meta
    if (meta.thumb) {
      el.label.style.backgroundImage = `url("${meta.thumb}")`;
      el.label.style.backgroundSize = 'cover';
      el.label.style.backgroundPosition = 'center';
    } else {
      el.label.style.backgroundImage = 'none';
    }
    el.titleLink.textContent = meta.title;
    el.titleLink.href = meta.url;
    el.artist.textContent = meta.author;

    // point compact embed to current track (resets any playing preview)
    setMiniEmbed(id);

    // stop spin when switching
    spinning = false;
    el.record.classList.remove('spin');
    el.tonearm.classList.remove('on-record');
    el.btnPlay.textContent = 'Play';
  }

  function toggleSpin() {
    spinning = !spinning;
    if (spinning) {
      el.record.classList.add('spin');
      el.tonearm.classList.add('on-record');
      el.btnPlay.textContent = 'Pause';

      // Try to give focus to the mini player so the user can press Space/Enter there
      // (We can’t programmatically click play due to cross-origin/autoplay rules)
      el.mini?.focus?.();
    } else {
      el.record.classList.remove('spin');
      el.tonearm.classList.remove('on-record');
      el.btnPlay.textContent = 'Play';

      // "Pause" the preview by reloading the iframe (quick + reliable)
      // (Optional) comment out if you want the preview to keep going:
      el.mini.src = el.mini.src;
    }
  }

  // ===== controls =====
  el.btnPrev.addEventListener('click', () => {
    i = (i - 1 + ids.length) % ids.length;
    render(i);
  });
  el.btnNext.addEventListener('click', () => {
    i = (i + 1) % ids.length;
    render(i);
  });
  el.btnPlay.addEventListener('click', toggleSpin);

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  el.btnPrev.click();
    if (e.key === 'ArrowRight') el.btnNext.click();
    if (e.code === 'Space') { e.preventDefault(); toggleSpin(); }
  });

  // init
  render(i);
});
