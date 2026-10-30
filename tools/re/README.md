# MONSTER.EXE reverse-engineering helpers

Tools used to analyse the retail Monster Truck Madness 2 executable (2.00.42) for
`docs/MONSTER_EXE_ANALYSIS.md` and `docs/MTM2_PHYSICS.md`, and the retail Monster Truck Madness
executable (1.00, 9 August 1996) for `docs/MTM1_MONSTER_EXE_ANALYSIS.md`.

The decompiled code, the Ghidra project and working notes live in `re/` at the repository root.
That folder is **git-ignored and must never be published**: it is derived from Microsoft's and
Terminal Reality's code. Only facts, layouts and constants go into the docs and the source.

## Setup

```sh
brew install ghidra
MTM2_DIR=~/games/mtm2 tools/re/decompile.sh
```

For MTM1: `MTM1_DIR=~/games/mtm1 tools/re/decompile.sh mtm1`, which works in `re/mtm1/` and
leaves the MTM2 workspace alone. The June 1996 MTM1 beta (Beta 2, Build #41; JSTrackViewer's
`docs/MTM1_BETA_EXE_ANALYSIS.md`): `MTM1BETA_DIR=~/Downloads/mtm_beta tools/re/decompile.sh mtm1beta`,
into `re/mtm1beta/`; `match.py` and `fdiff.py` take `MATCH=mtm1beta:mtm1` and `FDIFF=mtm1beta:mtm1`. For 4x4 Evolution 2 (`docs/EVO2_EXE_ANALYSIS.md`):
`EVO2_DIR=~/games/evo2 tools/re/decompile.sh evo2`, into `re/evo2/`, and 4x4 Evolution
(`docs/EVO2_PHYSICS.md` 10, `docs/EVO_MULTIPLAYER.md`): `tools/re/decompile.sh evo1`, into
`re/evo1/`. CART Precision Racing (`docs/CPR_PHYSICS.md`): `CPR_DIR=~/games/cpr tools/re/decompile.sh cpr`,
into `re/cpr/`. Community Patch 3's 64-bit `monster.exe` (`docs/MONSTER_EXE_ANALYSIS.md` 14.5):
`tools/re/decompile.sh cp3`, into `re/cp3/` (game folder `CP3_DIR`, default `~/games/mtm2`); `disasm.py`
reads it as 64-bit code. Its author published no source code. Every helper below reads MTM2 unless `RE_TARGET` is `mtm1`, `evo1`, `evo2`, `cpr` or `cp3`;
`fdiff.py` takes `FDIFF=evo1:evo2` and `match.py` `MATCH=cpr:mtm1` (any two targets).

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
| `FindFuncs.java` | Ghidra post-script: makes functions of the code only reached through tables (MFC message maps, vtables), which auto-analysis leaves out |
| `imm.py c4 a1` | finds instructions carrying a 32-bit immediate (dialog templates, command ids, state numbers) |
| `rsrc.py MONSTER.EXE` | dumps dialogs with their control ids, menus, accelerators and string tables |
| `msgmap.py` | lists every MFC message map: class, entries, command ids and handler addresses |
| `match.py 446cd0 489ca0 468e70 4bb4b0` | pairs the functions of an MTM1 range with their MTM2 counterparts and scores each pair |
| `fdiff.py 44d1e0 470810` | diffs an MTM1 function against an MTM2 one with addresses and variable names blanked (`-k` keeps them) |
| `dconsts.py re/mtm1/out/match_sim.tsv` | compares the tunable `.data` globals used by each matched pair |

## Things to know about the MTM1 binary

- It is not incrementally linked: calls are direct and Ghidra's caller counts are right. A third
  of the code is MFC handlers reached only through message maps, so run `FindFuncs.java`.
- Game code is 0x401000-0x4e0000; the C runtime and MFC follow. There are no assertion strings
  with source paths.
- The simulation (0x446cd0-0x489000) is MTM2's, function for function and in the same order:
  `match.py` and `fdiff.py` read one against the other.
- The engine globals: `0x8143cc` current truck, `0x7d6718` the player's truck, `0x833ae0` the
  truck pointers, `0x836318` the substep dt, `0x839ef4` the race type, `0x7ea4a0` the key
  states by scan code.

## Things to know about this binary

- Every call goes through a 5-byte jump thunk at 0x401000-0x406fff, so Ghidra reports almost
  no callers. Use `xref.py` or `cg.py`.
- Game code is 0x401000-0x5a0000; MFC 4.2 and the C runtime follow.
- Assertion strings name the source files (`D:\METAL\CRUSH2\core\Truck.c`...), which maps
  code ranges to modules.
- The engine passes state through globals: `0x6cef34` current truck, `0x6f6074` current body,
  `0x6cef1c` current axle, `0x6f602c` current tire, `0x6f5d60` the current body-to-world matrix,
  `0x6f1bc8` the substep dt.

## Things to know about the 4x4 Evolution binaries

- `4x42.exe` (Evo 2, 25 September 2001) and `4x4LE.exe` (Evo 1, 16 August 2001) are Watcom
  builds: code in `AUTO`, data in `DGROUP`, no incremental-link thunks, cdecl calls.
  `recommon.section` and `match.Target` map the MSVC section names to those.
- The two compilers produce different text for the same code, so `fdiff.py` across MTM2 and Evo
  is noise; compare constants and read the logic instead. Evo 1 against Evo 2 diffs work, though
  the vehicle struct offsets differ.
- Many float-to-int conversions go through a helper (`0x60fb82`) whose argument Ghidra hides,
  so cell and sector indices often have to be confirmed against the stock data.
- Assertion strings name the modules (`..\core\ground.cpp`, `..\core\sim.cpp`,
  `..\core\particle.cpp`, `..\core\vehicle.cpp`), as in MTM2.
- The simulation keeps state in scratch globals around `0xcad9xx`; `0x67976c` is the
  simulation object (dt at +0x3458) and `0x672fe0` the ground.

## Things to know about CART.EXE

- CART Precision Racing (15 January 1998), MSVC with MFC. Not incrementally linked: calls are direct
  and Ghidra's caller counts are right.
- Assertion strings name the modules (`D:\indy\indy\core\track.cpp`, `Dirt.c`, `simobj.cpp`...), but
  the car simulation itself (0x460000-0x479000) has none; start from `0x463810`, the per-frame step.
- The simulation is not MTM's code: `match.py` against MTM1 pairs almost nothing. Read it.
- The engine globals: `0xb548d8` the car array (stride 0x1aac, count at `0xac7bd8`), `0x63a7f4` the
  player's car, `0xa4518c` the substep dt. World coordinates are integers of 1/256 ft.
