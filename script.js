// tiny tilt for the active nav tab
const tilt = (Math.random() * 8 - 4).toFixed(2) + 'deg';
document.documentElement.style.setProperty('--active-tilt', tilt);

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('home')) return;

  // ===== tracks =====
  const SONGS = [
    "https://open.spotify.com/track/2QqDNk4meN58jBmUn0EBUi", // Hollywood Hopeful - Loudon Wainwright III
    "https://open.spotify.com/track/3CptguqWjLoOwMoO2DCHWm", // MANIAC - Eddie Benjamin
    "https://open.spotify.com/track/6QanbknK7HJMOaUqlNCxhz", // A Brand New Start - Ross from Friends
    "https://open.spotify.com/track/6GCcY6dVDVGxo52OZq9HVW", // Sideways - Balu Brigada
    "https://open.spotify.com/track/7pugmRsHRy1fnug9NqH5cA", // can u see me in the dark? - Halestorm, I Prevail
    "https://open.spotify.com/track/6rfk3CBKQ8J30Vn2gihtS4", // LITERALLY JUST A GIRL - verygently
    "https://open.spotify.com/track/1cQNiVIM9uxnWZ1nkg0z3u", // Voices - LEAVE.
	"https://open.spotify.com/track/6cOGSlZKf1nJMiNs13qZnq", // HONEYMOON - Jo Hill
	"https://open.spotify.com/track/0OHZI4XXFZ5zrVIwL0JQNk", // Do You Ever Wonder? - Meltt
	"https://open.spotify.com/track/4TzGD5Pryq8DTjv5QRuJaW", // Nowhere To Go - Bad Omens
	"https://open.spotify.com/track/7shaHtNeaR9wolLuJOLqfH", // Headlights - In Color
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

  const reel = mount.querySelector('.reel');
  const btnPrev = mount.querySelector('.reel-btn.prev');
  const btnNext = mount.querySelector('.reel-btn.next');

  const frames = Array.from(track.querySelectorAll('.card-frame'));
  let current = Math.floor(frames.length / 2); // start centered

  function scrollToIndex(idx, behavior = 'smooth') {
    const target = frames[idx];
    if (!target) return;
    const reelRect = reel.getBoundingClientRect();
    const cardRect = target.getBoundingClientRect();
    // position so the card centers inside the visible reel
    const offset = (cardRect.left + reel.scrollLeft) - reelRect.left - (reelRect.width / 2 - cardRect.width / 2);
    reel.scrollTo({ left: offset, behavior });
  }

  function snapAmount() {
    const any = frames[0];
    if (!any) return 320;
    const rect = any.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '16');
    return rect.width + gap;
  }

  // buttons move one frame at a time
  btnPrev.addEventListener('click', () => {
    current = Math.max(0, current - 1);
    scrollToIndex(current);
  });
  btnNext.addEventListener('click', () => {
    current = Math.min(frames.length - 1, current + 1);
    scrollToIndex(current);
  });

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

  // center on load & keep centered on resize
  window.addEventListener('load', () => scrollToIndex(current, 'auto'));
  window.addEventListener('resize', () => scrollToIndex(current, 'auto'));
});
