/*
  When the announcer speaks. Each frame the race screen hands over what the simulation reports;
  this turns changes in it into events `{ group, args, priority }` for the announcer
  (game/commentary.js). The triggers are the port's, from what the phrases are about; the game's
  own are not traced. Drivers are numbered from 1 in the entrants' order, the player first.
  Pure, so it runs under Node.
*/

const AIR_SECONDS = 1.2, FLIPPED_SECONDS = 2, AIR_CLEARANCE_FT = 16, CLASH_FT = 32;

/**
 * @param {{ drivers: number, player?: number, summit?: boolean }} options
 * @returns {{ update(frame: object): { group: string, args: number[], priority: number }[] }}
 *   `frame`: `{ now, race: { started, countdown, over, trucks: [{ place, finished, missed }] }, trucks: [{ pos, up, sound: { airborne, clearance, impact, splash, heli } }] }`
 */
export function createCommentaryWatcher({ drivers, player = 0, summit = false }) {
  const me = player + 1;
  let intro = false, go = false, place = null, lastPlaceAt = -1e9;
  let airTime = 0, flippedTime = 0, wasHeli = false, wasMissed = false, finishedSeen = new Set(), winnerSaid = false;
  let lastNow = null;

  return {
    update(frame) {
      const { now, race, trucks } = frame;
      const dt = lastNow === null ? 0 : Math.max(0, now - lastNow);
      lastNow = now;
      const events = [];
      const mine = trucks[player];
      if (!race || !mine) return events;

      // The start: an intro while the lights are red, GO as they turn green.
      if (!intro) { intro = true; events.push({ group: summit ? "introSummit" : "introRace", args: [], priority: 5 }); }
      if (race.started && !go) { go = true; events.push({ group: "go", args: [], priority: 5 }); }
      if (!race.started) return events;

      // Places: the player gaining, or losing, a place.
      const now1 = race.trucks[player].place;
      if (place !== null && now1 !== place && now - lastPlaceAt > 6) {
        const other = (target) => race.trucks.findIndex((t, i) => i !== player && t.place === target) + 1;
        if (now1 < place) {
          if (now1 === 1) events.push({ group: "takeLead", args: [me], priority: 3 });
          else events.push({ group: "pass", args: [me, other(now1 + 1) || undefined].filter((x) => x !== undefined), priority: 2 });
        } else {
          const passer = other(place);
          if (passer) events.push({ group: place === 1 ? "takeLead" : "pass", args: place === 1 ? [passer] : [passer, me], priority: 2 });
        }
        lastPlaceAt = now;
      }
      place = now1;

      // The player's truck.
      const s = mine.sound;
      if (s) {
        const near = trucks.findIndex((t, i) => i !== player && Math.hypot(t.pos[0] - mine.pos[0], t.pos[2] - mine.pos[2]) < CLASH_FT);
        if (s.impact > 3500 && near >= 0) events.push({ group: "clash", args: [me, near + 1], priority: 2 });
        else if (s.impact > 14000) events.push({ group: "wipeout", args: [me], priority: 2 });
        airTime = s.airborne === 4 && s.clearance > AIR_CLEARANCE_FT ? airTime + dt : 0;
        if (airTime > AIR_SECONDS) { events.push({ group: "air", args: [me], priority: 1 }); airTime = 0; }
        if (s.splash) events.push({ group: "water", args: [me], priority: 1 });
        flippedTime = mine.up < 0.2 ? flippedTime + dt : 0;
        if (flippedTime > FLIPPED_SECONDS) { events.push({ group: "flipped", args: [me], priority: 2 }); flippedTime = 0; }
        if (s.heli && !wasHeli) events.push({ group: "helicopter", args: [me], priority: 2 });
        wasHeli = !!s.heli;
      }
      const missed = !!race.trucks[player].missed;
      if (missed && !wasMissed && !summit) events.push({ group: "missedCheckpoint", args: [me], priority: 4 });
      wasMissed = missed;

      // Finishes: the winner, then everyone else who finishes (the player's own gets the line).
      if (!summit) {
        race.trucks.forEach((t, i) => {
          if (!t.finished || finishedSeen.has(i)) return;
          finishedSeen.add(i);
          if (!winnerSaid) {
            winnerSaid = true;
            events.push({ group: "finishWinner", args: [i + 1, i + 1], priority: 6 });
          } else if (i === player) {
            events.push({ group: "hasFinished", args: [me], priority: 5 });
          }
        });
      }
      return events;
    },
  };
}
