import { test } from "node:test";
import assert from "node:assert/strict";
import { directorySource, fileListSource } from "../src/install/picker.js";

const file = (name, webkitRelativePath = "") => ({ name, webkitRelativePath, size: 1 });

test("fileListSource drops the picked folder's name and ignores case", async () => {
  const source = fileListSource([
    file("POD.INI", "MTM2/POD.INI"),
    file("STARTUP.POD", "MTM2/system/STARTUP.POD"),
  ]);
  assert.equal(source.name, "MTM2");
  assert.equal((await source.getFile("pod.ini")).name, "POD.INI");
  assert.equal((await source.getFile("System\\startup.pod")).name, "STARTUP.POD");
  assert.equal(await source.getFile("missing.pod"), null);
});

/** A fake FileSystemDirectoryHandle tree. */
function dir(name, children) {
  return {
    kind: "directory", name,
    async *entries() { for (const child of children) yield [child.name, child]; },
  };
}
const fileHandle = (name) => ({ kind: "file", name, getFile: async () => ({ name }) });

test("directorySource walks folders without regard to case", async () => {
  const root = dir("mtm2", [fileHandle("POD.INI"), dir("SYSTEM", [fileHandle("Startup.POD")])]);
  const source = directorySource(root);
  assert.equal((await source.getFile("pod.ini")).name, "POD.INI");
  assert.equal((await source.getFile("system/STARTUP.POD")).name, "Startup.POD");
  assert.equal(await source.getFile("system"), null);
  assert.equal(await source.getFile("pod.ini/x"), null);
  assert.equal(await source.getFile("nope/x.pod"), null);
});
