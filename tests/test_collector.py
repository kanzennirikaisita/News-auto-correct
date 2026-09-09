from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from collector.collect import collect, parse_feed, parse, normalize_url, write_json, score

NOW = datetime(2026, 9, 9, 3, tzinfo=timezone.utc)
SOURCE = {'id': 'test', 'name': 'Test', 'category': 'work', 'type': 'rss', 'url': 'https://example.org/feed', 'enabled': True, 'official': True}
RULES = json.loads((Path(__file__).resolve().parents[1] / 'config/scoring.json').read_text())

def feed(title='脆弱性に関する注意喚起', content='body', pub='Wed, 09 Sep 2026 00:00:00 GMT'):
    return f'<rss><channel><item><title>{title}</title><link>https://example.org/a?utm_source=feed</link><pubDate>{pub}</pubDate><description>{content}</description></item></channel></rss>'.encode()

class CollectorTests(unittest.TestCase):
    def test_new_unchanged_and_updated(self):
        first = collect([SOURCE], RULES, {}, NOW, lambda _: feed())
        item = first['items'][0]
        self.assertEqual(item['changeType'], 'new')
        self.assertEqual(item['importance'], 100)
        self.assertEqual(item['summary'], None)
        second = collect([SOURCE], RULES, first, NOW+timedelta(hours=1), lambda _: feed())
        self.assertEqual(second['items'][0]['detectedAt'], item['detectedAt'])
        self.assertIsNone(second['items'][0]['updatedAt'])
        third = collect([SOURCE], RULES, second, NOW+timedelta(hours=2), lambda _: feed(content='revised body'))
        updated = third['items'][0]
        self.assertEqual(updated['id'], item['id'])
        self.assertEqual(updated['revision'], 2)
        self.assertEqual(updated['changeType'], 'updated')
        self.assertIsNotNone(updated['updatedAt'])
        fourth = collect([SOURCE], RULES, third, NOW+timedelta(hours=3), lambda _: feed(content='revised body'))
        self.assertEqual(fourth['items'][0]['updatedAt'], updated['updatedAt'])

    def test_failure_isolation_and_last_good_time(self):
        first = collect([SOURCE], RULES, {}, NOW, lambda _: feed())
        def broken(_): raise TimeoutError()
        failed = collect([SOURCE], RULES, first, NOW+timedelta(hours=1), broken)
        self.assertEqual(failed['items'], first['items'])
        self.assertEqual(failed['generatedAt'], first['generatedAt'])
        self.assertEqual(failed['sources'][0]['lastSuccess'], first['generatedAt'])
        other = {**SOURCE, 'id': 'other'}
        partial = collect([SOURCE, other], RULES, first, NOW, lambda s: feed() if s['id']=='test' else b'broken')
        self.assertEqual(partial['collector']['success'], 1)
        self.assertEqual(partial['collector']['failed'], 1)

    def test_url_deduplication_and_security(self):
        self.assertEqual(normalize_url('https://EXAMPLE.org/a?b=2&utm_source=x&a=1#top'), 'https://example.org/a?a=1&b=2')
        with self.assertRaises(ValueError): normalize_url('javascript:alert(1)')
        with self.assertRaises(ValueError): normalize_url('https://user:pass@example.org/')
        result = collect([SOURCE, {**SOURCE, 'id':'duplicate'}], RULES, {}, NOW, lambda _:feed())
        self.assertEqual(len(result['items']), 1)

    def test_retention_and_old_article_not_reintroduced(self):
        first = collect([SOURCE], RULES, {}, NOW, lambda _:feed())
        after = collect([SOURCE], RULES, first, NOW+timedelta(days=31), lambda _:feed())
        self.assertEqual(after['items'], [])
        after2 = collect([SOURCE], RULES, after, NOW+timedelta(days=32), lambda _:feed())
        self.assertEqual(after2['items'], [])

    def test_rdf_and_atom(self):
        rdf=b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>RDF</title><link>https://example.org/a</link><dc:date>2026-09-09T00:00:00Z</dc:date></item></rdf:RDF>'
        self.assertEqual(parse_feed(rdf,SOURCE)[0]['publishedAt'],'2026-09-09T00:00:00Z')
        atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link rel="self" href="/entry.xml"/><link rel="alternate" href="/article"/><updated>2026-09-09T00:00:00Z</updated><content>test</content></entry></feed>'
        row=parse_feed(atom,SOURCE)[0]
        self.assertEqual(row['url'],'https://example.org/article')
        self.assertEqual(row['sourceUpdatedAt'],'2026-09-09T00:00:00Z')
        with self.assertRaises(ValueError):parse_feed(b'<html>blocked</html>',SOURCE)

    def test_cdata_example_is_not_an_xml_entity(self):
        raw=feed(content="<![CDATA[Example: <!DOCTYPE html>]]>")
        self.assertEqual(len(parse_feed(raw,SOURCE)),1)
        with self.assertRaises(ValueError):
            parse_feed(b'<!DOCTYPE rss [<!ENTITY a "boom">]><rss/>',SOURCE)

    def test_html_and_github(self):
        source={**SOURCE,'type':'html-links','linkPattern':'/news/detail/'}
        rows=parse(b'<a href="/news/detail/123"><span>A useful news title</span></a><a href="/login">Login</a>',source)
        self.assertEqual(len(rows),1)
        scripted=parse(b'<a href="/news/detail/123">News title here<script>document.getElementById("x"); ldst_strftime(1788922800, \'YMD\');</script></a>',source)
        self.assertEqual(scripted[0]['title'],'News title here')
        self.assertIsNotNone(scripted[0]['publishedAt'])
        gh={**SOURCE,'type':'github-releases'}
        raw=json.dumps([{'name':'v1.0','tag_name':'v1.0','html_url':'https://example.org/v1','published_at':None,'draft':False,'prerelease':False},{'draft':True}]).encode()
        self.assertEqual(len(parse(raw,gh)),1)

    def test_idempotent_output_and_stale_freshness(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'latest.json'
            self.assertTrue(write_json(p,{'items':[]}))
            self.assertFalse(write_json(p,{'items':[]}))
        item={'title':'hello','publishedAt':NOW.isoformat()}
        recent=score(item,SOURCE,RULES,NOW)[0]
        later=score(item,SOURCE,RULES,NOW+timedelta(days=2))[0]
        self.assertEqual(recent-later,10)

if __name__ == '__main__':unittest.main()
