#!/bin/sh
# Rebuild the git-ignored reverse-engineering workspace in <repo>/re/ from a retail MTM2 install:
# Ghidra auto-analysis of MONSTER.EXE, a full decompile export, then the derived indexes.
#   MTM2_DIR=~/games/mtm2 tools/re/decompile.sh
# Needs Ghidra (brew install ghidra) and Python 3. Takes a few minutes.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
MTM2_DIR=${MTM2_DIR:-$HOME/games/mtm2}
HEADLESS=${GHIDRA_HEADLESS:-$(brew --prefix ghidra 2>/dev/null)/libexec/support/analyzeHeadless}
mkdir -p "$REPO/re/ghidra" "$REPO/re/out" "$REPO/re/notes"
cp "$MTM2_DIR/MONSTER.EXE" "$REPO/re/ghidra/MONSTER.EXE"
if [ ! -d "$REPO/re/venv" ]; then
  python3 -m venv "$REPO/re/venv"
  "$REPO/re/venv/bin/pip" -q install -r "$HERE/requirements.txt"
fi
if [ -f "$REPO/re/ghidra/proj.gpr" ]; then
  "$HEADLESS" "$REPO/re/ghidra" proj -process MONSTER.EXE -noanalysis \
    -scriptPath "$HERE" -postScript ExportAll.java "$REPO/re/out"
else
  "$HEADLESS" "$REPO/re/ghidra" proj -import "$REPO/re/ghidra/MONSTER.EXE" -max-cpu 8 \
    -scriptPath "$HERE" -postScript ExportAll.java "$REPO/re/out"
fi
"$REPO/re/venv/bin/python" "$HERE/postprocess.py"
