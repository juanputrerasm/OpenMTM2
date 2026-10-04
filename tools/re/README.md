# MONSTER.EXE reverse-engineering helpers

Tools used to analyse the retail Monster Truck Madness 2 executable (2.00.42) for
`docs/MONSTER_EXE_ANALYSIS.md` and `docs/MTM2_PHYSICS.md`.

The decompiled code, the Ghidra project and working notes live in `re/` at the repository root.
That folder is **git-ignored and must never be published**: it is derived from Microsoft's and
Terminal Reality's code. Only facts, layouts and constants go into the docs and the source.

## Setup

```sh
brew install ghidra
MTM2_DIR=~/games/mtm2 tools/re/decompile.sh
```

This analyses `MONSTER.EXE` from the install, exports every function decompiled to
`re/out/decomp.c` plus `functions.tsv` and `strings.tsv` (with cross-references), and builds the
call graph (`cg.json`) and the per-function string index (`func_strings.txt`). It also creates
`re/venv` with `pefile` and `capstone`. When `re/ghidra/proj.gpr` already exists, only the export
runs again.

## Helpers

Run them with `re/venv/bin/python` from the repository root. Addresses are hexadecimal without
`0x`.

| Script | Does |
|---|---|
| `fn.py 0047dce0 FUN_00470810` | prints decompiled functions by any address inside them or by name |
| `rd.py 618d38` | reads a constant as float, double and int |
| `disasm.py 585da0 0x100` | disassembles from an address |
| `xref.py 585da0` | finds callers through the incremental-link thunks, and pointers to an address |
| `cg.py calls\|callers\|tree FUN_00470810` | queries the call graph |
| `consts.py 467a00 4bb700` | lists the `.rdata` floating-point constants each function in a range uses |
| `postprocess.py` | rebuilds `cg.json` and `func_strings.txt` |
| `ExportAll.java` | the Ghidra post-script behind `decompile.sh` |

## Things to know about this binary

- Every call goes through a 5-byte jump thunk at 0x401000-0x406fff, so Ghidra reports almost
  no callers. Use `xref.py` or `cg.py`.
- Game code is 0x401000-0x5a0000; MFC 4.2 and the C runtime follow.
- Assertion strings name the source files (`D:\METAL\CRUSH2\core\Truck.c`...), which maps
  code ranges to modules.
- The engine passes state through globals: `0x6cef34` current truck, `0x6f6074` current body,
  `0x6cef1c` current axle, `0x6f602c` current tire, `0x6f5d60` the current body-to-world matrix,
  `0x6f1bc8` the substep dt.
