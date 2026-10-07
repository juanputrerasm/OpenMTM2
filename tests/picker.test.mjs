import { test } from "node:test";
import assert from "node:assert/strict";
import { fileListSource } from "../src/install/picker.js";

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
