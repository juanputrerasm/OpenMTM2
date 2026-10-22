// The archives OpenMTM2 cannot run without (src/install/required-pods.js).

import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_PODS, isRequiredPod, missingRequiredPods } from "../src/install/required-pods.js";
import { inspectSource } from "../src/install/inspect-source.js";
import { createStrings } from "../src/game/strings.js";

test("the required archives: STARTUP, MUSIC, SOUND, COCKPIT, TRUCK2 and UI, found by file name in any folder and case", () => {
  assert.deepEqual([...REQUIRED_PODS], ["STARTUP.POD", "MUSIC.POD", "SOUND.POD", "COCKPIT.POD", "TRUCK2.POD", "UI.POD"]);
  assert.equal(isRequiredPod("system\\startup.pod"), true);
  assert.equal(isRequiredPod("SYSTEM/TRUCK2.POD"), true);
  assert.equal(isRequiredPod("TPARK.POD"), false);
  assert.deepEqual(missingRequiredPods(["startup.pod", "music.pod", "sound.pod", "cockpit.pod", "truck2.pod", "ui.pod", "tpark.pod"]), []);
  assert.deepEqual(missingRequiredPods(["startup.pod", "ui.pod"]), ["MUSIC.POD", "SOUND.POD", "COCKPIT.POD", "TRUCK2.POD"]);
});

test("a folder whose POD.INI lacks a required archive is refused, one with them all is taken", async () => {
  const folder = (names, listed = names) => {
    const files = new Map(names.map((n) => [n.toUpperCase(), new File([new Uint8Array(4)], n)]));
    files.set("POD.INI", new File([`${listed.length}\r\n${listed.join("\r\n")}\r\n`], "POD.INI"));
    return { name: "MTM2", getFile: async (path) => files.get(String(path).replace(/\\/g, "/").toUpperCase()) ?? null };
  };
  const all = ["startup.pod", "music.pod", "sound.pod", "truck2.pod", "cockpit.pod", "ui.pod", "tpark.pod"];
  const ok = await inspectSource(folder(all));
  assert.equal(ok.ok, true);
  assert.equal(ok.files.length, 7);
  const lacking = await inspectSource(folder(all.filter((n) => n !== "sound.pod")));
  assert.equal(lacking.ok, false);
  assert.equal(lacking.files, undefined);
  assert.deepEqual(lacking.required, ["SOUND.POD"]);
  // The message is a tag with its figures, shown through the message table (game/strings.js).
  assert.match(createStrings()(lacking.message, ...lacking.messageArgs), /SOUND\.POD/);
});
