import { test } from "node:test";
import assert from "node:assert/strict";
import { missingFeatures } from "../src/app/main.js";
import { Router } from "../src/app/router.js";

test("missingFeatures lists what a browser lacks", () => {
  assert.deepEqual(missingFeatures({}), [
    "Web Workers",
    "the Origin Private File System (navigator.storage.getDirectory)",
    "WebGL 2",
  ]);
  const complete = {
    Worker: function Worker() {},
    WebGL2RenderingContext: function WebGL2RenderingContext() {},
    navigator: { storage: { getDirectory() {} } },
  };
  assert.deepEqual(missingFeatures(complete), []);
});

test("Router shows screens, unmounts the previous one and goes back", async () => {
  const log = [];
  const container = { replaceChildren() { log.push("clear"); } };
  const screen = (name) => async () => ({
    default: (_c, _ctx, params) => {
      log.push(`mount ${name} ${JSON.stringify(params)}`);
      return { unmount: () => log.push(`unmount ${name}`) };
    },
  });
  const router = new Router(container, {}, { a: screen("a"), b: screen("b") });
  await router.go("a", { n: 1 });
  await router.go("b");
  await router.back();
  assert.deepEqual(log, [
    "clear", 'mount a {"n":1}',
    "unmount a", "clear", "mount b {}",
    "unmount b", "clear", 'mount a {"n":1}',
  ]);
  await assert.rejects(router.go("missing"), /Unknown screen/);
});
