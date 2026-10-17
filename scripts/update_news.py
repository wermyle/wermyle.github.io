"""Builds news.json for the site: latest YouTube uploads (+ optional Discord announcements).

Runs on GitHub Actions (see .github/workflows/news.yml). Uses only the Python standard library.

YouTube: read from the channel's public RSS feed, no API key needed.
YouTube stats (optional): add a repository secret YOUTUBE_API_KEY (free key from Google Cloud,
  YouTube Data API v3). Then subscribers, total views and video count are refreshed every run.

Discord (optional): set these repository secrets to turn it on
  DISCORD_TOKEN       bot token (Bot must be in your server and able to read the channel)
  DISCORD_CHANNEL_ID  ID of your announcements channel
  DISCORD_GUILD_ID    ID of your server (used to build message links)
  DISCORD_AUTHOR_ID   your own user ID, so only your posts are published (recommended)
"""
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

CHANNEL_ID = "UCmPdSMqbyTZeL9AYISa0iVw"  # youtube.com/@wermyle
MAX_VIDEOS = 6
MAX_POSTS = 4

# Mod teasers: every video whose title contains one of these phrases is collected automatically
# and shown under "Read more" for that mod. Add a new mod by adding a line here.
MOD_KEYWORDS = {
    "happy-with-you": ["happy with you"],
}
OUT = os.path.join(os.path.dirname(__file__), "..", "news.json")

NS = {
    "a": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "wermyle-site/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def rss_entries():
    xml = get(f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}")
    root = ET.fromstring(xml)
    items = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", default="", namespaces=NS)
        group = e.find("media:group", NS)
        views = None
        if group is not None:
            stats = group.find("media:community/media:statistics", NS)
            if stats is not None and stats.get("views", "").isdigit():
                views = int(stats.get("views"))
        link = e.find("a:link", NS)
        href = link.get("href") if link is not None else f"https://www.youtube.com/watch?v={vid}"
        items.append({
            "type": "video",
            "id": vid,
            "title": e.findtext("a:title", default="", namespaces=NS),
            "date": e.findtext("a:published", default="", namespaces=NS),
            "url": href,
            "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            "views": views,
            "short": "/shorts/" in href,
        })
    return items


def all_uploads(max_pages=10):
    """Whole upload history via the Data API (needs YOUTUBE_API_KEY), newest first."""
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        return None
    playlist = "UU" + CHANNEL_ID[2:]
    videos, token = [], ""
    for _ in range(max_pages):
        data = json.loads(get(
            "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50"
            f"&playlistId={playlist}&key={key}" + (f"&pageToken={token}" if token else "")
        ))
        for it in data.get("items", []):
            sn = it.get("snippet", {})
            vid = sn.get("resourceId", {}).get("videoId")
            if not vid or sn.get("title") in ("Private video", "Deleted video"):
                continue
            videos.append({
                "type": "video",
                "id": vid,
                "title": sn.get("title", ""),
                "date": sn.get("publishedAt", ""),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            })
        token = data.get("nextPageToken")
        if not token:
            break
    return videos


def mod_teasers(videos, old):
    """Match videos to mods by keyword; keeps teasers found on earlier runs."""
    out = {}
    for mod, words in MOD_KEYWORDS.items():
        found = {v["id"]: v for v in old.get(mod, [])}
        for v in videos:
            title = v.get("title", "").lower()
            if any(w.lower() in title for w in words):
                found[v["id"]] = {k: v.get(k) for k in ("id", "title", "date", "url", "thumb")}
        out[mod] = sorted(found.values(), key=lambda v: v.get("date") or "", reverse=True)
    return out


def youtube_stats():
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        return None
    data = json.loads(get(
        f"https://www.googleapis.com/youtube/v3/channels?part=statistics&id={CHANNEL_ID}&key={key}"
    ))
    st = (data.get("items") or [{}])[0].get("statistics", {})
    stats = {}
    if not st.get("hiddenSubscriberCount") and st.get("subscriberCount", "").isdigit():
        stats["subscribers"] = int(st["subscriberCount"])
    for src, dst in (("viewCount", "views"), ("videoCount", "videos")):
        if st.get(src, "").isdigit():
            stats[dst] = int(st[src])
    return stats or None


def discord_items():
    token = os.environ.get("DISCORD_TOKEN")
    channel = os.environ.get("DISCORD_CHANNEL_ID")
    if not token or not channel:
        return []
    guild = os.environ.get("DISCORD_GUILD_ID", "")
    author = os.environ.get("DISCORD_AUTHOR_ID", "")
    data = json.loads(get(
        f"https://discord.com/api/v10/channels/{channel}/messages?limit=25",
        {"Authorization": f"Bot {token}"},
    ))
    items = []
    for m in data:
        if author and m.get("author", {}).get("id") != author:
            continue
        text = (m.get("content") or "").strip()
        if not text:
            continue
        image = next((a["url"] for a in m.get("attachments", []) if (a.get("content_type") or "").startswith("image/")), None)
        items.append({
            "type": "post",
            "id": m["id"],
            "title": text[:280] + ("…" if len(text) > 280 else ""),
            "date": m.get("timestamp", ""),
            "url": f"https://discord.com/channels/{guild}/{channel}/{m['id']}" if guild else None,
            "thumb": image,
        })
        if len(items) >= MAX_POSTS:
            break
    return items


# Keeps the free Supabase project (site chat) awake: free projects pause after a week without requests.
SUPABASE_URL = "https://jhktsfthhmgshvzwbjmn.supabase.co"
SUPABASE_KEY = "sb_publishable_av74U9zcHh30VMarvBjZ-g_rasiFST_"  # publishable key, public by design


def ping_supabase():
    get(f"{SUPABASE_URL}/rest/v1/chat_messages?select=id&limit=1",
        {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})


def main():
    try:
        ping_supabase()
    except Exception as exc:
        print(f"supabase ping failed: {exc}", file=sys.stderr)
    old = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                old = json.load(f)
        except Exception:
            old = {}
    stats = old.get("stats")
    try:
        stats = youtube_stats() or stats
    except Exception as exc:
        print(f"youtube stats failed: {exc}", file=sys.stderr)
    items, rss = [], []
    try:
        rss = rss_entries()
        items += rss[:MAX_VIDEOS]
    except Exception as exc:
        print(f"youtube failed: {exc}", file=sys.stderr)
    try:
        items += discord_items()
    except Exception as exc:  # keep the other source even if one fails
        print(f"discord failed: {exc}", file=sys.stderr)
    teasers = old.get("teasers", {})
    try:
        history = all_uploads()
        teasers = mod_teasers(history if history is not None else rss, teasers)
    except Exception as exc:
        print(f"teasers failed: {exc}", file=sys.stderr)
        teasers = mod_teasers(rss, teasers)
    if not items:
        items = old.get("items", [])  # keep the previous list if every source failed
    items.sort(key=lambda i: i.get("date") or "", reverse=True)
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "items": items}
    if stats:
        out["stats"] = stats
    out["teasers"] = teasers
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(items)} items")


if __name__ == "__main__":
    main()
