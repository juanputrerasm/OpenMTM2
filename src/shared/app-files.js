/*
  The files the app is made of (docs/ARCHITECTURE.md, "Without a server").

  The app has no build step, and so no list of its own files. To keep a copy of itself for
  starting without a server it finds them as a browser does: from the page, through every
  stylesheet, script, import and worker the files name. Pure: it is handed each file's text and
  says what that file refers to, so the same walk runs in the page (app/offline.js) and, over
  the repository, in the tests.

  What is followed:
    HTML   <script src>, <link href>, inline module scripts, and the import map (kept, to
           resolve the scripts' bare names)
    JS     static imports and re-exports (the name after `from`, or a bare `import` of a
           name), dynamic imports of a name, and a `URL` made of a name and `import.meta.url`
    CSS    @import and url(...)

  Only names written as plain strings can be followed; tests/app-files.test.mjs sees to it that
  the app has no other kind. A name found in a comment is followed too: at worst a file is
  asked for that is not there, and that is passed over. (Which is why the forms above are not
  spelled out with a quoted name here: the same test keeps the app from asking for such a file.)
*/

/** A static import or re-export, on one line or several: the keyword, no quote or semicolon, then `from` and the name. */
const FROM = /(?<![.\w$])(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/g;
/** An import for its effects alone: the keyword and the name. */
const SIDE_EFFECT = /(?<![.\w$])import\s*(['"])([^'"\n]+)\1/g;
/** A dynamic import of a name. */
const DYNAMIC = /(?<![.\w$])import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
/** A file named against the module's own address: a worker, or anything else that lies beside it. */
const BESIDE = /\bnew\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1/g;
const CSS_URL = /\burl\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const LINK_TAG = /<link\b([^>]*)>/gi;
/** Links that only name a page (for search engines and sharing), not a file the page loads. */
const NAMING_RELS = new Set(["canonical", "alternate", "author", "license", "help", "search"]);
const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

const all = (pattern, text) => Array.from(text.matchAll(pattern), (match) => match[2]);
const attribute = (attributes, name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attributes)?.slice(1).find((v) => v !== undefined) ?? null;

/**
 * What a module refers to: `imports` are module names (a bare one goes through the import map),
 * `urls` are addresses relative to the module.
 */
export function scanJs(text) {
  return { imports: [...new Set([...all(FROM, text), ...all(SIDE_EFFECT, text), ...all(DYNAMIC, text)])], urls: [...new Set(all(BESIDE, text))] };
}

/** The addresses a stylesheet refers to. */
export function scanCss(text) {
  return [...new Set([...all(CSS_IMPORT, text), ...all(CSS_URL, text)])];
}

/**
 * What a page refers to: `urls` (scripts, stylesheets, icons), `imports` (the names its inline
 * module scripts import) and its import map, or null.
 */
export function scanHtml(text) {
  const urls = new Set(), imports = new Set();
  let importMap = null;
  for (const [, attributes] of text.matchAll(LINK_TAG)) {
    const href = attribute(attributes, "href");
    const rels = (attribute(attributes, "rel") ?? "").toLowerCase().split(/\s+/);
    if (href && !rels.some((rel) => NAMING_RELS.has(rel))) urls.add(href);
  }
  for (const [, attributes, body] of text.matchAll(SCRIPT_TAG)) {
    const src = attribute(attributes, "src"), type = (attribute(attributes, "type") ?? "").toLowerCase();
    if (src) urls.add(src);
    else if (type === "importmap") {
      try { importMap = JSON.parse(body); } catch { importMap = null; }
    } else if (type === "module") {
      const found = scanJs(body);
      for (const name of found.imports) imports.add(name);
      for (const url of found.urls) urls.add(url);
    }
  }
  return { urls: [...urls], imports: [...imports], importMap };
}

/** An address a file names, against the file's own: absolute, without its fragment; null unless it is http(s). */
export function resolveUrl(reference, base) {
  let url;
  try { url = new URL(reference, base); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  return url.href;
}

/**
 * The address of a module a script imports. A name that begins with "./", "../" or "/", or is an
 * address already, is taken against the importing file's; any other is a bare name, looked up
 * in the page's import map (the whole name, or the longest entry ending in "/" that it begins
 * with). Null for a bare name the map does not have.
 */
export function resolveImport(name, base, importMap) {
  if (/^(?:\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(name)) return resolveUrl(name, base);
  const imports = importMap?.imports ?? {};
  if (typeof imports[name] === "string") return resolveUrl(imports[name], base);
  let best = null;
  for (const prefix of Object.keys(imports)) {
    if (prefix.endsWith("/") && name.startsWith(prefix) && typeof imports[prefix] === "string" && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? resolveUrl(imports[best] + name.slice(best.length), base) : null;
}

/** What kind of file an address names, by its ending: "html", "js", "css", or "other" (not read for references). */
export function kindOf(url, root) {
  if (url === root) return "html";
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "js";
  if (path.endsWith(".css")) return "css";
  return path.endsWith(".html") || path.endsWith(".htm") ? "html" : "other";
}

/**
 * Every file the app is made of, from its page at `root`.
 *
 * `load(url)` resolves to the file's text, or to null when there is no such file (it is passed
 * over); what it throws stops the walk. It is called once per file, the page first, then up to
 * `concurrency` at a time. Returns the addresses of the files that were there, the page first.
 */
export async function crawl(root, load, { concurrency = 6 } = {}) {
  const seen = new Set([root]), queue = [], found = [];
  let importMap = null;
  const add = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    queue.push(url);
  };
  async function visit(url) {
    const text = await load(url);
    if (text === null || text === undefined) return;
    found.push(url);
    const kind = kindOf(url, root);
    if (kind === "html") {
      const page = scanHtml(text);
      // The first page's import map is the app's: a browser has one per page.
      if (url === root) importMap = page.importMap;
      for (const reference of page.urls) add(resolveUrl(reference, url));
      for (const name of page.imports) add(resolveImport(name, url, importMap));
    } else if (kind === "js") {
      const module = scanJs(text);
      for (const name of module.imports) add(resolveImport(name, url, importMap));
      for (const reference of module.urls) add(resolveUrl(reference, url));
    } else if (kind === "css") {
      for (const reference of scanCss(text)) add(resolveUrl(reference, url));
    }
  }
  await visit(root);
  let failure = null;
  const worker = async () => {
    while (queue.length && !failure) {
      try { await visit(queue.shift()); } catch (error) { failure ??= error; }
    }
  };
  // New files turn up as others are read, so the workers are started again until none are left.
  while (queue.length && !failure) await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  if (failure) throw failure;
  return found;
}
