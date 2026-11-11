/*
  Community Patch 4's physics (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 10 and 11): MTM2's step read through CP4's
  rules, and CP4's triangle collision. Its author published no source code.
*/
export * from "./rules.js";
export * from "./coll-shape.js";
export * from "./truck-tri.js";
export * from "./surface-mesh.js";
export { binCollisionSoup, binBytesCollisionSoup } from "../../model/coll-soup.js";
