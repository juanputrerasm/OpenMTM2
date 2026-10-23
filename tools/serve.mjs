#!/usr/bin/env node
/*
  A development server for OpenMTM2, with what a headset needs (docs/VR.md, "Running it on a
  headset"). No dependencies.

      node tools/serve.mjs                         the game at http://localhost:8080/
      node tools/serve.mjs --game ~/games/mtm2     and your install at /game/, for "Install from this server"
      node tools/serve.mjs --lan --game <folder>   reachable from other devices, over HTTPS

  Why not `python3 -m http.server`: that works for a desktop browser, and with `adb reverse` for
  a headset on a cable. This adds two things. `--game` serves your own MTM2 folder beside the
  app, so a headset's browser can install from it without a folder picker (names are matched
  without regard to case, as the game's POD.INI needs). `--lan` listens on the network with
  HTTPS, which browsers demand before they allow WebXR and private storage on anything but
  localhost; it makes a self-signed certificate with `openssl` (or takes `--cert` and `--key`),
  kept outside the repository. The headset's browser will warn about the certificate once.
  `--lan --http` listens on the network without it, for a browser that has been told to trust
  this address (Chromium's flag "Insecure origins treated as secure").

  A headset needs this once. Its browser keeps the installed game and, by a service worker, the
  app as well (docs/ARCHITECTURE.md, "Without a server"); afterwards the same address opens the
  game there with no server. That works where the address is localhost (the cable), not behind
  this server's own certificate.

  Nothing from the game folder is copied anywhere: it is read where it lies and sent to whoever
  asks, so use `--lan` only on a network you trust.
*/
import { execFileSync } from "node:child_process";
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ini": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
});
/** What the app itself is made of; nothing else in the repository is served. */
const APP_PATHS = Object.freeze(["index.html", "sw.js", "manifest.webmanifest", "icons", "src", "styles"]);

