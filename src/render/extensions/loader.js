/* Rendering adapters for registered extensions. Core race and replay screens use only this API. */
import { dressExtension } from "./party-scene.js";
import { createItMarker } from "./it-marker.js";
import { createCombatScene } from "./combat-scene.js";
import { IT_COLOUR } from "../../game/extensions/tag.js";

/**
 * `extension` is the race's plain `dress` data; a `marker` colour asks for the arrow over one truck (Tag's It, the robber).
 * `update(frame)`, each frame of a race, draws what a mode draws as it runs (Combat's: render/extensions/combat-scene.js);
 * a replay does not call it.
 */
export function createExtensionScene(scene, world, extension) {
  const dressing = dressExtension(scene, world, extension);
  const colour = extension?.marker ?? (extension?.mode === "tag" ? IT_COLOUR : null);
  const marker = colour ? createItMarker(colour) : null;
  if (marker) scene.add(marker.object);
  const running = extension?.mode === "combat" ? createCombatScene(scene) : null;
  return {
    updateMarker(pos, camera, time) { marker?.update(pos, camera, time); },
    update(frame) { running?.update(frame); },
    dispose() { marker?.dispose(); dressing.dispose(); running?.dispose(); },
  };
}
