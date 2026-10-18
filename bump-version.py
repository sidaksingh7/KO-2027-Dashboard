"""Stamp every local script/stylesheet/image link in the HTML pages with a new
version (?v=...), so browsers load matching code after an update instead of
mixing a new page with old cached files (GitHub Pages lets browsers cache for 10 min).

Run before committing changes to src/ or assets/:   python3 bump-version.py
"""
import re
import time
from pathlib import Path

PAGES = ["index.html", "admin.html", "tv.html"]
VERSION = time.strftime("%Y%m%d%H%M")
LINK = re.compile(r'((?:src|href)=")((?:src|assets)/[^"?#]+)(\?v=[^"#]*)?(")')

root = Path(__file__).parent
for name in PAGES:
    path = root / name
    text = path.read_text(encoding="utf-8")
    new, count = LINK.subn(lambda m: m.group(1) + m.group(2) + "?v=" + VERSION + m.group(4), text)
    path.write_text(new, encoding="utf-8")
    print(f"{name}: {count} links -> v={VERSION}")
