// tiny tilt for the active nav tab
const tilt = (Math.random() * 8 - 4).toFixed(2) + 'deg';
document.documentElement.style.setProperty('--active-tilt', tilt);

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('home')) return;

  // ===== your tracks =====
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

  // ===== build boombox shell =====
  const mount = document.querySelector('#boombox-player') || document.querySelector('main') || document.body;
  mount.innerHTML = `
    <div class="boombox">
      <div class="bb-handle" aria-hidden="true"></div>

      <div class="bb-face">
        <div class="bb-speaker left">
          <div class="cone"></div>
        </div>

        <div class="bb-center">
          <div class="bb-brand">drew.</div>

          <div class="bb-screen">
            <iframe class="bb-spotify"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"></iframe>
          </div>

          <div class="bb-controls">
            <button class="bb-btn prev" aria-label="Previous">‹</button>
            <button class="bb-btn play" aria-label="Play/Pause">Play</button>
            <button class="bb-btn next" aria-label="Next">›</button>
          </div>

          <div class="bb-meta">
            <a class="bb-title" target="_blank" rel="noopener">Loading…</a>
            <div class="bb-artist"></div>
          </div>

          <div class="bb-vu">
            <span></span><span></span><span></span><span></span>
          </div>
        </div>

        <div class="bb-speaker right">
          <div class="cone"></div>
        </div>
      </div>

      <div class="bb-feet" aria-hidden="true"></div>
    </div>
  `;

  // ===== refs =====
  const el = {
    frame: mount.querySelector('.bb-spotify'),
    btnPrev: mount.querySelector('.prev'),
    btnPlay: mount.querySelector('.play'),
    btnNext: mount.querySelector('.next'),
    title:   mount.querySelector('.bb-title'),
    artist:  mount.querySelector('.bb-artist'),
    vuBars:  Array.from(mount.querySelectorAll('.bb-vu span')),
  };

  let i = 0;
  let spinning = false; // just for the fake VU/Play button label

  // ===== metadata via oEmbed (title/artist/thumbnail link only) =====
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
        title:  data.title || 'Unknown title',
        author: data.author_name || '',
        url:    trackUrl(id)
      };
      cache.set(id, meta);
      return meta;
    } catch {
      const fall = { id, title: 'Unknown title', author: '', url: trackUrl(id) };
      cache.set(id, fall);
      return fall;
    }
  }

  function setEmbed(id) {
    // compact embed — size handled by CSS, Spotify renders the smaller UI
    el.frame.src = `https://open.spotify.com/embed/track/${id}?utm_source=generator`;
  }

  function setVU(active) {
    // playful fake VU animation — keeps page lively without audio hooks
    if (active) {
      el.vuBars.forEach((b, idx) => {
        b.style.animation = `vuPulse ${900 + idx * 120}ms ease-in-out infinite`;
      });
    } else {
      el.vuBars.forEach((b) => {
        b.style.animation = 'none';
        b.style.transform = 'scaleY(0.2)';
      });
    }
  }

  async function render(index) {
    const id = ids[index];
    const meta = await getMeta(id);

    el.title.textContent = meta.title;
    el.title.href = meta.url;
    el.artist.textContent = meta.author;

    setEmbed(id);

    // reset UI
    spinning = false;
    el.btnPlay.textContent = 'Play';
    setVU(false);
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
  el.btnPlay.addEventListener('click', () => {
    // can't control iframe playback — use this to toggle the VU + button label
    spinning = !spinning;
    el.btnPlay.textContent = spinning ? 'Pause' : 'Play';
    setVU(spinning);
    // focus iframe so users can immediately press Space/Enter/play inside it
    el.frame?.focus?.();
  });

  // Keyboard affordances
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  el.btnPrev.click();
    if (e.key === 'ArrowRight') el.btnNext.click();
    if (e.code === 'Space') { e.preventDefault(); el.btnPlay.click(); }
  });

  // init
  render(i);
});
