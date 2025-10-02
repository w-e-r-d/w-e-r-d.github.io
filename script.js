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

  // ===== build glossy strip =====
  const mount = document.querySelector('#film-reel') || document.querySelector('main') || document.body;
  mount.innerHTML = `
    <div class="reel-wrap neon">
      <button class="reel-btn prev" aria-label="Previous">‹</button>

      <div class="reel" tabindex="0" aria-label="Spotify strip">
        <div class="reel-track"></div>
      </div>

      <button class="reel-btn next" aria-label="Next">›</button>
    </div>
    <p class="carousel-hint more-text">Drag, scroll, or use arrows to browse.</p>
  `;

  const track = mount.querySelector('.reel-track');

  ids.forEach((id, idx) => {
    const frame = document.createElement('article');
    frame.className = 'card-frame';
    frame.style.setProperty('--tilt', `${(idx % 3 === 0 ? -1.2 : idx % 3 === 1 ? 0.8 : -0.6)}deg`);
    frame.innerHTML = `
      <div class="card">
        <div class="card-blur"></div>
        <div class="card-glow"></div>
        <div class="card-sheen"></div>
        <iframe
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          src="https://open.spotify.com/embed/track/${id}?utm_source=generator"
          title="Spotify track"></iframe>
      </div>
    `;
    track.appendChild(frame);
  });

  // smooth buttons
  const reel = mount.querySelector('.reel');
  const btnPrev = mount.querySelector('.reel-btn.prev');
  const btnNext = mount.querySelector('.reel-btn.next');

  function snapAmount() {
    const any = track.querySelector('.card-frame');
    if (!any) return 320;
    const rect = any.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '16');
    return rect.width + gap;
  }

  btnPrev.addEventListener('click', () => reel.scrollBy({ left: -snapAmount(), behavior: 'smooth' }));
  btnNext.addEventListener('click', () => reel.scrollBy({ left:  snapAmount(), behavior: 'smooth' }));

  // drag-to-scroll
  let isDown = false, startX = 0, startScroll = 0;
  reel.addEventListener('pointerdown', (e) => {
    isDown = true;
    reel.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startScroll = reel.scrollLeft;
    reel.classList.add('dragging');
  });
  reel.addEventListener('pointermove', (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    reel.scrollLeft = startScroll - dx;
  });
  ['pointerup', 'pointercancel', 'mouseleave'].forEach(ev =>
    reel.addEventListener(ev, () => { isDown = false; reel.classList.remove('dragging'); })
  );

  // wheel horizontal
  reel.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      reel.scrollBy({ left: e.deltaY, behavior: 'auto' });
      e.preventDefault();
    }
  }, { passive: false });

  // keyboard
  reel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); btnNext.click(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); btnPrev.click(); }
  });
});
