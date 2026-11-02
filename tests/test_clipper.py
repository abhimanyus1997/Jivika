import base64
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_app_extension_id_matches_manifest_key():
    """The app talks to Jivika Clipper by ID; Chrome derives that ID from the manifest's public key."""
    manifest = json.loads((ROOT / "extension/src/manifest.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(base64.b64decode(manifest["key"])).hexdigest()[:32]
    expected = "".join(chr(ord("a") + int(c, 16)) for c in digest)
    bridge = (ROOT / "frontend/src/lib/clipper-bridge.ts").read_text(encoding="utf-8")
    assert re.search(r"EXTENSION_ID = '([a-p]{32})'", bridge).group(1) == expected


def test_app_knows_the_published_clipper_version():
    manifest = json.loads((ROOT / "extension/src/manifest.json").read_text(encoding="utf-8"))
    clip = (ROOT / "frontend/src/lib/clip.ts").read_text(encoding="utf-8")
    assert re.search(r"LATEST_CLIPPER_VERSION = '([\d.]+)'", clip).group(1) == manifest["version"]
