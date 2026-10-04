"""List the .rdata floating-point constants each function in an address range uses.

    python3 tools/re/consts.py 467a00 4bb700
"""
import struct
import sys

import capstone

from recommon import IMAGE_BASE, functions, image

RDATA = (0x607000, 0x63E000)

img = image()
lo, hi = int(sys.argv[1], 16), int(sys.argv[2], 16)
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
md.detail = True
for start, name, size in functions():
    if not lo <= start < hi:
        continue
    code = img[start - IMAGE_BASE:start - IMAGE_BASE + size + 64]
    values = []
    for ins in md.disasm(code, start):
        if ins.address >= start + size:
            break
        if not ins.mnemonic.startswith("f"):
            continue
        for op in ins.operands:
            if (op.type == capstone.x86.X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0
                    and RDATA[0] <= op.mem.disp < RDATA[1]):
                o = op.mem.disp - IMAGE_BASE
                v = struct.unpack("<d", img[o:o + 8])[0] if op.size == 8 else struct.unpack("<f", img[o:o + 4])[0]
                values.append(f"{op.mem.disp:x}={v:.6g}")
    if values:
        print(f"{start:x} {name}: " + " ".join(dict.fromkeys(values)))
