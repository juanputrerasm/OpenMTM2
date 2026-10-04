"""Disassemble MONSTER.EXE from an address (start on an instruction boundary).

    python3 tools/re/disasm.py 585da0 0x100
"""
import sys

import capstone

from recommon import read_bytes

start = int(sys.argv[1], 16)
length = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x100
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
for ins in md.disasm(read_bytes(start, length), start):
    print(f"{ins.address:08x}  {ins.mnemonic} {ins.op_str}")
