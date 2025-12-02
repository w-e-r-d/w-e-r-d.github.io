import os, sys
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.exceptions import SpotifyException

# ==== CONFIG ====
CLIENT_ID = "REPLACE ME WITH YOUR OWN"
CLIENT_SECRET = "REPLACE ME WITH YOUR OWN"
REDIRECT_URI = "http://127.0.0.1:8765/callback"

PLAYLIST_ID = "REPLACE ME WITH YOUR OWN"
CACHE_PATH = os.path.expanduser("~/Documents/.spotipy_cache")
SCOPE = "user-read-currently-playing playlist-modify-public playlist-modify-private"
# =================================

def build_client():
    auth = SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
        scope=SCOPE,
        cache_path=CACHE_PATH,
        open_browser=False,
        show_dialog=False
    )
    return spotipy.Spotify(auth_manager=auth)

def playlist_contains(sp, playlist_id, track_id):
    offset = 0
    while True:
        res = sp.playlist_items(
            playlist_id,
            fields="items(track(id)),next",
            limit=100,
            offset=offset,
            additional_types=["track"]
        )
        for it in res.get("items", []):
            t = it.get("track") or {}
            if t.get("id") == track_id:
                return True
        if not res.get("next"):
            return False
        offset += 100

def add_to_playlist(sp, playlist_id, track_id):
    if not track_id:
        return False, "no track id"
    if playlist_contains(sp, playlist_id, track_id):
        return True, "in playlist already"
    sp.playlist_add_items(playlist_id, [track_id])
    return True, "added to playlist"

def from_current(sp):
    cur = sp.current_user_playing_track()
    if not cur or not cur.get("is_playing"):
        return None, "NOT_PLAYING"
    item = cur.get("item")
    if not item or item.get("type") != "track":
        return None, "NOT_TRACK"
    track_id = item.get("id")
    title = item.get("name")
    artists = ", ".join(a.get("name") for a in item.get("artists", []))
    ok, msg = add_to_playlist(sp, PLAYLIST_ID, track_id)
    return (title, artists, ok, msg), None

def search_and_add(sp, title, artist=""):
    title = (title or "").strip()
    artist = (artist or "").strip()
    if not title:
        return None, "no title recieved"

    q = f'track:"{title}"' + (f' artist:"{artist}"' if artist else "")
    res = sp.search(q=q, type="track", limit=5)
    items = res.get("tracks", {}).get("items", [])

    if not items:
        q2 = f"{title} {artist}".strip()
        res = sp.search(q=q2, type="track", limit=10)
        items = res.get("tracks", {}).get("items", [])
        if not items:
            return None, f"no match for: {title}" + (f" {artist}" if artist else "")

    best = max(items, key=lambda t: (t.get("popularity") or 0))
    track_id = best.get("id")
    tname = best.get("name")
    artists = ", ".join(a.get("name") for a in best.get("artists", []))
    ok, msg = add_to_playlist(sp, PLAYLIST_ID, track_id)
    return (tname, artists, ok, msg), None

def main():
    sp = build_client()

    args = sys.argv[1:]
    if args:
        title = args[0]
        artist = args[1] if len(args) > 1 else ""
        info, err = search_and_add(sp, title, artist)
        if info:
            tname, artists, ok, msg = info
            print(f"SHZ_OK: {tname} {artists} | {msg}")
        else:
            print(f"SHZ_FAIL: {err}")
        return

    info, errcode = from_current(sp)
    if info:
        tname, artists, ok, msg = info
        print(f"CURR_OK: {tname} {artists} | {msg}")
    else:
        if errcode == "NOT_PLAYING":
            print("CURR_NO: not playing")
        else:
            print("CURR_NO: podcast/audiobook, no song")

if __name__ == "__main__":
    main()