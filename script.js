const tilt = (Math.random() * 8 - 4).toFixed(2) + 'deg';
document.documentElement.style.setProperty('--active-tilt', tilt);

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('home')) return;
    const SONGS = [
      "https://open.spotify.com/track/2TugrDKkd55mfVOMVZsfO8",
      "https://open.spotify.com/track/6QanbknK7HJMOaUqlNCxhz",
      "https://open.spotify.com/track/6Y4Z2Gehxo4ciCIXmt72a8",
      "https://open.spotify.com/track/6GM7Tngzr6tK5whGLnsUEx",
      "https://open.spotify.com/track/4xT3B4ZRWAqxj1M3S8naKi",
      "https://open.spotify.com/track/5CGX8JPDhMyUI4GkBSDxwP",
    ];
    
    // Spotify bubbles
    (function initBubbles() {
      if (!document.body.classList.contains('home')) return;
      if (!SONGS.length) return;
    
      const layer = document.createElement('div');
      layer.className = 'bubble-layer';
      document.body.appendChild(layer);
    
      const toTrackId = (s) => {
        if (!s) return null;
        if (s.startsWith('spotify:track:')) return s.split(':').pop();
        if (s.includes('/track/')) return s.split('/track/')[1].split('?')[0].split('/')[0];
        return s;
      };
    
      const isMobile = matchMedia('(max-width: 700px)').matches;
      const maxBubbles = Math.min(SONGS.length, isMobile ? 6 : 12);
    
      let openBubble = null;
    
      SONGS.slice(0, maxBubbles).forEach((song, idx) => {
        const id = toTrackId(song);
        if (!id) return;
    
        const b = document.createElement('div');
        b.className = 'bubble';
        b.dataset.trackId = id;
    
        const size = Math.floor(56 + Math.random() * 44);
        b.style.width = `${size}px`;
        b.style.height = `${size}px`;
    
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        const margin = 16;
        const left = Math.random() * (vw - size - margin * 2) + margin;
        const top  = Math.random() * (vh - size - margin * 2) + margin;
        b.style.left = `${left}px`;
        b.style.top  = `${top}px`;
    
        b.style.setProperty('--floatDur', `${16 + Math.random() * 10}s`);
    
        b.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24" fill="#2b2b2b" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);">
            <path d="M12 3v11.55a3.5 3.5 0 1 1-1-2.45V7.25l7-2V12.8a3.5 3.5 0 1 1-1-2.45V3.5L12 5V3z"/>
          </svg>
        `;
    
        const iframe = document.createElement('iframe');
        iframe.className = 'embed';
        iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
        iframe.loading = "lazy";
        iframe.style.borderRadius = '12px';
        b.appendChild(iframe);
    
    
        function open() {
          if (openBubble && openBubble !== b) close(openBubble);
          b.classList.add('open');
          if (!iframe.src) {
            const id = b.dataset.trackId;
            iframe.src = `https://open.spotify.com/embed/track/${id}?utm_source=generator`;
          }
          openBubble = b;
        }
        
        function close(target = b) {
          target.classList.remove('open');
          if (openBubble === target) openBubble = null;
        }
    
        b.addEventListener('mouseenter', open);
        b.addEventListener('mouseleave', () => close());
    
        b.addEventListener('touchstart', (e) => {
          e.preventDefault();
          (b.classList.contains('open') ? close : open)();
        }, { passive: false });
    
        layer.appendChild(b);
      });
    
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openBubble) {
          openBubble.classList.remove('open');
          openBubble = null;
        }
      });
    })();
});
