"""Personal Radar collector. Python 3.11+, standard library only."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, urljoin
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
UTC = timezone.utc
MAX_BYTES = 6 * 1024 * 1024


def stamp(value):
    return value.astimezone(UTC).isoformat(timespec="seconds")


def date(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = parsedate_to_datetime(str(value))
        except (ValueError, TypeError, OverflowError):
            return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def clean(value):
    return " ".join(unescape(re.sub(r"<[^>]*>", " ", str(value or ""))).split())


def normalize_url(value):
    parts = urlsplit(value.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("Unsupported article URL")
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in ("fbclid", "gclid", "mc_cid", "mc_eid")]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", urlencode(sorted(query)), ""))


def digest(value):
    return sha256(value.encode()).hexdigest()


def title_key(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def child(node, *names):
    for name in names:
        for element in node:
            if element.tag.rsplit("}", 1)[-1] == name:
                return "".join(element.itertext())
    return ""


def parse_feed(raw, source):
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("XML entities are unsupported")
    root = ET.fromstring(raw)
    if root.tag.rsplit("}", 1)[-1] not in ("rss", "RDF", "feed"):
        raise ValueError("Not RSS or Atom")
    rows = []
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] not in ("item", "entry"):
            continue
        link = child(node, "link")
        for el in node:
            if el.tag.rsplit("}", 1)[-1] == "link" and el.get("href") and el.get("rel", "alternate") == "alternate":
                link = el.get("href")
                break
        if not link:
            guid = child(node, "guid")
            if guid.startswith("http"):
                link = guid
        if not link:
            continue
        rows.append({"title": clean(child(node, "title")), "url": urljoin(source["url"], link.strip()),
                     "publishedAt": child(node, "pubDate", "published", "date"),
                     "sourceUpdatedAt": child(node, "updated", "modified"),
                     "content": clean(child(node, "encoded", "content", "description", "summary"))})
    return rows


class NewsLinks(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.source, self.rows, self.link, self.words = source, [], None, []
        self.ignored = None
        self.published = None

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.ignored = tag
        if tag == "a":
            href = dict(attrs).get("href", "")
            self.link = urljoin(self.source["url"], href) if re.search(self.source["linkPattern"], href) else None
            self.words = []
            self.published = None

    def handle_data(self, data):
        if self.ignored:
            # Lodestone renders dates from literal Unix timestamps. Never execute page code.
            if self.link and self.ignored == 'script':
                match = re.search(r'ldst_strftime\((\d{10}),', data)
                if match:
                    self.published = stamp(datetime.fromtimestamp(int(match[1]), UTC))
            return
        if self.link:
            self.words.append(data)

    def handle_endtag(self, tag):
        if tag == self.ignored:
            self.ignored = None
        if tag == "a" and self.link:
            title = clean(" ".join(self.words)).rstrip(' -')
            if len(title) > 8:
                self.rows.append({"title": title, "url": self.link, "publishedAt": self.published, "content": ""})
            self.link = None


def parse(raw, source):
    if source["type"] == "rss":
        return parse_feed(raw, source)
    if source["type"] == "github-releases":
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("Not a GitHub release list")
        return [{"title": f'{source["name"]} {r.get("name") or r["tag_name"]}',
                 "url": r["html_url"], "publishedAt": r.get("published_at"),
                 "sourceUpdatedAt": r.get("updated_at"), "content": clean(r.get("body")), "kind": "release"}
                for r in data if not r.get("draft") and not r.get("prerelease")]
    if source["type"] == "html-links":
        parser = NewsLinks(source)
        parser.feed(raw.decode("utf-8"))
        if not parser.rows:
            raise ValueError("No news links; check source structure")
        return parser.rows
    raise ValueError("Unknown source type")


def fetch(source):
    request = Request(source["url"], headers={"User-Agent": "News-auto-correct/1.0 (+https://github.com/kanzennirikaisita/News-auto-correct)",
                                             "Accept": "application/rss+xml, application/atom+xml, application/json, text/html, */*"})
    with urlopen(request, timeout=20) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Source exceeds size limit")
    return raw


def score(item, source, rules, now):
    # Score titles only: release bodies may contain unrelated words or negated warnings.
    title = item["title"].casefold()
    points, reasons = rules["base"], []
    if source.get("official"):
        points += rules["official"]
        reasons.append("公式一次情報")
    published = date(item.get("publishedAt"))
    if published and timedelta(0) <= now - published <= timedelta(hours=24):
        points += rules["fresh"]
        reasons.append("24時間以内")
    if item.get("kind") == "release":
        points += rules["release"]
        reasons.append("バージョン公開")
    for mapping in (rules["keywords"], rules["categories"].get(source["category"], {})):
        for word, weight in mapping.items():
            if word.casefold() in title:
                points += weight
                reasons.append(word)
    tags = [tag for tag, words in rules["tagKeywords"].items() if any(w.casefold() in title for w in words)]
    if item.get("kind") == "release" and "更新" not in tags:
        tags.append("更新")
    return min(100, max(0, points)), list(dict.fromkeys(reasons)), tags


def collect(sources, rules, previous, now, loader=fetch):
    now_s = stamp(now)
    old = {item["id"]: item for item in previous.get("items", [])}
    items = dict(old)
    prior_states = {s["id"]: s for s in previous.get("sources", [])}
    states = []
    enabled = [s for s in sources if s["enabled"]]

    def load(source):
        try:
            rows = parse(loader(source), source)
            valid = []
            for row in rows[:200]:
                try:
                    row["url"] = normalize_url(row["url"])
                    if row["title"]:
                        valid.append(row)
                except (ValueError, KeyError):
                    continue
            if rows and not valid:
                raise ValueError("No valid articles")
            return source, valid, None
        except Exception as exc:  # A failed source must not destroy the last good feed.
            return source, [], f'{type(exc).__name__}: {str(exc)[:160]}'

    # Ordered map gives deterministic source priority for exact cross-source URL duplicates.
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(load, enabled))
    seen = set()
    for source, rows, error in results:
        prior = prior_states.get(source["id"], {})
        states.append({"id": source["id"], "name": source["name"], "category": source["category"],
                       "url": source["url"], "status": "error" if error else "ok", "error": error,
                       "lastSuccess": prior.get("lastSuccess") if error else now_s, "count": len(rows)})
        for row in rows:
            identity = digest(row["url"])[:24]
            if identity in seen:
                continue
            seen.add(identity)
            prev = old.get(identity)
            pub = date(row.get("publishedAt"))
            modified = date(row.get("sourceUpdatedAt"))
            # Keep a compact fingerprint, never republish full article bodies.
            fingerprint = digest(json.dumps([title_key(row["title"]), row.get("content", ""),
                                             stamp(modified) if modified else None], ensure_ascii=False))
            changed = prev is not None and prev.get("contentHash") != fingerprint
            effective = pub or modified
            if prev is None and effective and effective < now - timedelta(days=30) and (not modified or modified < now - timedelta(days=30)):
                continue
            item = {"id": identity, "title": row["title"], "url": row["url"],
                    "sourceId": source["id"], "sourceName": source["name"], "category": source["category"],
                    "publishedAt": stamp(pub) if pub else None,
                    "detectedAt": prev["detectedAt"] if prev else now_s,
                    "updatedAt": now_s if changed else prev.get("updatedAt") if prev else None,
                    "sourceUpdatedAt": stamp(modified) if modified else None,
                    "changeType": "updated" if changed else prev.get("changeType", "new") if prev else "new",
                    "kind": row.get("kind", "article"), "summary": None,
                    "contentHash": fingerprint, "revision": prev.get("revision", 1) + int(changed) if prev else 1}
            item["importance"], item["importanceReasons"], item["tags"] = score(item, source, rules, now)
            items[identity] = item
    source_map = {s["id"]: s for s in enabled}
    retained = []
    for item in items.values():
        if item["sourceId"] not in source_map:
            continue
        # Retention is based on the last detected change, not last fetch.
        if date(item.get("updatedAt") or item["detectedAt"]) < now - timedelta(days=30):
            continue
        item = dict(item)
        item["importance"], item["importanceReasons"], item["tags"] = score(item, source_map[item["sourceId"]], rules, now)
        retained.append(item)
    retained.sort(key=lambda i: (i.get("updatedAt") or i["detectedAt"], i["id"]), reverse=True)
    success = sum(s["status"] == "ok" for s in states)
    return {"schemaVersion": 1, "generatedAt": now_s if success else previous.get("generatedAt"),
            "collector": {"lastRun": now_s, "success": success, "failed": len(states) - success},
            "sources": states, "items": retained[:3000]}


def write_json(path, data):
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "data/latest.json")
    parser.add_argument("--snapshot-dir", type=Path, help="Replay previously fetched raw responses; missing sources remain errors")
    args = parser.parse_args()
    sources = json.loads((ROOT / "config/sources.json").read_text(encoding="utf-8"))
    rules = json.loads((ROOT / "config/scoring.json").read_text(encoding="utf-8"))
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    loader = (lambda source: (args.snapshot_dir / (source["id"] + ".raw")).read_bytes()) if args.snapshot_dir else fetch
    result = collect(sources, rules, previous, datetime.now(UTC), loader)
    if args.snapshot_dir:
        result["collector"]["mode"] = "snapshot-replay"
    write_json(args.output, result)
    print(f'{result["collector"]["success"]}/{len(result["sources"])} sources OK; {len(result["items"])} items')
    for state in result["sources"]:
        print(f'{state["id"]}: {state["status"]} ({state["count"]})')
    if not result["collector"]["success"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
