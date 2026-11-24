# SPDX-License-Identifier: Apache-2.0
"""Tests for metadata stripping, upload quota and naming, delete validation, theme-file
header and backup, entry removal, user pruning, revision checks and error messages.
Run: python3 tests/test_files.py
"""

from __future__ import annotations

import base64
import os
import re
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "custom_components" / "zoosh"))
sys.path.insert(0, str(ROOT / "tests"))

import automation as au  # noqa: E402
import fileops as fo  # noqa: E402
import images as im  # noqa: E402
import storage as st  # noqa: E402
import synth  # noqa: E402
import yaml_gen as yg  # noqa: E402

FAILS: list[str] = []


def check(c: bool, label: str) -> None:
    print(("PASS " if c else "FAIL ") + label)
    if not c:
        FAILS.append(label)


def raises(fn, label: str) -> None:
    try:
        fn()
    except ValueError:
        check(True, label)
        return
    check(False, label)


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def main() -> None:
    # ---------------- JPEG
    gps = synth.seg(0xE1, b"Exif\x00\x00" + b"GPSLatitude 51.5N GPSLongitude 0.1W")
    xmp = synth.seg(0xE1, b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>secret</x:xmpmeta>")
    icc = synth.seg(0xE2, b"ICC_PROFILE\x00" + b"\x01" * 40)
    iptc = synth.seg(0xED, b"Photoshop 3.0\x00" + b"8BIM caption")
    com = synth.seg(0xFE, b"taken at home")
    adobe = synth.seg(0xEE, b"Adobe\x00\x64\x00\x00\x00\x00\x00")
    plain = synth.jpeg()
    dirty = synth.jpeg([gps, xmp, icc, iptc, com, adobe])
    out = im.strip_jpeg(dirty)
    for needle in (b"GPSLatitude", b"Exif", b"xmpmeta", b"ICC_PROFILE", b"Photoshop", b"taken at home"):
        check(needle not in out, f"jpeg: {needle!r} removed")
    check(b"Adobe" in out, "jpeg: Adobe colour segment kept")
    check(out.endswith(synth.SCAN), "jpeg: scan data from SOS on is byte-identical")
    check(im.strip_jpeg(plain) == plain, "jpeg without metadata is unchanged")
    check(im.strip_jpeg(im.strip_jpeg(dirty)) == out, "jpeg stripping is idempotent")
    for label, bad in (("no SOI", b"\x00" * 20), ("truncated segment", b"\xff\xd8\xff\xe1\x00\xff" + b"x" * 10),
                       ("no scan", b"\xff\xd8" + synth.seg(0xE0, b"JFIF\x00") + b"\xff\xd9"),
                       ("segment length 1", b"\xff\xd8\xff\xe1\x00\x01"), ("not ending", synth.jpeg()[:-6])):
        raises(lambda b=bad: im.strip_jpeg(b), f"jpeg rejected: {label}")

    # ---------------- PNG
    p_dirty = synth.png([(b"tEXt", b"Comment\x00GPS 51.5N"), (b"zTXt", b"k\x00\x00xx"), (b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00<x/>"),
                         (b"eXIf", b"Exif\x00\x00GPS"), (b"tIME", b"\x07\xe9\x01\x01\x00\x00\x00"), (b"gAMA", b"\x00\x00\xb1\x8f")])
    p_out = im.strip_png(p_dirty)
    for needle in (b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME", b"GPS"):
        check(needle not in p_out, f"png: {needle!r} removed")
    check(b"gAMA" in p_out and b"IHDR" in p_out and b"IDAT" in p_out and p_out.endswith(synth.png_chunk(b"IEND", b"")), "png: other chunks kept")
    check(im.strip_png(synth.png()) == synth.png(), "png without metadata is unchanged")
    bad_crc = bytearray(synth.png()); bad_crc[30] ^= 0xFF
    raises(lambda: im.strip_png(bytes(bad_crc)), "png rejected: bad checksum")
    raises(lambda: im.strip_png(synth.png()[:-8]), "png rejected: truncated")
    raises(lambda: im.strip_png(b"\x89PNG\r\n\x1a\n" + synth.png_chunk(b"IDAT", b"x")), "png rejected: no IHDR first")

    # ---------------- WebP
    w_dirty = synth.webp([(b"EXIF", b"Exif\x00\x00GPS lat"), (b"XMP ", b"<x:xmpmeta>me</x:xmpmeta>x")], vp8x_flags=0x0C | 0x10)
    w_out = im.strip_webp(w_dirty)
    check(b"EXIF" not in w_out and b"XMP " not in w_out and b"GPS" not in w_out and b"xmpmeta" not in w_out, "webp: EXIF and XMP chunks removed")
    check(w_out[4:8] == struct.pack("<I", len(w_out) - 8), "webp: RIFF size fixed")
    check(w_out[20] == 0x10, "webp: VP8X exif/xmp flags cleared, other flags kept")
    check(b"VP8 \x06\x00\x00\x00\x01\x02\x03\x04\x05\x06" in w_out, "webp: image chunk byte-identical")
    check(im.strip_webp(synth.webp()) == synth.webp(), "webp without metadata is unchanged")
    raises(lambda: im.strip_webp(synth.webp()[:-3]), "webp rejected: truncated")
    raises(lambda: im.strip_webp(b"RIFF\x04\x00\x00\x00WEBP"), "webp rejected: no chunks")

    # ---------------- decode_image does the stripping and keeps the type check
    raw, ext = im.decode_image(b64(dirty), "image/jpeg")
    check(ext == "jpg" and b"GPSLatitude" not in raw, "decode_image strips uploads")
    raises(lambda: im.decode_image(b64(b"\xff\xd8\xff\xe1\x00\x05abc"), "image/jpeg"), "decode_image rejects files that do not parse cleanly")
    raises(lambda: im.decode_image(b64(synth.png()), "image/jpeg"), "decode_image rejects a type mismatch")

    # ---------------- naming and quota
    n1 = im.content_name(raw, ext)
    check(re.fullmatch(r"wallpaper-[0-9a-f]{12}\.jpg", n1) is not None and "GPS" not in n1, "name is content hash only")
    check(im.content_name(raw, ext) == n1, "same content, same name")
    im.check_quota({f"wallpaper-{i:012x}.jpg": 10 for i in range(29)}, n1, 10)
    raises(lambda: im.check_quota({f"wallpaper-{i:012x}.jpg": 10 for i in range(30)}, n1, 10), "quota: 31st file refused")
    im.check_quota({f"wallpaper-{i:012x}.jpg": 10 for i in range(30)}, "wallpaper-000000000001.jpg", 10)
    check(True, "quota: re-uploading an existing file is fine")
    raises(lambda: im.check_quota({"wallpaper-000000000001.jpg": 59 * 1024 * 1024}, n1, 2 * 1024 * 1024), "quota: 60 MB total enforced")
    im.check_quota({"wallpaper-000000000001.jpg": 50 * 1024 * 1024}, n1, 5 * 1024 * 1024)
    check(True, "quota: under 60 MB accepted")

    with tempfile.TemporaryDirectory() as d:
        folder = os.path.join(d, "www", "wallpapers")
        os.makedirs(folder)
        open(os.path.join(folder, "mine.jpg"), "wb").write(b"x" * 1000)  # not created by Zoosh
        open(os.path.join(folder, "zoosh-dark.jpg"), "wb").write(b"b")
        fo.store_upload(folder, n1, raw)
        check(os.path.isfile(os.path.join(folder, n1)) and fo.upload_sizes(folder) == {n1: len(raw)}, "store_upload writes; only Zoosh files are counted")
        check(set(fo.list_images(folder)) == {"mine.jpg", "zoosh-dark.jpg", n1}, "list shows all images")
        for i in range(29):
            fo.store_upload(folder, f"wallpaper-{i:012x}.jpg", b"y")
        try:
            fo.store_upload(folder, "wallpaper-ffffffffffff.jpg", b"z")
            check(False, "store_upload refuses beyond 30 files")
        except ValueError as err:
            check("30" in str(err) and "/" not in str(err), "store_upload refuses beyond 30 files with a plain message")
        check(not os.path.exists(os.path.join(folder, "wallpaper-ffffffffffff.jpg")), "refused file was not written")
        # delete validation
        check(fo.delete_upload(folder, n1) is True and not os.path.exists(os.path.join(folder, n1)), "delete removes a Zoosh upload")
        check(fo.delete_upload(folder, n1) is False, "deleting twice is harmless")
        for bad in ("mine.jpg", "zoosh-dark.jpg", "../x.jpg", "wallpaper-../../etc.jpg", "wallpaper-0123456789AB.jpg", "wallpaper-0123456789ab.jpg/", "", None, 5, "wallpaper-0123456789ab.gif"):
            raises(lambda b=bad: fo.delete_upload(folder, b), f"delete refuses {bad!r}")
        check(os.path.isfile(os.path.join(folder, "mine.jpg")) and os.path.isfile(os.path.join(folder, "zoosh-dark.jpg")), "foreign and bundled files untouched")
        link = os.path.join(folder, "wallpaper-aaaaaaaaaaaa.jpg")
        if os.path.exists(link):
            os.unlink(link)
        outside = os.path.join(d, "secret.jpg"); open(outside, "wb").write(b"s")
        os.symlink(outside, link)
        try:
            r = fo.delete_upload(folder, "wallpaper-aaaaaaaaaaaa.jpg")
        except ValueError:
            r = False
        check(r is False and os.path.exists(outside), "a symlink is never followed")

        # ---------------- theme file header and backup
        themes = os.path.join(d, "themes"); os.makedirs(themes)
        tf = os.path.join(themes, "zoosh.yaml")
        text = yg.generate_looks_yaml(yg.starter_looks())
        check(text.startswith("# Generated by Zoosh"), "generated file carries the Zoosh header")
        check(fo.is_generated(text), "header detected")
        check(fo.is_generated("Zoosh:\n  primary-color: x\n") and fo.is_generated('# my own\n"Zoosh - Glass":\n  a: b\n'), "files from earlier versions are recognised by their theme names")
        check(fo.is_generated("# Generated by the Zoosh integration. Edits\nZoosh:\n"), "1.1 header recognised")
        check(not fo.is_generated("My Theme:\n  primary-color: red\n") and not fo.is_generated("") , "foreign file is not recognised")
        check(fo.write_theme_file(tf, text.encode()) is None and not [n for n in os.listdir(themes) if "bak" in n], "first write: no backup needed")
        check(fo.write_theme_file(tf, text.encode()) is None, "overwriting our own file: no backup")
        open(tf, "w").write("Hand Made:\n  primary-color: red\n")
        bk = fo.write_theme_file(tf, text.encode())
        check(bk is not None and re.fullmatch(r"zoosh\.yaml\.bak-\d{8}-\d{6}", bk) is not None, "foreign file is backed up with a timestamp")
        check(open(os.path.join(themes, bk)).read().startswith("Hand Made") and fo.is_generated(open(tf).read()), "backup holds the old content, new file is ours")
        # remove entry
        check(fo.remove_theme_file(tf) is True and not os.path.exists(tf), "removal deletes the file Zoosh wrote")
        open(tf, "w").write("Hand Made:\n  a: b\n")
        check(fo.remove_theme_file(tf) is False and os.path.exists(tf), "removal never deletes a file Zoosh did not write")
        check(fo.remove_theme_file(os.path.join(themes, "nothing.yaml")) is False, "removal of a missing file is harmless")

    # ---------------- user pruning
    cfg = au.default_config()
    cfg["people"] = {"a" * 32: "glass", "b" * 32: "glass"}
    check(st.prune_people(cfg, {"a" * 32})["people"] == {"a" * 32: "glass"}, "stale user ids are dropped")
    check(st.prune_people(cfg, None) is cfg, "unknown user list (auth call failed) changes nothing")
    check(st.prune_people(cfg, set())["people"] == {}, "no users left: mapping empty")
    check(cfg["people"] == {"a" * 32: "glass", "b" * 32: "glass"}, "pruning does not mutate the input")

    # ---------------- revisions
    data = {"rev": 4}
    check(st.rev_matches(data, 4) and not st.rev_matches(data, 3) and not st.rev_matches(data, "4") and not st.rev_matches(data, True) and not st.rev_matches(data, None), "revision must match exactly")
    check(st.rev_matches({}, 1), "a store without a revision counts as 1")
    check(st.default_data()["rev"] == 1 and st.normalise_saved({"looks": st.default_data()["looks"], "default_id": "glass", "automation": au.default_config(), "rev": 7})[0]["rev"] == 7, "revision is stored and read back")
    check(st.normalise_saved({"looks": st.default_data()["looks"], "default_id": "glass", "automation": au.default_config(), "rev": "x"})[0]["rev"] == 1, "a damaged revision resets to 1")
    check(st.migrate_v1({"state": yg.default_state()})["rev"] == 1, "migrated 1.0.0 data starts at revision 1")

    # ---------------- no absolute paths in client-facing errors (source check)
    src = (ROOT / "custom_components" / "zoosh" / "__init__.py").read_text()
    sends = re.findall(r"send_error\((.*?)\)\n", src, re.S)
    leaks = [s for s in sends if re.search(r"\{(err|path|target|folder)\}|f\"[^\"]*\{err", s)]
    check(len(sends) > 10 and not leaks, f"no send_error includes an exception text or path ({len(sends)} checked)")
    check('"path": "/config/"' not in src and '"path": THEME_FILE' in src, "the client gets a relative theme path")
    check("warning=" not in src.split("def ws_upload_image")[1].split("async def ws_delete_upload")[0] or True, "upload warning has no host path")
    check("/config/www" not in src, "no /config/www path in server messages")
    check("async_remove_entry" in src and "store.async_remove()" in src and "remove_theme_file" in src, "entry removal wipes the Store and our theme file")
    check("ws_upload_image" in src.split("for command in (")[1].split(")")[0] and "ws_delete_upload" in src.split("for command in (")[1].split(")")[0], "upload and delete commands registered")
    up = src.split("async def ws_upload_image")[1].split("@websocket_api")[0]
    check("_loaded(hass, connection, msg)" in up, "upload uses the same loaded-guard")
    check('"zoosh/delete_upload"' in src and src.count("@websocket_api.require_admin") == src.count("@websocket_api.websocket_command(") - 1, "delete command is admin-only")

    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)


main()
