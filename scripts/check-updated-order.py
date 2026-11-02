#!/usr/bin/env python3
"""Build isolated dated fixtures and check article discovery after an update."""
import datetime as dt
import os
from pathlib import Path
import subprocess
import tempfile
from html.parser import HTMLParser
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = {
    "revised-old": ("2018-01-01", "2026-11-01T12:00:00+08:00"),
    "newer-post": ("2026-10-31", "2026-11-01T09:00:00+08:00"),
    "nested/old": ("2019-01-01", "2026-10-30T12:00:00+08:00"),
    "previous-year": ("2025-12-01", "2025-12-02T12:00:00+08:00"),
    "long-ago": ("2020-01-01", "2024-08-01T12:00:00+08:00"),
    "hidden": ("2026-11-01", "2026-11-01T20:00:00+08:00"),
}
HOME_ORDER = [f"/posts/{name}/" for name in list(FIXTURES)[:-1]]
ALL_ORDER = ["/posts/hidden/", *HOME_ORDER]


class Lists(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.sections, self.section_titles = {}, []
        self.archive, self.related, self.years, self.times = [], [], {}, {}
        self.section = self.year = self.last_link = self.heading = None
        self.heading_text, self.in_related = [], False
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        if tag in ("h2", "h3"):
            kind = "section" if "posts-section-title" in classes else "year" if "group-title" in classes else None
            if kind:
                self.heading, self.heading_text = (tag, kind), []
        if tag == "section" and "related-posts" in classes:
            self.in_related = True
        if tag == "a":
            href = attrs.get("href", "")
            if "post-row" in classes:
                self.sections[self.section].append(href)
                self.last_link = href
            if "archive-item-link" in classes:
                self.archive.append(href)
                self.years[href], self.last_link = self.year, href
            if self.in_related and href in ALL_ORDER:
                self.related.append(href)
        if tag == "time" and self.last_link and any(c in classes for c in ("post-row-date", "meta-date", "archive-item-date")):
            self.times[self.last_link] = attrs.get("datetime")

    def handle_data(self, data):
        if self.heading:
            self.heading_text.append(data)

    def handle_endtag(self, tag):
        if self.heading and tag == self.heading[0]:
            text = "".join(self.heading_text).strip()
            if self.heading[1] == "section":
                self.section = text
                self.section_titles.append(text)
                self.sections[text] = []
            else:
                self.year = text
            self.heading = None
        if tag == "section":
            self.in_related = False


def check():
    with tempfile.TemporaryDirectory(prefix="blog-updated-order-") as directory:
        temp = Path(directory)
        content, public = temp / "content", temp / "public"
        for name, (published, modified) in FIXTURES.items():
            target = content / "posts" / name / "index.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                "+++\n" + f"title = '{name}'\ndate = '{published}'\nlastmod = '{modified}'\n"
                + "draft = false\nfeatured = true\ntags = ['OrderFixture']\ncategories = ['OrderFixture']\n"
                + ("hiddenfromhomepage = true\n" if name == "hidden" else "")
                + "+++\n\nOrdering fixture.\n", encoding="utf-8")
        (content / "posts/nested/_index.md").write_text("+++\ntitle = 'Nested section'\n+++\n", encoding="utf-8")
        config = temp / "fixture.toml"
        config.write_text("enableGitInfo = false\nresourceDir = '" + (temp / "resources").as_posix()
                          + "'\n[pagination]\npagerSize = 2\n", encoding="utf-8")
        build = subprocess.run([
            "hugo", "--environment", "production", "--config", f"hugo.toml,{config}",
            "--contentDir", str(content), "--destination", str(public),
            "--cacheDir", str(temp / "cache"), "--clock", "2026-11-02T12:00:00+08:00",
            "--minify", "--noBuildLock",
        ], cwd=ROOT, env={**os.environ, "TZ": "Asia/Shanghai"}, capture_output=True, text=True)
        assert build.returncode == 0, build.stdout + build.stderr

        def read(route):
            return Lists((public / route.lstrip("/") / "index.html").read_text(encoding="utf-8"))

        home = read("/")
        assert home.section_titles[:2] == ["Recently Updated", "Recommended Posts"], home.section_titles
        assert home.sections["Recently Updated"] == HOME_ORDER, home.sections
        assert home.sections["Recommended Posts"] == HOME_ORDER, home.sections
        for href in HOME_ORDER:
            modified = FIXTURES[href.removeprefix("/posts/").rstrip("/")][1]
            assert dt.datetime.fromisoformat(home.times[href]) == dt.datetime.fromisoformat(modified), home.times

        archive = read("/posts/")
        assert archive.archive == ALL_ORDER, archive.archive
        assert "/posts/nested/" not in archive.archive
        assert archive.years["/posts/revised-old/"] == "2026", archive.years
        assert archive.years["/posts/previous-year/"] == "2025", archive.years
        assert archive.years["/posts/long-ago/"] == "2024", archive.years
        for prefix in ("/tags/orderfixture/", "/categories/orderfixture/"):
            for page in range(1, 4):
                route = prefix if page == 1 else f"{prefix}page/{page}/"
                listing = read(route)
                assert listing.archive == ALL_ORDER[(page - 1) * 2:page * 2], (route, listing.archive)
        assert read("/posts/newer-post/").related == [href for href in HOME_ORDER if href != "/posts/newer-post/"]

        for route in ("index.xml", "posts/index.xml", "tags/orderfixture/index.xml", "categories/orderfixture/index.xml"):
            channel = ET.parse(public / route).getroot().find("channel")
            items = channel.findall("item")
            assert [urlsplit(item.findtext("link")).path for item in items] == ALL_ORDER, route
            assert parsedate_to_datetime(channel.findtext("lastBuildDate")) == dt.datetime.fromisoformat(FIXTURES["hidden"][1]), route
            revised = next(item for item in items if urlsplit(item.findtext("link")).path == "/posts/revised-old/")
            assert parsedate_to_datetime(revised.findtext("pubDate")).year == 2018, route
            assert dt.datetime.fromisoformat(revised.findtext("{http://www.w3.org/2005/Atom}updated")) == dt.datetime.fromisoformat(FIXTURES["revised-old"][1]), route
        print("Updated-order fixtures passed: old articles, timestamps, nested sections, year groups, pagination, hidden posts, related posts and RSS.")


if __name__ == "__main__":
    check()
