"""Find direct call/jmp references to addresses, following the incremental-link thunks.

Ghidra counts almost no callers in MONSTER.EXE because every call goes through a 5-byte jump
thunk at 0x401000-0x406fff. This scans .text for rel32 calls and jumps instead.

    python3 tools/re/xref.py 46c770 585da0
"""
import struct
import sys

from recommon import IMAGE_BASE, functions, image, owner

TEXT_START, TEXT_END, THUNK_END = 0x1000, 0x207000, 0x407000


def refs(img, target):
    out = []
    text = img[TEXT_START:TEXT_END]
    for i in range(len(text) - 5):
        if text[i] in (0xE8, 0xE9):
            src = IMAGE_BASE + TEXT_START + i
            if src + 5 + struct.unpack_from("<i", text, i + 1)[0] == target:
                out.append((src, text[i]))
    return out


def main(queries):
    img = image()
    rows = functions()
    for q in queries:
        target = int(q, 16)
        found = []
        for src, op in refs(img, target):
            if src < THUNK_END and op == 0xE9 and target >= THUNK_END:
                for s2, _ in refs(img, src):
                    found.append(f"{owner(rows, s2)}@{s2:x} (via thunk {src:x})")
            else:
                found.append(f"{owner(rows, src)}@{src:x}")
        absolute = [IMAGE_BASE + i for i in range(len(img) - 4)
                    if struct.unpack_from("<I", img, i)[0] == target]
        print(f"{q} <- " + ("; ".join(found) or "(no direct calls)"))
        if absolute:
            print("   pointer at " + ", ".join(hex(a) for a in absolute[:20]))


if __name__ == "__main__":
    main(sys.argv[1:])
