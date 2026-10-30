"""Shared paths and loaders for the MONSTER.EXE reverse-engineering helpers.

The decompiled output lives in <repo>/re/ (git-ignored, never published). RE_TARGET picks the
executable: mtm2 (the default; output in re/out, game folder ~/games/mtm2 or MTM2_DIR) or mtm1
(output in re/mtm1/out, game folder ~/games/mtm1 or MTM1_DIR) or evo2 (4x4 Evolution 2,
4x42.exe; output in re/evo2/out, game folder ~/games/evo2 or EVO2_DIR) or evo1 (4x4 Evolution,
4x4LE.exe; output in re/evo1/out) or cpr (CART Precision Racing, CART.EXE; output in
re/cpr/out, game folder ~/games/cpr or CPR_DIR) or cp3 (Community Patch 3's 64-bit monster.exe; output
in re/cp3/out, game folder ~/games/mtm2 or CP3_DIR).
"""
import bisect
import json
import os
import re
import struct

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RE_DIR = os.path.join(REPO, "re")
TARGET = os.environ.get("RE_TARGET", "mtm2")
OUT = os.path.join(RE_DIR, "out") if TARGET == "mtm2" else os.path.join(RE_DIR, TARGET, "out")
GAME_DIR = os.path.expanduser(os.environ.get(TARGET.upper() + "_DIR", {"cp3": "~/games/mtm2", "mtm1beta": "~/Downloads/mtm_beta"}.get(TARGET, "~/games/" + TARGET)))
MTM2_DIR = GAME_DIR
EXE = os.path.join(GAME_DIR, {"evo2": "4x42.exe", "evo1": "4x4LE.exe", "cpr": "CART.EXE", "cp3": "monster.exe"}.get(TARGET, "MONSTER.EXE"))


def _image_base():
    """The PE header's ImageBase (0x400000 for the 32-bit games, 0x140000000 for most 64-bit builds)."""
    try:
        with open(EXE, "rb") as f:
            head = f.read(4096)
        pe_at = struct.unpack_from("<I", head, 0x3C)[0]
        magic = struct.unpack_from("<H", head, pe_at + 24)[0]
        return struct.unpack_from("<Q" if magic == 0x20B else "<I", head, pe_at + 24 + (24 if magic == 0x20B else 28))[0]
    except OSError:
        return 0x400000


IMAGE_BASE = _image_base() if TARGET == "cp3" else 0x400000

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


# Watcom builds (4x4 Evolution) name their code AUTO and keep all data in DGROUP.
WATCOM_SECTIONS = {".text": "AUTO", ".rdata": "DGROUP", ".data": "DGROUP"}


def section(name):
    """(start VA, end VA) of a section, by name (MSVC names map to Watcom's when absent)."""
    for want in (name, WATCOM_SECTIONS.get(name)):
        for s in pe().sections:
            if want and s.Name.rstrip(b"\0").decode() == want:
                start = IMAGE_BASE + s.VirtualAddress
                return start, start + max(s.Misc_VirtualSize, s.SizeOfRawData)
    raise KeyError(name)


def thunk_end():
    """End VA of the incremental-link jump table at the start of .text (its start if none)."""
    img, va = image(), section(".text")[0]
    while img[va - IMAGE_BASE] in (0xE9, 0xCC):
        va += 5 if img[va - IMAGE_BASE] == 0xE9 else 1
    return va


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
