#!/usr/bin/env node
/*
  The app's translatable text, for keeping a language table (assets/lang/<id>.json) up to date.

      node tools/lang-strings.mjs                  how many tags the code has, and each table's gaps
      node tools/lang-strings.mjs --missing es     the tags es.json lacks, as rows to fill in: [{ "tag", "text": "" }]
      node tools/lang-strings.mjs --unused es      the rows of es.json whose tag the code no longer has
      node tools/lang-strings.mjs --list           every tag, with the files that use it

  A tag is the English text in `t("...")` or `translate("...")` (the message table, game/strings.js) or `msg("...")`
  (text kept in a table and translated where it is shown). Only plain literals count: a tag built at run time cannot be found here, so the
  code names each one in full and passes its figures as <<1>>, <<2>>.

  No dependencies; reads the source under src/ (the vendored library left out).
*/
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LITERAL = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`" + String.raw`(?:[^` + "`" + String.raw`\\$]|\\.|\$(?!\{))*` + "`)";
/** `t("...")`, `context.t("...")`, `t?.("...")`, `translate("...")` and `msg("...")`, each with its first argument a literal. */
const CALL = new RegExp(String.raw`(?<![\w$])(?:t|msg|translate)\s*(?:\?\.)?\s*\(\s*` + LITERAL, "g");

/** A JavaScript string literal's text. */
function unquote(literal) {
  const quote = literal[0], body = literal.slice(1, -1);
  if (quote === '"') return JSON.parse(literal);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) => {
    if (e[0] === "u") return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ""), 16));
    if (e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", 0: "\0" }[e] ?? e;
  });
}

/** The tags in one module's source. */
export function tagsIn(source) {
  return [...source.matchAll(CALL)].map((m) => unquote(m[1])).filter((tag) => tag.trim() && !/^<<\d+>>$/.test(tag));
}

/** Every tag of the app, by the files (from the repository's root) that use it. */
export function appTags(root = REPO) {
  const found = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "vendor") walk(path); continue; }
      if (!entry.name.endsWith(".js")) continue;
      for (const tag of tagsIn(readFileSync(path, "utf8"))) {
        if (!found.has(tag)) found.set(tag, new Set());
        found.get(tag).add(relative(root, path));
      }
    }
  };
  walk(join(root, "src"));
  return found;
}

/** A language's table, `[{ tag, text }]`. */
export function languageRows(id, root = REPO) {
  return JSON.parse(readFileSync(join(root, "assets", "lang", `${id}.json`), "utf8"));
}

/** The placeholders a text names, sorted: a translation keeps the tag's. */
export const placeholders = (text) => [...String(text).matchAll(/<<\d+>>/g)].map((m) => m[0]).sort();

function main(args) {
  const tags = appTags();
  const languages = readdirSync(join(REPO, "assets", "lang")).filter((name) => /^[a-z]{2}\.json$/.test(name)).map((name) => name.slice(0, 2));
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] ?? ""); };
  if (args.includes("--list")) {
    for (const [tag, files] of [...tags].sort(([a], [b]) => a.localeCompare(b))) console.log(`${JSON.stringify(tag)}  ${[...files].join(", ")}`);
    return;
  }
  const missingFor = flag("--missing"), unusedFor = flag("--unused");
  if (missingFor !== null || unusedFor !== null) {
    const id = missingFor ?? unusedFor;
    const rows = languageRows(id);
    const have = new Set(rows.map((row) => row.tag));
    const out = missingFor !== null ? [...tags.keys()].filter((tag) => !have.has(tag)).map((tag) => ({ tag, text: "" })) : rows.filter((row) => !tags.has(row.tag));
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  console.log(`${tags.size} tags in the code.`);
  for (const id of languages) {
    const rows = languageRows(id);
    const have = new Set(rows.map((row) => row.tag));
    const missing = [...tags.keys()].filter((tag) => !have.has(tag)).length;
    const unused = rows.filter((row) => !tags.has(row.tag)).length;
    const blank = rows.filter((row) => !String(row.text ?? "").trim()).length;
    const mismatched = rows.filter((row) => placeholders(row.tag).join() !== placeholders(row.text).join()).length;
    console.log(`${id}.json: ${rows.length} rows, ${missing} tags missing, ${unused} unused, ${blank} blank, ${mismatched} with other placeholders than their tag.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
