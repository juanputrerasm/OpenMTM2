/*
  The Garage's settings for a CART Precision Racing car (docs/CPR_PHYSICS.md 14.1): the parts of the game's setup
  (`.gar`) that the CPR physics model (OpenPhotex sim/cpr) uses, each as a slider or a choice over the setup's own
  fields and units. A setting for a front or a rear pair writes both corners. Pure, so it runs under Node.
*/
import { CPR_DEFAULT_SETUP, cloneCprSetup, parseCprGarage, writeCprGarage } from "../vendor/openphotex/cpr/garage.js";
import { msg } from "./strings.js";

const DEG = Math.PI / 180;
/** The corners of an axle in the setup's order (FL, FR, RL, RR). */
const AXLE = [[0, 1], [2, 3]];
const pair = (key, axle) => ({
  get: (s) => s[key][AXLE[axle][0]],
  set: (s, v) => { for (const i of AXLE[axle]) s[key][i] = v; },
});
const one = (key, index) => ({ get: (s) => s[key][index], set: (s, v) => { s[key][index] = v; } });
const scalar = (key) => ({ get: (s) => s[key], set: (s, v) => { s[key] = v; } });
/** All four damper settings of an axle together (fast and slow, bump and rebound). */
const DAMPERS = ["dampingFastBump", "dampingSlowBump", "dampingFastRebound", "dampingSlowRebound"];
const dampers = (axle) => ({
  get: (s) => s.dampingSlowBump[AXLE[axle][0]],
  set: (s, v) => { for (const key of DAMPERS) for (const i of AXLE[axle]) s[key][i] = v; },
});

/**
 * The sliders, in the order the Garage lists them: `{ id, label, group, min, max, step, show(v), get, set }`, `get` and
 * `set` on a setup in its own units, `min`..`max` in them too.
 */
export const CPR_GARAGE_SLIDERS = Object.freeze([
  { id: "frontWing", label: msg("Front wing"), group: msg("Wings"), min: 0, max: 30, step: 0.5, show: (v) => `${v.toFixed(1)}°`, ...one("wingAngle", 0) },
  { id: "rearWing", label: msg("Rear wing"), group: msg("Wings"), min: 0, max: 30, step: 0.5, show: (v) => `${v.toFixed(1)}°`, ...one("wingAngle", 1) },
  { id: "frontGurney", label: msg("Front Gurney flap"), group: msg("Wings"), min: 0, max: 1.5, step: 0.25, show: (v) => `${v.toFixed(2)} in`, ...one("gurneyFlapSize", 0) },
  { id: "rearGurney", label: msg("Rear Gurney flap"), group: msg("Wings"), min: 0, max: 1.5, step: 0.25, show: (v) => `${v.toFixed(2)} in`, ...one("gurneyFlapSize", 1) },
  { id: "frontSprings", label: msg("Front springs"), group: msg("Suspension"), min: 6000, max: 36000, step: 300, show: (v) => `${Math.round(v / 12)} lb/in`, ...pair("springRate", 0) },
  { id: "rearSprings", label: msg("Rear springs"), group: msg("Suspension"), min: 6000, max: 36000, step: 300, show: (v) => `${Math.round(v / 12)} lb/in`, ...pair("springRate", 1) },
  { id: "frontDampers", label: msg("Front dampers"), group: msg("Suspension"), min: 0, max: 10, step: 1, show: (v) => String(Math.round(v)), ...dampers(0) },
  { id: "rearDampers", label: msg("Rear dampers"), group: msg("Suspension"), min: 0, max: 10, step: 1, show: (v) => String(Math.round(v)), ...dampers(1) },
  { id: "frontCamber", label: msg("Front camber"), group: msg("Suspension"), min: -5 * DEG, max: 0, step: 0.25 * DEG, show: (v) => `${(v / DEG).toFixed(2)}°`, ...pair("camber", 0) },
  { id: "rearCamber", label: msg("Rear camber"), group: msg("Suspension"), min: -5 * DEG, max: 0, step: 0.25 * DEG, show: (v) => `${(v / DEG).toFixed(2)}°`, ...pair("camber", 1) },
  { id: "brakes", label: msg("Brake bias"), group: msg("Car"), min: 0.4, max: 0.8, step: 0.01, show: (v) => `F${Math.round(v * 100)}/${Math.round((1 - v) * 100)}R`, ...scalar("brakeProportioning") },
  { id: "finalDrive", label: msg("Final drive"), group: msg("Car"), min: 0.8, max: 1.25, step: 0.01, show: (v) => `x${v.toFixed(2)}`, ...scalar("finalDriveRatio") },
  { id: "steering", label: msg("Steering lock"), group: msg("Car"), min: 12 * DEG, max: 26 * DEG, step: 0.5 * DEG, show: (v) => `${(v / DEG).toFixed(1)}°`, ...scalar("steeringLock") },
  { id: "fuel", label: msg("Fuel"), group: msg("Car"), min: 5, max: 40, step: 1, show: (v) => `${Math.round(v)} gal`, ...scalar("fuelAmount") },
]);

/** The choices: the differential and the tire compound, each `{ value, label }`. */
export const CPR_DIFFERENTIALS = Object.freeze([
  { value: 1, label: msg("Limited slip") }, { value: 2, label: msg("Locked") }, { value: 3, label: msg("Open") },
]);
export const CPR_COMPOUNDS = Object.freeze([
  { value: 0, label: msg("Primary") }, { value: 1, label: msg("Alternate") }, { value: 4, label: msg("Rain") },
]);

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * A stored setup brought into shape: every field the setup has, each value a number (from the stock setup where it is
 * not), the sliders' values held to their ranges. Null (the stock setup) stays null.
 */
export function cleanCprSetup(stored) {
  if (!stored || typeof stored !== "object") return null;
  const setup = cloneCprSetup();
  for (const [key, stock] of Object.entries(CPR_DEFAULT_SETUP)) {
    const value = stored[key];
    if (Array.isArray(stock) && key !== "pitStops") {
      if (Array.isArray(value)) stock.forEach((_, i) => { if (finite(value[i])) setup[key][i] = value[i]; });
    } else if (!Array.isArray(stock) && finite(value)) {
      setup[key] = value;
    }
  }
  for (const slider of CPR_GARAGE_SLIDERS) slider.set(setup, Math.max(slider.min, Math.min(slider.max, slider.get(setup))));
  if (!CPR_DIFFERENTIALS.some((d) => d.value === setup.differentialType)) setup.differentialType = CPR_DEFAULT_SETUP.differentialType;
  setup.tireCompound = setup.tireCompound.map((c) => (CPR_COMPOUNDS.some((o) => o.value === c) ? c : 0));
  return setup;
}

/** A setup from a `.gar` file's text, or null when it is not one. */
export function cprSetupFromGar(text) {
  const parsed = parseCprGarage(text);
  return parsed ? cleanCprSetup(parsed) : null;
}

/** A setup as a `.gar` file the game reads. */
export const cprSetupToGar = (setup) => writeCprGarage(setup ?? cloneCprSetup());

/** The stock setup, to change. */
export const stockCprSetup = () => cloneCprSetup();
