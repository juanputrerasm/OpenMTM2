import test from "node:test";
import assert from "node:assert/strict";
import { addDebugInfo, asError, debugRows, errorKey, explainError, feet, onReport, reportError, resetReports, setErrorSink } from "../src/shared/error-report.js";
import { replyError } from "../src/shared/worker-faults.js";

const quiet = (run) => {
  const error = console.error;
  console.error = () => {};
  try { return run(); } finally { console.error = error; }
};

test("a report carries the error, what the game was doing, the debug rows and the stack", () => {
  resetReports();
  const shown = [];
  setErrorSink((report) => shown.push(report));
  const remove = addDebugInfo("race", () => [["Track", "Tpark (TPARK.SIT)"], ["Truck pos", feet([1, 2.25, -3])], ["Empty", null]]);
  const report = quiet(() => reportError(new TypeError("x is undefined"), { where: "drawing a frame" }));
  remove();
  assert.equal(shown.length, 1);
  assert.equal(shown[0], report);
  assert.match(report.text, /^OpenMTM2 error report \(/);
  assert.match(report.text, /Error: TypeError: x is undefined/);
  assert.match(report.text, /While: drawing a frame/);
  assert.match(report.text, /Track: +Tpark \(TPARK\.SIT\)/);
  assert.match(report.text, /Truck pos: +x 1\.0, y 2\.3, z -3\.0 ft/);
  assert.doesNotMatch(report.text, /Empty/);
  assert.match(report.text, /Stack:\n {2}at /);
  assert.deepEqual(debugRows(), []);
  setErrorSink(null);
});

test("the same error is shown once and counted after; an expected one is not shown", () => {
  resetReports();
  const shown = [];
  setErrorSink((report) => shown.push(report));
  const fail = () => { throw new Error("same"); };
  const catchIt = () => { try { fail(); } catch (error) { return error; } };
  const first = quiet(() => reportError(catchIt()));
  let repeats = 0;
  first.onRepeat = (count) => { repeats = count; };
  assert.equal(reportError(catchIt()), null);
  assert.equal(repeats, 2);
  assert.equal(reportError(Object.assign(new Error("Worker terminated."), { expected: true })), null);
  assert.equal(shown.length, 1);
  setErrorSink(null);
});

test("reports made before the dialog is attached are shown once it is; listeners hear of each", () => {
  resetReports();
  setErrorSink(null);
  const heard = [];
  const stop = onReport((report) => heard.push(report.error.message));
  quiet(() => reportError("early"));
  const shown = [];
  setErrorSink((report) => shown.push(report.error.message));
  assert.deepEqual(shown, ["early"]);
  assert.deepEqual(heard, ["early"]);
  stop();
  setErrorSink(null);
});

test("a provider that throws does not lose the report", () => {
  resetReports();
  const remove = addDebugInfo("broken", () => { throw new Error("no camera"); });
  assert.deepEqual(debugRows(), [["broken", "(could not be read: no camera)"]]);
  remove();
});

test("whatever is thrown becomes an Error; the key is the message and the first place", () => {
  assert.equal(asError("text").message, "text");
  assert.equal(asError(undefined).message, "An unknown error (nothing was thrown)");
  assert.equal(asError({ message: "obj" }).message, "obj");
  const error = Object.assign(new Error("m"), { stack: "Error: m\n    at f (file.js:1:2)\n    at g (file.js:3:4)" });
  assert.equal(errorKey(error), "m|at f (file.js:1:2)");
});

test("the plain explanation follows the kind of failure", () => {
  assert.equal(explainError({ kind: "contextLost", message: "" }).title, "The graphics card stopped drawing the game.");
  assert.equal(explainError({ kind: "stalled", message: "" }).title, "The simulation stopped answering.");
  assert.equal(explainError(new RangeError("Array buffer allocation failed")).title, "The game ran out of memory.");
  assert.equal(explainError(new TypeError("Failed to fetch dynamically imported module: x.js")).title, "Part of the game could not be loaded.");
  assert.equal(explainError(Object.assign(new Error("boom"), { worker: "sim-worker.js" })).title, "A background part of the game failed.");
  assert.equal(explainError(new Error("boom")).title, "Something went wrong in OpenMTM2.");
});

test("a position that is not a number is called invalid, not printed as NaN feet", () => {
  assert.equal(feet([NaN, 1, 2]), "invalid (NaN, 1, 2)");
  assert.equal(feet(null), null);
});

test("a worker's reply keeps the error's name and stack", () => {
  const reply = replyError(Object.assign(new RangeError("bad"), { stack: "RangeError: bad\n    at x (w.js:1:1)" }));
  assert.deepEqual(reply, { message: "bad", name: "RangeError", stack: "RangeError: bad\n    at x (w.js:1:1)" });
  assert.deepEqual(replyError("text"), { message: "text", name: undefined, stack: undefined });
});
