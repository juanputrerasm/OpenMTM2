import { rampHeightAt } from "../collide/ramp.js";
import { groundHeightAt, groundNormalAt } from "./terrain.js";
import { terrainSurfaceValue } from "./surface.js";
export function createTerrainGround(terrain, surface, weather = 0, waterLevelFt = terrain.waterLevelFt) {
    const snow = weather === 5;
    const ramps = [];
    return {
        height: (x, z) => {
            for (const r of ramps) {
                const h = rampHeightAt(r, x, z);
                if (h !== null)
                    return h;
            }
            return groundHeightAt(terrain, x, z, snow);
        },
        normal: (x, z, out) => groundNormalAt(terrain, x, z, out, snow),
        surface: (x, _y, z) => (surface ? terrainSurfaceValue(terrain, surface, x, z, waterLevelFt, snow) : 200),
        waterLevelFt,
        weather,
        ramps,
    };
}
