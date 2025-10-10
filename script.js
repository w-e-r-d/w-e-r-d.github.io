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
    "https://open.spotify.com/track/19vHgVS1aukRiQWhTqfKnE", // DArkSide - Bring Me The Horizon
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
