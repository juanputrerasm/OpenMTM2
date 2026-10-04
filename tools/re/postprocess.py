"""Build the derived indexes from Ghidra's export in re/out/.

- cg.json: call graph through the incremental-link thunks (calls and callers per function)
- func_strings.txt: the strings each function references

    python3 tools/re/postprocess.py
"""
import collections
import json
import os
import re

from recommon import OUT, decompiled_blocks

calls = collections.defaultdict(set)
callers = collections.defaultdict(set)
for _start, name, text in decompiled_blocks():
    if name.startswith("thunk_"):
        continue
    for callee in set(re.findall(r"\b(?:thunk_)?(FUN_[0-9a-f]{8})\s*\(", text)):
        if callee != name:
            calls[name].add(callee)
            callers[callee].add(name)
with open(os.path.join(OUT, "cg.json"), "w") as f:
    json.dump({"calls": {k: sorted(v) for k, v in calls.items()},
               "callers": {k: sorted(v) for k, v in callers.items()}}, f)

by_function = collections.defaultdict(list)
with open(os.path.join(OUT, "strings.tsv"), errors="replace") as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 3:
            continue
        for ref in parts[2].split(","):
            if "@" in ref:
                by_function[ref.split("@")[0]].append(parts[1][:70])
with open(os.path.join(OUT, "func_strings.txt"), "w") as f:
    for fn in sorted(by_function):
        unique = list(dict.fromkeys(by_function[fn]))
        f.write(f"{fn}\t{len(unique)}\t" + " | ".join(unique) + "\n")
print(f"{len(calls)} functions in the call graph, {len(by_function)} with strings")
