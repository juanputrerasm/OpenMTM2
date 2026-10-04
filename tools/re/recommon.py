"""Shared paths and loaders for the MONSTER.EXE reverse-engineering helpers.

The decompiled output lives in <repo>/re/ (git-ignored, never published). The game folder
defaults to ~/games/mtm2 and can be changed with the MTM2_DIR environment variable.
"""
import bisect
import json
import os
import re
import struct

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RE_DIR = os.path.join(REPO, "re")
OUT = os.path.join(RE_DIR, "out")
MTM2_DIR = os.path.expanduser(os.environ.get("MTM2_DIR", "~/games/mtm2"))
EXE = os.path.join(MTM2_DIR, "MONSTER.EXE")
IMAGE_BASE = 0x400000

_pe = None


def pe():
    """The parsed executable (pefile), loaded once."""
    global _pe
    if _pe is None:
        import pefile
        _pe = pefile.PE(EXE, fast_load=True)
    return _pe


def image():
    """The memory-mapped image; index with (va - IMAGE_BASE)."""
    return pe().get_memory_mapped_image()


def read_bytes(va, n):
    return pe().get_data(va - IMAGE_BASE, n)


def read_values(va):
    """The 8 bytes at va read as float, double and int."""
    b = read_bytes(va, 8)
    return struct.unpack("<f", b[:4])[0], struct.unpack("<d", b)[0], struct.unpack("<i", b[:4])[0]


def functions():
    """Sorted list of (address, name, size) from Ghidra's export."""
    rows = []
    with open(os.path.join(OUT, "functions.tsv")) as f:
        for line in f:
            a, name, size, _callers, _callees = line.rstrip("\n").split("\t")
            rows.append((int(a, 16), name, int(size)))
    rows.sort()
    return rows


def owner(rows, va):
    """Name of the function containing va."""
    starts = [r[0] for r in rows]
    i = bisect.bisect_right(starts, va) - 1
    return rows[i][1] if i >= 0 else "?"


def decompiled_blocks():
    """Sorted list of (address, name, text) of every decompiled function."""
    with open(os.path.join(OUT, "decomp.c"), errors="replace") as f:
        src = f.read()
    blocks = []
    for b in re.split(r"(?m)^// ==== ", src)[1:]:
        m = re.match(r"(\S+) @ ([0-9a-f]+)", b)
        blocks.append((int(m.group(2), 16), m.group(1), "// ==== " + b))
    blocks.sort()
    return blocks


def call_graph():
    with open(os.path.join(OUT, "cg.json")) as f:
        return json.load(f)
