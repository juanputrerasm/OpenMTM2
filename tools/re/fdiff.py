"""Diff an MTM1 function against its MTM2 counterpart, addresses and variable names blanked.

    python3 tools/re/fdiff.py 44d1e0 470810          (MTM1 address, MTM2 address)
    python3 tools/re/fdiff.py -k 44d1e0 470810       (keep the global addresses, to name them)
    FDIFF=evo1:evo2 python3 tools/re/fdiff.py 5104e0 559d30   (any two targets)
"""
import difflib
import os
import re
import sys

from match import REPO, Target

keep = sys.argv[1] == "-k"
a1, a2 = (int(x, 16) for x in sys.argv[2 if keep else 1:][:2])
TARGETS = {
    "mtm1": ("mtm1/out", "~/games/mtm1", "MONSTER.EXE"),
    "mtm1beta": ("mtm1beta/out", "~/Downloads/mtm_beta", "MONSTER.EXE"),
    "mtm2": ("out", "~/games/mtm2", "MONSTER.EXE"),
    "evo1": ("evo1/out", "~/games/evo1", "4x4LE.exe"),
    "evo2": ("evo2/out", "~/games/evo2", "4x42.exe"),
    "cpr": ("cpr/out", "~/games/cpr", "CART.EXE"),
}
n1, n2 = os.environ.get("FDIFF", "mtm1:mtm2").split(":")


def target(name):
    out, game, exe = TARGETS[name]
    return Target(os.path.join(REPO, "re", out), os.environ.get(name.upper() + "_DIR", game) + "/" + exe)


t1, t2 = target(n1), target(n2)


def lines(t, a):
    if keep:
        s = t.text.get(a, "").split("\n", 1)[1]
        s = re.sub(r"\bthunk_", "", s)
        raw = [l.strip() for l in s.splitlines() if l.strip()]
    else:
        raw = t.norm(a)
    out, cur = [], ""
    for l in raw:  # one statement per line, whatever Ghidra's wrapping
        cur = (cur + " " + l).strip()
        if cur.endswith((";", "{", "}", ":")):
            out.append(cur)
            cur = ""
    return out + ([cur] if cur else [])


for l in difflib.unified_diff(lines(t1, a1), lines(t2, a2), "%s %x" % (n1, a1), "%s %x" % (n2, a2), n=2, lineterm=""):
    print(l)
