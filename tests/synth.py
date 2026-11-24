# SPDX-License-Identifier: Apache-2.0
"""Tiny synthetic image files for the tests (valid structure, fake pixel data)."""

from __future__ import annotations

import struct
import zlib


def png_chunk(ctype: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)


def png(extra: list[tuple[bytes, bytes]] | None = None) -> bytes:
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\x10\x20\x30")
    out = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr)
    for t, d in extra or []:
        out += png_chunk(t, d)
    return out + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")


def seg(marker: int, payload: bytes) -> bytes:
    return bytes((0xFF, marker)) + struct.pack(">H", len(payload) + 2) + payload


SCAN = b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00" + b"\x12\x34\x56\xff\x00\x78" + b"\xff\xd9"


def jpeg(extra: list[bytes] | None = None) -> bytes:
    jfif = seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    dqt = seg(0xDB, b"\x00" + bytes(range(64)))
    return b"\xff\xd8" + jfif + b"".join(extra or []) + dqt + SCAN


def webp(chunks: list[tuple[bytes, bytes]] | None = None, vp8x_flags: int | None = None) -> bytes:
    body = b""
    if vp8x_flags is not None:
        body += b"VP8X" + struct.pack("<I", 10) + bytes([vp8x_flags]) + b"\x00\x00\x00" + b"\x00\x00\x00\x00\x00\x00"
    body += b"VP8 " + struct.pack("<I", 6) + b"\x01\x02\x03\x04\x05\x06"
    for t, d in chunks or []:
        pad = b"\x00" if len(d) & 1 else b""
        body += t + struct.pack("<I", len(d)) + d + pad
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + body
