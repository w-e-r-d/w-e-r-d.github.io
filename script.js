// tiny tilt for the active nav tab
const tilt = (Math.random() * 8 - 4).toFixed(2) + 'deg';
document.documentElement.style.setProperty('--active-tilt', tilt);

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('home')) return;

  // ===== songs =====
  const SONGS = [
    "https://open.spotify.com/track/2TugrDKkd55mfVOMVZsfO8",
    "https://open.spotify.com/track/6QanbknK7HJMOaUqlNCxhz",
    "https://open.spotify.com/track/6Y4Z2Gehxo4ciCIXmt72a8",
    "https://open.spotify.com/track/6GM7Tngzr6tK5whGLnsUEx",
    "https://open.spotify.com/track/4xT3B4ZRWAqxj1M3S8naKi",
    "https://open.spotify.com/track/5CGX8JPDhMyUI4GkBSDxwP",
  ];
  if (!SONGS.length) return;

  const toId = (s) => {
    if (!s) return null;
    if (s.startsWith('spotify:track:')) return s.split(':').pop();
    if (s.includes('/track/')) return s.split('/track/')[1].split('?')[0].split('/')[0];
    return s; // assume raw ID
  };

  // container in <main>
  const main = document.querySelector('main') || document.body;
  const wrap = document.createElement('div');
  wrap.className = 'carousel-wrap';

  const prev = document.createElement('button');
  prev.className = 'car-btn prev';
  prev.setAttribute('aria-label', 'Previous');
  prev.textContent = '‹';

  const next = document.createElement('button');
  next.className = 'car-btn next';
  next.setAttribute('aria-label', 'Next');
  next.textContent = '›';

  const ring = document.createElement('div');
  ring.className = 'carousel';
  ring.id = 'spotify-carousel';

  wrap.appendChild(prev);
  wrap.appendChild(ring);
  wrap.appendChild(next);

  const hint = document.createElement('p');
  hint.className = 'carousel-hint more-text';
  // hint.textContent = '';

  main.appendChild(wrap);
  main.appendChild(hint);

  // ring
  const ids = SONGS.map(toId).filter(Boolean);
  const count = Math.min(ids.length, 12);
  const radius = 600;
  const STEP = 360 / count;

  const cards = ids.slice(0, count).map((id, i) => {
    const card = document.createElement('div');
    card.className = 'car-card';
    card.style.setProperty('--ry', `${i * STEP}deg`);
    card.style.setProperty('--tz', `${radius}px`);

    const iframe = document.createElement('iframe');
    iframe.loading = 'lazy';
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.src = `https://open.spotify.com/embed/track/${id}?utm_source=generator`;

    card.appendChild(iframe);
    ring.appendChild(card);
    return { el: card, id, ifr: iframe };
  });

  let angle = 0;

  function activeIndexFromAngle() {
    const approx = Math.round((-angle) / STEP);
    return ((approx % count) + count) % count;
  }

  function applyTransform() {
    ring.style.transform = `translateZ(-${radius}px) rotateY(${angle}deg)`;
    const ai = activeIndexFromAngle();
    cards.forEach((c, i) => c.el.classList.toggle('active', i === ai));
  }

  function nudge(steps) {
    angle -= steps * STEP; 
    applyTransform();
  }

  applyTransform();

  prev.addEventListener('click', () => nudge(-1)); // previous
  next.addEventListener('click', () => nudge(1));  // next

  let dragX = null;
  ring.addEventListener('pointerdown', (e) => {
    dragX = e.clientX;
    ring.setPointerCapture(e.pointerId);
  });
  ring.addEventListener('pointerup', () => { dragX = null; });
  ring.addEventListener('pointermove', (e) => {
    if (dragX == null) return;
    const dx = e.clientX - dragX;
    if (Math.abs(dx) > 24) {
      nudge(Math.sign(dx));
      dragX = e.clientX;
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  nudge(-1);
    if (e.key === 'ArrowRight') nudge(1);
  });

  let auto = setInterval(() => nudge(1), 6000);
  wrap.addEventListener('mouseenter', () => clearInterval(auto));
  wrap.addEventListener('mouseleave', () => (auto = setInterval(() => nudge(1), 6000)));
});
