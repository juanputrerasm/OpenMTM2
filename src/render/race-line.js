/*
  Community Patch 3's racing line (`[Game] raceLine`, off by default; CP3_EXE_ANALYSIS.md 3): the course's straights,
  each cut into pieces of 24 ft (at most 64 to a straight), drawn as lines 0.35 ft over the ground under each piece's
  ends, in a Circuit or a Rally only (`FUN_1401463b0`). The game draws only the straights that come within 900 ft of
  the player's truck; the port draws them all, as one mesh, and the fog and the draw distance take the far ones. The
  colour is not traced: the port draws it yellow.
*/
import * as THREE from "three";
import { raceLinePoints } from "../game/race-line.js";

export function createRaceLine(straights, heightAt) {
  const points = raceLinePoints(straights, heightAt);
  const geometry = new THREE.BufferGeometry();
  // Game feet to the scene: z is mirrored.
  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => positions.set([p[0], p[1], -p[2]], i * 3));
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xffd400, fog: true, depthWrite: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = "raceLine";
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  return {
    object: lines,
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
