import test from "node:test";
import assert from "node:assert/strict";
import { WEATHER_LOOK, WEATHER_NAMES, allowedWeathers, nextWeather, pickWeather, resolveWeather, weatherSkyStem } from "../src/game/weather.js";

test("weather: a track's mask allows weather n with bit n", () => {
  assert.deepEqual(allowedWeathers(65535), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].slice(0, 16).filter((i) => i < WEATHER_NAMES.length));
  assert.deepEqual(allowedWeathers(144), [4, 7], "The Graveyard: rain and night");
  assert.deepEqual(allowedWeathers(1), [0], "Torture Pit: clear only");
  assert.deepEqual(allowedWeathers(0), [0]);
  assert.deepEqual(allowedWeathers(null).length, WEATHER_NAMES.length);
});

test("weather: a choice the track forbids falls back, random stays inside the mask, GOLD cycles through it", () => {
  assert.equal(resolveWeather(5, 144), 4);
  assert.equal(resolveWeather(7, 144), 7);
  assert.equal(pickWeather(144, () => 0.99), 7);
  assert.equal(pickWeather(144, () => 0), 4);
  assert.equal(resolveWeather("random", 1, () => 0.5), 0);
  assert.equal(nextWeather(4, 144), 7);
  assert.equal(nextWeather(7, 144), 4);
  assert.equal(nextWeather(0, 65535), 1);
  assert.equal(nextWeather(8, 65535), 0);
});

test("weather: fog from the code, and a look for every weather", () => {
  assert.equal(WEATHER_LOOK.length, WEATHER_NAMES.length);
  // viewRange 16, k 10/16, 4/16 and 1, 8192 / 256 per unit: 320, 128 and 512 ft.
  assert.deepEqual([2, 3, 5].map((w) => WEATHER_LOOK[w].fogEndFt), [320, 128, 512]);
  assert.deepEqual(WEATHER_LOOK[4].fogColor, [72, 74, 72]);
  assert.deepEqual([6, 7, 8].map((w) => WEATHER_LOOK[w].fogColor.join()), ["0,0,0", "0,0,0", "0,0,0"]);
  assert.deepEqual([6, 7, 8].map((w) => WEATHER_LOOK[w].headlights), [true, true, true]);
  assert.equal(weatherSkyStem(4, "SKY1"), "CCLOUDS");
  assert.equal(weatherSkyStem(0, "SKY1"), "SKY1");
});