/** `--name value` and `--flag` arguments. */
export function parseArgs(argv) {
  const options = { port: 8080, lan: false, https: false, http: false, game: null, cert: null, key: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
      return argv[++i];
    };
    if (arg === "--port") options.port = Number(value());
    else if (arg === "--game") options.game = resolve(value());
    else if (arg === "--cert") options.cert = resolve(value());
    else if (arg === "--key") options.key = resolve(value());
    else if (arg === "--lan") options.lan = true;
    else if (arg === "--https") options.https = true;
    else if (arg === "--http") options.http = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument "${arg}".`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("--port needs a port number.");
  if (!!options.cert !== !!options.key) throw new Error("--cert and --key go together.");
  if (options.http && (options.https || options.cert)) throw new Error("--http does not go with --https or a certificate.");
  // The network gets HTTPS unless told otherwise: without it a browser refuses WebXR and private storage.
  if ((options.lan && !options.http) || options.cert) options.https = true;
  return options;
}

/**
 * The file under `base` that a URL path names, or null. Each part is matched exactly, then
 * without regard to case when `anyCase` is set. Parts that would leave `base` are refused.
 * The parts are compared with the folder's own names, not looked up: a file system that ignores
 * case (macOS's, Windows') would otherwise find "MAIN.JS" for main.js.
 */
export function resolveUnder(base, urlPath, anyCase = false) {
  let at = base;
  for (const part of urlPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." || part.includes(sep) || part.includes("\0")) return null;
    let names;
    try { names = readdirSync(at); } catch { return null; }
    const match = names.includes(part) ? part : anyCase ? names.find((name) => name.toLowerCase() === part.toLowerCase()) : undefined;
    if (!match) return null;
    at = join(at, match);
  }
  try {
    return statSync(at).isFile() ? at : null;
  } catch {
    return null;
  }
}

/** The file a request path names: the app's own files, or the game folder under /game/. */
export function fileFor(pathname, { root = ROOT, game = null } = {}) {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  if (path.startsWith("/game/")) return game ? resolveUnder(game, path.slice("/game/".length), true) : null;
  if (path.endsWith("/")) path += "index.html";
  const first = path.split("/").find(Boolean);
  if (!APP_PATHS.includes(first)) return null;
  return resolveUnder(root, path);
}

function handler(options) {
  return (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const { pathname } = new URL(request.url, "http://localhost");
    // The game folder's own address answers, so the app can tell with one request that a game is served here.
    if (pathname === "/game/" && options.game) {
      const note = "A Monster Truck Madness 2 folder is served here.\n";
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-length": Buffer.byteLength(note), "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : note);
      return;
    }
    const file = fileFor(pathname, options);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found.\n");
      return;
    }
    const { size } = statSync(file);
    response.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": size,
      // The app has no build step: a stale module would break the others it is loaded with.
      "cache-control": "no-store",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  };
}

/** This machine's addresses on the network. */
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
}

/** A self-signed certificate for localhost and this machine's addresses, made once per set of addresses. */
function devCertificate(addresses) {
  const dir = join(process.env.XDG_CACHE_HOME || join(os.homedir(), ".cache"), "openmtm2");
  const key = join(dir, "dev-key.pem"), cert = join(dir, "dev-cert.pem"), names = join(dir, "dev-cert.names");
  const wanted = ["DNS:localhost", "IP:127.0.0.1", ...addresses.map((a) => `IP:${a}`)].join(",");
  if (!existsSync(cert) || !existsSync(key) || !existsSync(names) || readFileSync(names, "utf8") !== wanted) {
    mkdirSync(dir, { recursive: true });
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825", "-keyout", key, "-out", cert,
        "-subj", "/CN=OpenMTM2 development", "-addext", `subjectAltName=${wanted}`,
      ], { stdio: "ignore" });
    } catch {
      throw new Error("Could not make a certificate: `openssl` is needed for --lan (or pass --cert and --key).");
    }
    chmodSync(key, 0o600);
    // Written last: its presence says the pair is complete and whom it names.
    writeFileSync(names, wanted);
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const HELP = `Usage: node tools/serve.mjs [--port 8080] [--game <MTM2 folder>] [--lan] [--https | --http] [--cert <pem> --key <pem>]

  --game   serve your own Monster Truck Madness 2 folder (the one holding POD.INI) at /game/,
           so the Install screen can copy it without a folder picker
  --lan    listen on the network, over HTTPS (for a headset on Wi-Fi)
  --https  HTTPS on localhost too
  --http   with --lan: plain HTTP on the network, for a browser told to trust this address
`;

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.game && !resolveUnder(options.game, "POD.INI", true) && !resolveUnder(options.game, "SYSTEM/POD.INI", true)) {
    console.error(`${options.game} has no POD.INI: give --game the folder Monster Truck Madness 2 is installed in.`);
    process.exit(2);
  }
  const addresses = lanAddresses();
  const listener = handler(options);
  let server;
  try {
    server = options.https
      ? https.createServer(options.cert ? { cert: readFileSync(options.cert), key: readFileSync(options.key) } : devCertificate(addresses), listener)
      : http.createServer(listener);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  server.on("error", (error) => {
    console.error(error.code === "EADDRINUSE" ? `Port ${options.port} is in use; pick another with --port.` : error.message);
    process.exit(1);
  });
  server.listen(options.port, options.lan ? "0.0.0.0" : "127.0.0.1", () => {
    const scheme = options.https ? "https" : "http";
    console.log(`OpenMTM2 at ${scheme}://localhost:${options.port}/`);
    if (options.lan) for (const a of addresses) console.log(`         and ${scheme}://${a}:${options.port}/${options.https ? "   (accept the certificate warning once)" : ""}`);
    if (options.lan && !options.https) {
      console.log("Plain HTTP on the network: a browser allows WebXR and private storage there only for an address it is told to trust");
      console.log("(in a Chromium browser: chrome://flags, \"Insecure origins treated as secure\").");
    }
    if (options.game) console.log(`Game folder ${options.game} at /game/ (the Install screen offers "Install from this server").`);
    if (!options.lan) {
      console.log(`A headset on a USB cable reaches it as localhost after:  adb reverse tcp:${options.port} tcp:${options.port}`);
      console.log("Once the game is installed there, the browser keeps the app too: the same address then opens it with no cable and no server.");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
