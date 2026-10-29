/*
  Inside a worker: a promise rejected with nobody waiting for it never reaches the page on its own (an uncaught
  exception does, as the Worker's error event). This sends it to the page as a "fault" event, which the worker's client
  (shared/worker-client.js) reports (shared/error-report.js).
*/
export function sendWorkerFaults(scope = self) {
  scope.addEventListener("unhandledrejection", (event) => {
    const error = event.reason;
    scope.postMessage({ event: "fault", payload: replyError(error) });
  });
}

/** What a reply carries of an error: its message, name and stack. */
export function replyError(error) {
  return {
    message: error?.message ?? String(error),
    name: error?.name && error.name !== "Error" ? error.name : undefined,
    stack: typeof error?.stack === "string" ? error.stack : undefined,
  };
}
