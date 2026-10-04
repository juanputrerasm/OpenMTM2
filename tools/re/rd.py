"""Read constants from MONSTER.EXE as float, double and int.

    python3 tools/re/rd.py 618d38 60e4a0
"""
import sys

from recommon import read_values

for q in sys.argv[1:]:
    f, d, i = read_values(int(q, 16))
    print(f"0x{int(q, 16):x}  f={f:g}  d={d:g}  i={i}")
