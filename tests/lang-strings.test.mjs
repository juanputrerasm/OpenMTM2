import test from "node:test";
import assert from "node:assert/strict";
import { appTags, languageRows, placeholders, tagsIn } from "../tools/lang-strings.mjs";

test("the tags are the literals in t(), translate() and msg(), with their quotes and escapes undone", () => {
  const source = [
    `el("p", {}, t("Hall Of Fame")), context.t?.('It\\'s on'), t(\`Line one\\nline two\`)`,
    `const NAMES = [msg("Clear"), msg("Rain")]; translate("Track"); t(name); t(\`\${x} laps\`); t("<<1>>")`,
  ].join("\n");
  assert.deepEqual(tagsIn(source), ["Hall Of Fame", "It's on", "Line one\nline two", "Clear", "Rain", "Track"]);
});

test("the app's tags are found across the source, and each language table is well formed", () => {
  const tags = appTags();
  assert.ok(tags.size > 300, `${tags.size} tags`);
  assert.ok(tags.has("Welcome to OpenMTM2") && tags.has("Circuit Race") && tags.has("Clear"));
  const rows = languageRows("es");
  const seen = new Set();
  for (const row of rows) {
    assert.equal(typeof row.tag, "string");
    assert.equal(typeof row.text, "string");
    assert.ok(!seen.has(row.tag), `${row.tag} twice`);
    seen.add(row.tag);
    // A translation keeps its tag's placeholders, or a figure would go missing or show as <<n>>.
    assert.deepEqual(placeholders(row.text), placeholders(row.tag), row.tag);
  }
});
