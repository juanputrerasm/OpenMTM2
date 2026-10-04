/*
  Ramps (MTM2_PHYSICS.md §14.19): wedges standing on their position, rising from the back (-z)
  to the front (+z). Their tops are ground through the height query; the probes keep the
  terrain's normal on them.
*/
import { eulerToMatrix } from "../math.js";
/** A ramp from its SIT record, sized by its model's bounds when it has one. Null without a position. */
export function createRamp(src, bounds = null) {
    if (!src.positionFt)
        return null;
    let length, width, height;
    if (bounds) {
        width = bounds.max[0] - bounds.min[0];
        height = bounds.max[1] - bounds.min[1];
        length = bounds.max[2] - bounds.min[2];
    }
    else {
        [length, width, height] = src.sizeFt ?? [0, 0, 0];
    }
    const matrix = new Float64Array(9);
    eulerToMatrix(src.theta, src.phi, src.psi, matrix);
    return {
        pos: [src.positionFt[0], src.positionFt[1], src.positionFt[2]], width, length, height,
        radius: Math.sqrt(height * height + (width / 2) ** 2 + (length / 2) ** 2),
        sinPsi: Math.sin(src.psi), cosPsi: Math.cos(src.psi), matrix,
    };
}
/** The ramp's top under (x, z), or null when the point is outside its footprint (`0x54feb0`). */
export function rampHeightAt(r, x, z) {
    const dx = r.pos[0] - x, dz = r.pos[2] - z;
    if (!(Math.abs(dx) <= r.radius && Math.abs(dz) <= r.radius))
        return null;
    const u = r.cosPsi * dx - r.sinPsi * dz;
    const v = r.cosPsi * dz + r.sinPsi * dx;
    if (!(-r.width * 0.5 <= u && u <= r.width * 0.5 && -r.length * 0.5 <= v && v <= r.length * 0.5))
        return null;
    return ((r.length - (r.length * 0.5 + v)) * r.height) / r.length + r.pos[1];
}
