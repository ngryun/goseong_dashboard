"""Use content versions so each deployed HTML loads matching CSS and JavaScript."""
from hashlib import sha256
import json
from pathlib import Path
import re


def version_assets(root):
    page = root / 'index.html'
    html = page.read_text(encoding='utf-8')
    versions = {}
    for name in ('style.css', 'app.js'):
        version = sha256((root / name).read_bytes()).hexdigest()[:12]
        versions[name] = version
        pattern = rf'((?:href|src)=\"){re.escape(name)}(?:\?[^\"]*)?(\")'
        html, count = re.subn(pattern, rf'\g<1>{name}?v={version}\g<2>', html)
        if count != 1:
            raise ValueError(f'Expected one reference to {name}, found {count}')
    page.write_text(html, encoding='utf-8')
    # Open pages poll this file and reload themselves when their app.js is no longer current.
    (root / 'version.json').write_text(json.dumps(versions) + '\n', encoding='utf-8')


if __name__ == '__main__':
    version_assets(Path(__file__).resolve().parents[1] / 'docs')
