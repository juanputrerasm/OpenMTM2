"""Pair the functions of a code range in MTM1's MONSTER.EXE with their MTM2 counterparts.

MTM2 grew out of MTM1 and the linker kept the order of the functions, so the two ranges align
like two versions of a text. Each function is reduced to a signature (its floating-point
constants, its strings and its size), the two sequences are aligned, and every pair gets a
similarity score from its decompiled text with addresses blanked.

    python3 tools/re/match.py 446cd0 489ca0 468e70 4bb4b0 > re/mtm1/out/match_sim.tsv

MATCH picks the two targets (default mtm1:mtm2), as fdiff.py's FDIFF does:

    MATCH=cpr:mtm1 python3 tools/re/match.py 460000 479000 446cd0 489ca0 > re/cpr/out/match_mtm1.tsv
"""
import difflib
import os
import re
import struct
import sys

import capstone
import pefile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = 0x400000


class Target:
    def __init__(self, out, exe):
        self.pe = pefile.PE(os.path.expanduser(exe), fast_load=True)
        self.img = self.pe.get_memory_mapped_image()
        # MSVC keeps constants in .rdata; Watcom builds (4x4 Evolution) keep all data in DGROUP.
        self.rdata = next((BASE + s.VirtualAddress, BASE + s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData))
                          for s in self.pe.sections if s.Name.startswith((b".rdata", b"DGROUP")))
        self.funcs = []
        with open(os.path.join(out, "functions.tsv")) as f:
            for line in f:
                a, name, size = line.split("\t")[:3]
                if not name.startswith("thunk_"):
                    self.funcs.append((int(a, 16), name, int(size)))
        self.funcs.sort()
        self.text = {}
        with open(os.path.join(out, "decomp.c"), errors="replace") as f:
            for b in re.split(r"(?m)^// ==== ", f.read())[1:]:
                m = re.match(r"(\S+) @ ([0-9a-f]+)", b)
                self.text[int(m.group(2), 16)] = b
        self.md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
        self.md.detail = True

    def consts(self, start, size):
        vals = []
        code = self.img[start - BASE:start - BASE + size]
        for ins in self.md.disasm(code, start):
            if not ins.mnemonic.startswith("f"):
                continue
            for op in ins.operands:
                if (op.type == capstone.x86.X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0
                        and self.rdata[0] <= op.mem.disp < self.rdata[1]):
                    o = op.mem.disp - BASE
                    v = (struct.unpack("<d", self.img[o:o + 8]) if op.size == 8
                         else struct.unpack("<f", self.img[o:o + 4]))[0]
                    vals.append("%.5g" % v)
        return " ".join(dict.fromkeys(vals))

    def norm(self, a):
        t = self.text.get(a, "")
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
        t = re.sub(r"\b(thunk_)?FUN_[0-9a-f]{8}\b", "F", t)
        t = re.sub(r"\b_?DAT_[0-9a-f]{8}(_\d+_)?(\._\d+_\d+_)?", "D", t)
        t = re.sub(r"\b(LAB|s|PTR)_[0-9A-Za-z_]*[0-9a-f]{8}\b", "L", t)
        t = re.sub(r"\b[a-z]+Var\d+\b|\b(local|param|uStack|iStack|auStack|fStack|puStack|unaff|extraout|in)_\w+", "v", t)
        return [l.strip() for l in t.splitlines() if l.strip()]


TARGETS = {
    "mtm1": ("mtm1/out", "~/games/mtm1", "MONSTER.EXE"),
    "mtm1beta": ("mtm1beta/out", "~/Downloads/mtm_beta", "MONSTER.EXE"),
    "mtm2": ("out", "~/games/mtm2", "MONSTER.EXE"),
    "evo1": ("evo1/out", "~/games/evo1", "4x4LE.exe"),
    "evo2": ("evo2/out", "~/games/evo2", "4x42.exe"),
    "cpr": ("cpr/out", "~/games/cpr", "CART.EXE"),
}


def target(name):
    out, game, exe = TARGETS[name]
    return Target(os.path.join(REPO, "re", out), os.environ.get(name.upper() + "_DIR", game) + "/" + exe)


def main(lo1, hi1, lo2, hi2):
    n1, n2 = os.environ.get("MATCH", "mtm1:mtm2").split(":")
    t1, t2 = target(n1), target(n2)
    f1 = [f for f in t1.funcs if lo1 <= f[0] < hi1 and f[2] >= 24]
    f2 = [f for f in t2.funcs if lo2 <= f[0] < hi2 and f[2] >= 24]
    s1 = [t1.consts(a, s) + "|" + str(round(s, -2) if s > 300 else "s") for a, _n, s in f1]
    s2 = [t2.consts(a, s) + "|" + str(round(s, -2) if s > 300 else "s") for a, _n, s in f2]
    n1 = [t1.norm(a) for a, _n, _s in f1]
    n2 = [t2.norm(a) for a, _n, _s in f2]

    def sim(i, j):
        return difflib.SequenceMatcher(None, n1[i], n2[j], autojunk=False).ratio()

    # anchors: longest in-order chain of equal signatures; gaps filled by best text similarity
    sm = difflib.SequenceMatcher(None, s1, s2, autojunk=False)
    pairs, pi, pj = [], 0, 0
    blocks = list(sm.get_matching_blocks())
    for b in blocks:
        gi, gj = list(range(pi, b.a)), list(range(pj, b.b))
        used = set()
        for i in gi:  # greedy in-order fill inside the gap
            best, bj = 0.45, None
            for j in gj:
                if j in used or (used and j < max(used)):
                    continue
                r = sim(i, j)
                if r > best:
                    best, bj = r, j
            if bj is not None:
                used.add(bj)
                pairs.append((i, bj, best))
            else:
                pairs.append((i, None, 0))
        for j in gj:
            if j not in used:
                pairs.append((None, j, 0))
        for k in range(b.size):
            pairs.append((b.a + k, b.b + k, sim(b.a + k, b.b + k)))
        pi, pj = b.a + b.size, b.b + b.size
    print(f"{n1}\tsize\t{n2}\tsize\tsimilarity\tconstants ({n1} | {n2} when different)")
    for i, j, r in pairs:
        a = f"{f1[i][0]:x}\t{f1[i][2]}" if i is not None else "-\t-"
        b = f"{f2[j][0]:x}\t{f2[j][2]}" if j is not None else "-\t-"
        c1 = s1[i].split("|")[0] if i is not None else ""
        c2 = s2[j].split("|")[0] if j is not None else ""
        c = c1 if c1 == c2 else f"{c1} | {c2}"
        print(f"{a}\t{b}\t{r:.2f}\t{c}")


if __name__ == "__main__":
    main(*(int(x, 16) for x in sys.argv[1:5]))
