/** Points per rule, and the knock-off cooldown in seconds. */
export const SUMMIT_ZONE_POINTS = 10, SUMMIT_KNOCK_OFF = 50, SUMMIT_OFF_POINTS = 1, SUMMIT_COOLDOWN_S = 2;
/** Community Patch 4 2.0.52.4's tick clock: ticks a scoring second, and the knock-off's debounce in ticks. */
export const SUMMIT_TICKS_PER_SECOND = 25, SUMMIT_COOLDOWN_TICKS = 50;
export function createSummit(count, zone, summit, { ticks = false, callsPerTick = 1 } = {}) {
    return {
        zone, summit, ticks, elapsedTicks: 0, callsPerTick: Math.max(1, Math.round(callsPerTick)), calls: 0,
        trucks: Array.from({ length: count }, () => ({ score: 0, state: 0, previous: 0, cooldown: 0, second: 0 })),
    };
}
/** Whether a position is inside a box, ignoring the box's angles. */
function inside(box, pos) {
    return Math.abs(pos[0] - box.pos[0]) < box.half[0]
        && Math.abs(pos[2] - box.pos[2]) < box.half[2]
        && Math.abs(pos[1] - box.pos[1]) < box.half[1];
}
/** One tick for every truck, given each truck's position in the same order. */
export function summitTick(summit, positions, dt) {
    if (summit.ticks) {
        if (++summit.calls >= summit.callsPerTick) {
            summit.calls = 0;
            summitTickCounted(summit, positions);
        }
        return;
    }
    summit.trucks.forEach((t, i) => {
        t.previous = t.state;
        t.cooldown = Math.max(0, t.cooldown - dt);
        t.state = inside(summit.zone, positions[i]) ? 2 : inside(summit.summit, positions[i]) ? 1 : 0;
        if (t.state === 0 && t.previous !== 0 && t.cooldown === 0) {
            t.score -= SUMMIT_KNOCK_OFF;
            t.cooldown = SUMMIT_COOLDOWN_S;
        }
        t.second += dt;
        if (t.second > 1) {
            t.second -= 1;
            if (t.state === 2)
                t.score += SUMMIT_ZONE_POINTS;
            if (t.state === 0)
                t.score -= SUMMIT_OFF_POINTS;
        }
    });
}
/** One physics tick of the tick clock (CP4 2.0.52.4). */
function summitTickCounted(summit, positions) {
    summit.elapsedTicks++;
    summit.trucks.forEach((t, i) => {
        t.previous = t.state;
        if (t.cooldown > 0)
            t.cooldown--;
        t.state = inside(summit.zone, positions[i]) ? 2 : inside(summit.summit, positions[i]) ? 1 : 0;
        if (t.state === 0 && t.previous !== 0 && t.cooldown === 0) {
            t.score -= SUMMIT_KNOCK_OFF;
            t.cooldown = SUMMIT_COOLDOWN_TICKS;
        }
        if (++t.second >= SUMMIT_TICKS_PER_SECOND) {
            t.second = 0;
            if (t.state === 2)
                t.score += SUMMIT_ZONE_POINTS;
            if (t.state === 0)
                t.score -= SUMMIT_OFF_POINTS;
        }
    });
}
