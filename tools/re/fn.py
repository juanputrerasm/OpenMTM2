"""Print decompiled functions by address (any address inside them) or by Ghidra name.

    python3 tools/re/fn.py 0047dce0 FUN_00470810
"""
import sys

from recommon import decompiled_blocks, functions


def main(queries):
    blocks = decompiled_blocks()
    sizes = {a: s for a, _n, s in functions()}
    for q in queries:
        try:
            va = int(q, 16)
        except ValueError:
            va = None
        for start, name, text in blocks:
            hit = name == q if va is None else start <= va < start + max(sizes.get(start, 1), 1) + 0x10
            if hit:
                print("\n".join(line for line in text.splitlines() if line.strip()))
                if va is not None:
                    break


if __name__ == "__main__":
    main(sys.argv[1:])
