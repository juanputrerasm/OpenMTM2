/*
  Extension state over the network (docs/EXTENSIONS.md, "Over the network"): each machine numbers
  its trucks itself (its own player is truck 0), so per-truck values travel keyed by vehicle number
  and are put back in local order on arrival. Pure; no DOM.
*/

/** A per-truck array as `{ vehicle: value }`. */
export const byVehicle = (values, vehicleOf) => Object.fromEntries(values.map((v, i) => [vehicleOf(i), v]));

/** `{ vehicle: value }` back as a per-truck array of `count`, `fill` for trucks not given. */
export function fromVehicles(obj, localOf, count, fill) {
  const out = new Array(count).fill(fill);
  for (const [vehicle, v] of Object.entries(obj ?? {})) {
    const i = localOf(Number(vehicle));
    if (i !== null && i !== undefined && i >= 0 && i < count) out[i] = v;
  }
  return out;
}

/** A truck index as a vehicle number (0 for none), and back (-1 for none). */
export const vehicleIndex = (i, vehicleOf) => (i >= 0 ? vehicleOf(i) ?? 0 : 0);
export function localIndex(vehicle, localOf) {
  if (!vehicle) return -1;
  const i = localOf(vehicle);
  return i === null || i === undefined ? -1 : i;
}
