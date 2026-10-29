// The Monster Manual (app/manual.js): every topic is reachable and every key table names a real action.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MANUAL } from "../src/app/manual.js";
import { ACTIONS } from "../src/game/input/bindings.js";
import { coveredAt } from "../src/game/ground-maps.js";

test("manual: topics have unique ids, titles and bodies; key tables name bound actions", () => {
  const topics = MANUAL.flatMap((chapter) => chapter.topics);
  assert.equal(new Set(topics.map((x) => x.id)).size, topics.length);
  const actions = new Set(ACTIONS.map((a) => a.id));
  for (const topic of topics) {
    assert.ok(topic.title && topic.body.length, topic.id);
    for (const item of topic.body) for (const [action] of item.keys ?? []) assert.ok(actions.has(action), `${topic.id}: ${action}`);
  }
  // Written for OpenMTM2: nothing of the original's product line or a registry.
  const text = JSON.stringify(MANUAL);
  assert.ok(!/Microsoft|registry|Army Armstrong/i.test(text));
});

test("cover: something over the point is cover; the open sky is not", () => {
  const side = 4, top = new Float32Array(side * side).fill(-1e9);
  top[1 * side + 2] = 50; // the sample at x 2, z 1: 2048 ft squares of an 8192 ft world
  const cover = { side, top };
  assert.equal(coveredAt(cover, 2 * 2048 + 10, 20, 2048 + 10), true);
  assert.equal(coveredAt(cover, 2 * 2048 + 10, 60, 2048 + 10), false);
  assert.equal(coveredAt(cover, 10, 20, 10), false);
  assert.equal(coveredAt(null, 0, 0, 0), false);
});
