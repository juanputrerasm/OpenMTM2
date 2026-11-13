#!/usr/bin/env node
/*
  What keeps objects alive in a heap snapshot (Chrome's .heapsnapshot, as tools/perf-race.mjs --heap saves it).

    node tools/heap-paths.mjs <file.heapsnapshot> <constructor name> [--most <n>]

  Lists the objects of that constructor and, for each, the shortest way to it from the roots: the chain of properties
  and closures that holds it. A race that is over and still has a `Scene` in the heap is held by whatever the chain
  names. Weak references are not followed.
*/
import { readFileSync } from "node:fs";

const [file, wanted] = process.argv.slice(2);
const mostAt = process.argv.indexOf("--most"), most = mostAt > 0 ? Number(process.argv[mostAt + 1]) : 12;
if (!file || !wanted) { console.log("usage: node tools/heap-paths.mjs <file.heapsnapshot> <constructor name> [--most <n>]"); process.exit(1); }
const snapshot = JSON.parse(readFileSync(file, "utf8"));
const meta = snapshot.snapshot.meta, nodes = snapshot.nodes, edges = snapshot.edges, strings = snapshot.strings;
const NF = meta.node_fields.length, EF = meta.edge_fields.length;
const nType = meta.node_fields.indexOf("type"), nName = meta.node_fields.indexOf("name"), nSelf = meta.node_fields.indexOf("self_size"), nEdges = meta.node_fields.indexOf("edge_count");
const eType = meta.edge_fields.indexOf("type"), eName = meta.edge_fields.indexOf("name_or_index"), eTo = meta.edge_fields.indexOf("to_node");
const nodeTypes = meta.node_types[nType], edgeTypes = meta.edge_types[eType];
const count = nodes.length / NF;
// Where each node's edges begin.
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, at = 0; i < count; i++) { firstEdge[i] = at; at += nodes[i * NF + nEdges]; firstEdge[i + 1] = at; }
// Breadth first from the root: each node's parent and the edge that reached it.
const parent = new Int32Array(count).fill(-1), via = new Int32Array(count).fill(-1);
const queue = new Uint32Array(count);
let head = 0, tail = 0;
queue[tail++] = 0; parent[0] = 0;
while (head < tail) {
  const node = queue[head++];
  for (let e = firstEdge[node]; e < firstEdge[node + 1]; e++) {
    const type = edgeTypes[edges[e * EF + eType]];
    if (type === "weak" || type === "shortcut") continue;
    const to = edges[e * EF + eTo] / NF;
    if (parent[to] !== -1) continue;
    parent[to] = node; via[to] = e;
    queue[tail++] = to;
  }
}
const nameOf = (i) => `${strings[nodes[i * NF + nName]]}`.slice(0, 60);
const edgeLabel = (e) => { const type = edgeTypes[edges[e * EF + eType]], v = edges[e * EF + eName]; return type === "element" || type === "hidden" ? `[${v}]` : `${type === "context" ? "(closure) " : ""}${strings[v]}`; };
const found = [];
for (let i = 0; i < count; i++) if (nodeTypes[nodes[i * NF + nType]] === "object" && strings[nodes[i * NF + nName]] === wanted) found.push(i);
console.log(`${found.length} ${wanted} in ${count} nodes`);
const seen = new Map();
for (const i of found) {
  if (parent[i] === -1) continue;
  const steps = [];
  for (let n = i; n !== 0 && steps.length < 40; n = parent[n]) steps.push(`${edgeLabel(via[n])} <- ${nameOf(parent[n])}`);
  const text = steps.join("\n    ");
  seen.set(text, (seen.get(text) ?? 0) + 1);
}
[...seen].sort((a, b) => b[1] - a[1]).slice(0, most).forEach(([text, n]) => console.log(`\n${n} held by:\n    ${text}`));
