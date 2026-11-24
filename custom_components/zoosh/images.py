# SPDX-License-Identifier: Apache-2.0
"""Pure helpers for wallpaper uploads (no Home Assistant imports).

Uploads are verified, stripped of metadata (EXIF/GPS/XMP/IPTC/comments) and named by a
hash of their content only, so the original file name is never stored.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
import struct
import zlib

# Server-side cap on the decoded image. The websocket message limit (4 MB) is the real
# limit in practice: the panel never sends more than about 2.7 MB of image (3.6 MB base64).
MAX_BYTES = 10 * 1024 * 1024
MAX_B64_LEN = 4 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

UPLOAD_PREFIX = "wallpaper-"
UPLOAD_RE = re.compile(r"wallpaper-[0-9a-f]{12}\.(?:jpg|png|webp)")
MAX_UPLOAD_FILES = 30
MAX_UPLOAD_TOTAL = 60 * 1024 * 1024


def sniff_type(raw: bytes) -> str | None:
    """Return the MIME type from the file's magic bytes, or None."""
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return None


# ------------------------------------------------------------ metadata stripping
_JPEG_KEEP = {0xE0, 0xEE}  # JFIF and Adobe (colour transform): needed to decode correctly
_JPEG_NO_LENGTH = {0x01, 0xD8, 0xD9, *range(0xD0, 0xD8)}


def strip_jpeg(raw: bytes) -> bytes:
    """Drop APP1 (Exif/XMP), APP2 (ICC), APP13 (IPTC), other APPn and COM segments before
    the scan; everything from SOS on is copied unchanged."""
    if raw[:2] != b"\xff\xd8":
        raise ValueError("not a valid JPEG")
    out = bytearray(b"\xff\xd8")
    i, n = 2, len(raw)
    while True:
        if i >= n:
            raise ValueError("JPEG ended before the image data")
        if raw[i] != 0xFF:
            raise ValueError("damaged JPEG")
        while i < n and raw[i] == 0xFF:  # fill bytes
            i += 1
        if i >= n:
            raise ValueError("damaged JPEG")
        marker = raw[i]
        i += 1
        if marker == 0xDA:  # start of scan: the rest is image data
            out += b"\xff\xda" + raw[i:]
            break
        if marker in _JPEG_NO_LENGTH:
            if marker == 0xD9:
                raise ValueError("JPEG has no image data")
            out += bytes((0xFF, marker))
            continue
        if i + 2 > n:
            raise ValueError("damaged JPEG")
        length = struct.unpack(">H", raw[i:i + 2])[0]
        if length < 2 or i + length > n:
            raise ValueError("damaged JPEG segment")
        keep = marker not in range(0xE1, 0xF0) and marker != 0xFE
        if marker in _JPEG_KEEP or keep:
            out += bytes((0xFF, marker)) + raw[i:i + length]
        i += length
    if not raw.rstrip(b"\x00").endswith(b"\xff\xd9"):
        raise ValueError("JPEG is truncated")
    return bytes(out)


_PNG_DROP = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}


def strip_png(raw: bytes) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    if raw[:8] != sig:
        raise ValueError("not a valid PNG")
    out = bytearray(sig)
    i, n = 8, len(raw)
    first = True
    seen_end = False
    while i < n:
        if i + 12 > n:
            raise ValueError("damaged PNG")
        length = struct.unpack(">I", raw[i:i + 4])[0]
        ctype = raw[i + 4:i + 8]
        end = i + 12 + length
        if end > n:
            raise ValueError("damaged PNG chunk")
        if first and ctype != b"IHDR":
            raise ValueError("PNG does not start with IHDR")
        first = False
        crc = struct.unpack(">I", raw[end - 4:end])[0]
        if zlib.crc32(raw[i + 4:end - 4]) & 0xFFFFFFFF != crc:
            raise ValueError("damaged PNG (checksum)")
        if ctype not in _PNG_DROP:
            out += raw[i:end]
        i = end
        if ctype == b"IEND":
            seen_end = True
            break
    if not seen_end or first:
        raise ValueError("PNG is truncated")
    return bytes(out)


def strip_webp(raw: bytes) -> bytes:
    if len(raw) < 20 or raw[:4] != b"RIFF" or raw[8:12] != b"WEBP":
        raise ValueError("not a valid WebP")
    riff = struct.unpack("<I", raw[4:8])[0]
    if riff + 8 > len(raw) or riff < 12:
        raise ValueError("damaged WebP")
    body = raw[12:riff + 8]
    out = bytearray()
    i, n = 0, len(body)
    chunks = 0
    while i < n:
        if i + 8 > n:
            raise ValueError("damaged WebP chunk")
        fourcc = body[i:i + 4]
        size = struct.unpack("<I", body[i + 4:i + 8])[0]
        end = i + 8 + size
        if end > n:
            raise ValueError("damaged WebP chunk")
        pad = size & 1
        if end + pad > n:
            raise ValueError("damaged WebP padding")
        chunk = bytearray(body[i:end + pad])
        i = end + pad
        chunks += 1
        if fourcc in (b"EXIF", b"XMP "):
            continue
        if fourcc == b"VP8X" and size >= 10:
            chunk[8] &= ~0x0C & 0xFF  # clear the "EXIF" and "XMP" flags
        out += chunk
    if not chunks:
        raise ValueError("WebP has no data")
    return b"RIFF" + struct.pack("<I", len(out) + 4) + b"WEBP" + bytes(out)


def strip_metadata(raw: bytes, mime: str) -> bytes:
    """Remove metadata from a verified upload. Raises ValueError if it does not parse."""
    if mime == "image/jpeg":
        return strip_jpeg(raw)
    if mime == "image/png":
        return strip_png(raw)
    if mime == "image/webp":
        return strip_webp(raw)
    raise ValueError("unsupported image type")


def decode_image(data_b64: str, content_type: str) -> tuple[bytes, str]:
    """Decode, verify and strip an upload. Returns (bytes, extension) or raises ValueError."""
    if content_type not in ALLOWED_TYPES:
        raise ValueError("only JPEG, PNG and WebP images are accepted")
    if not isinstance(data_b64, str) or len(data_b64) > MAX_B64_LEN:
        raise ValueError("image is too large (4 MB upload limit)")
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError) as err:
        raise ValueError("image data is not valid base64") from err
    if not raw:
        raise ValueError("image is empty")
    if len(raw) > MAX_BYTES:
        raise ValueError("image is larger than 10 MB")
    detected = sniff_type(raw)
    if detected is None or detected != content_type:
        raise ValueError("file contents do not match an allowed image type")
    return strip_metadata(raw, detected), ALLOWED_TYPES[detected]


def content_name(raw: bytes, ext: str) -> str:
    """wallpaper-<12 hex of the content hash>.<ext>. The original name is never used."""
    return f"{UPLOAD_PREFIX}{hashlib.sha256(raw).hexdigest()[:12]}.{ext}"


def is_upload_name(name: object) -> bool:
    return isinstance(name, str) and UPLOAD_RE.fullmatch(name) is not None


def check_quota(existing: dict[str, int], new_name: str, new_size: int) -> None:
    """existing: {file name: size} of Zoosh uploads. Raises ValueError with a plain message."""
    if new_name in existing:
        return  # same content already stored: nothing is added
    if len(existing) + 1 > MAX_UPLOAD_FILES:
        raise ValueError(f"You already have {MAX_UPLOAD_FILES} uploaded wallpapers. Delete one first.")
    if sum(existing.values()) + new_size > MAX_UPLOAD_TOTAL:
        raise ValueError("Uploaded wallpapers would use more than 60 MB. Delete some first.")
