/*
  What every multiplayer transport offers (docs/MULTIPLAYER.md). No DOM: runs in the page and
  under Node in tests.

  A transport joins this machine to the others of one game:

    transport.self                    this machine's id (a DirectPlay DPID, or a room member id)
    transport.peers()                 the other ids
    transport.send(to, bytes, opts)   `to` an id, or null for everyone; `opts.reliable` as the
                                      game's guaranteed messages (TCP), otherwise best effort
    transport.on(event, fn)           "message" (from, bytes), "peer" ({ id, name, joined }),
                                      "host" (id), "lost" (reason); returns an unsubscribe
    transport.close()

  Bytes are Uint8Arrays holding one game packet each.
*/

/** A small event hub for transports and sessions: `on(name, fn)` returns its unsubscribe, `emit(name, ...args)`. */
export function createEmitter() {
  const listeners = new Map();
  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    emit(name, ...args) {
      for (const fn of [...(listeners.get(name) ?? [])]) {
        try {
          fn(...args);
        } catch (err) {
          console.error(err);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
