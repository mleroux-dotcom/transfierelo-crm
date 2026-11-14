#!/usr/bin/env node
// Instalador de fuentes-mcp: compila, prueba el servidor, pregunta la configuración opcional
// y lo registra en Claude Code (y opcionalmente en Claude Desktop). Funciona en Windows, macOS y Linux.
// Uso: node scripts/instalar.mjs        (interactivo)
//      node scripts/instalar.mjs --si   (acepta todo por defecto, sin preguntas)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "dist", "index.js");
const NAME = "fuentes";
const WIN = process.platform === "win32";
const AUTO = process.argv.includes("--si") || !process.stdin.isTTY;

const c = { ok: (s) => `\x1b[32m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, err: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
const step = (n, s) => console.log(`\n${c.b(`[${n}/5]`)} ${s}`);
const fail = (msg) => {
  console.error(`\n${c.err("✖ " + msg)}`);
  process.exit(1);
};

/** Runs a command; on Windows through cmd so npm.cmd/claude.cmd resolve. Arguments are quoted safely. */
function run(cmd, args, opts = {}) {
  if (WIN) {
    for (const a of args) if (/["%^&|<>]/.test(a)) fail(`El valor "${a}" contiene caracteres no permitidos (" % ^ & | < >).`);
    const line = [cmd, ...args.map((a) => (/[\s()]/.test(a) || a === "" ? `"${a}"` : a))].join(" ");
    return spawnSync(line, { cwd: ROOT, stdio: opts.quiet ? "pipe" : "inherit", shell: true, encoding: "utf8" });
  }
  return spawnSync(cmd, args, { cwd: ROOT, stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
}
const has = (cmd) => run(WIN ? "where" : "which", [cmd], { quiet: true }).status === 0;

const rl = AUTO ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
async function ask(q, def = "") {
  if (AUTO) return def;
  const a = (await rl.question(`  ${q}${def ? ` [${def}]` : ""}: `)).trim();
  return a || def;
}
async function yes(q, def = false) {
  const a = (await ask(`${q} (s/n)`, def ? "s" : "n")).toLowerCase();
  return a.startsWith("s") || a.startsWith("y");
}

console.log(c.b("\n=== Instalador de fuentes-mcp ===\n"));

// 1. Node
step(1, "Revisando Node.js");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) fail(`Necesitas Node.js 22 o superior (tienes ${process.versions.node}). Descárgalo en https://nodejs.org`);
console.log(c.ok(`  ✔ Node.js ${process.versions.node}`));

// 2. Dependencias y compilación
step(2, "Instalando dependencias y compilando (puede tardar 1-2 minutos)");
if (run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"]).status !== 0) fail("Falló 'npm ci'. Revisa tu conexión a internet y vuelve a intentarlo.");
if (run("npm", ["run", "build", "--silent"]).status !== 0) fail("Falló la compilación ('npm run build').");
console.log(c.ok("  ✔ Compilado en dist/"));

// 3. Configuración
step(3, "Configuración (Enter = dejar vacío / valor por defecto)");
const env = {};
const email = await ask("Tu email de contacto (mejora el acceso a OpenAlex/Crossref/PubMed; opcional)", process.env.CONTACT_EMAIL ?? "");
if (email) env.CONTACT_EMAIL = email;

let docs = await ask("Carpeta con tus documentos PDF/Word/MD para buscar en ellos (opcional)", process.env.DOCS_DIR ?? "");
while (docs && !fs.existsSync(docs)) {
  console.log(c.warn(`  ! No existe la carpeta "${docs}".`));
  docs = await ask("Carpeta de documentos (Enter para omitir)", "");
}
if (docs) env.DOCS_DIR = path.resolve(docs);

const gh = await ask("Token de GitHub (opcional; permite buscar código y más consultas)", process.env.GITHUB_TOKEN ?? "");
if (gh) env.GITHUB_TOKEN = gh;
const brave = await ask("API key de Brave Search para búsqueda web (opcional, https://brave.com/search/api)", process.env.BRAVE_API_KEY ?? "");
if (brave) env.BRAVE_API_KEY = brave;

if (await yes("¿Conectar tu CRM Transfiereloo?", !!process.env.CRM_API_KEY)) {
  env.CRM_BASE_URL = await ask("URL del CRM", process.env.CRM_BASE_URL ?? "https://crm.transfiereloo.cl");
  env.CRM_API_KEY = await ask("Clave API del CRM (CRM_API_KEY)", process.env.CRM_API_KEY ?? "");
  if (!env.CRM_API_KEY) {
    console.log(c.warn("  ! Sin clave no se puede conectar el CRM; lo omito."));
    delete env.CRM_BASE_URL;
    delete env.CRM_API_KEY;
  } else if (await yes("¿Permitir que Claude cree/actualice registros del CRM? (siempre pedirá tu confirmación)", false)) {
    env.ALLOW_WRITES = "true";
  }
}

// 4. Prueba real del servidor por stdio
step(4, "Probando el servidor");
let toolCount = 0;
try {
  const sdk = path.join(ROOT, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client");
  const { Client } = await import(pathToFileURL(path.join(sdk, "index.js")).href);
  const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, "stdio.js")).href);
  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env: { ...process.env, ...env, LOG_LEVEL: "error" }, stderr: "pipe" });
  const client = new Client({ name: "instalador", version: "1" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  toolCount = tools.length;
  const r = await client.callTool({ name: "listar_fuentes", arguments: {} });
  const fuentes = JSON.parse(r.content[0].text).fuentes;
  await client.close();
  console.log(c.ok(`  ✔ El servidor responde: ${toolCount} herramientas disponibles`));
  console.log(`  Fuentes activas: ${Object.entries(fuentes).filter(([, s]) => s.activa).map(([k]) => k).join(", ")}`);
} catch (err) {
  fail(`El servidor no arrancó: ${err.message}`);
}

// 5. Registro en Claude Code y Claude Desktop
step(5, "Registrando en Claude");
const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
let registered = false;
if (has("claude")) {
  run("claude", ["mcp", "remove", NAME, "--scope", "user"], { quiet: true });
  const r = run("claude", ["mcp", "add", NAME, "--scope", "user", ...envArgs, "--", process.execPath, ENTRY]);
  registered = r.status === 0;
  console.log(registered ? c.ok(`  ✔ Registrado en Claude Code como "${NAME}" (para todos tus proyectos)`) : c.warn("  ! No se pudo registrar en Claude Code."));
} else {
  console.log(c.warn("  ! No encontré Claude Code. Instálalo con:  npm install -g @anthropic-ai/claude-code  y vuelve a ejecutar este instalador."));
}

const desktopDir = WIN ? path.join(process.env.APPDATA ?? "", "Claude") : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "Claude") : path.join(os.homedir(), ".config", "Claude");
if (fs.existsSync(desktopDir) && (await yes("Encontré Claude Desktop. ¿Agregarlo también ahí?", true))) {
  const file = path.join(desktopDir, "claude_desktop_config.json");
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, "utf8"));
      fs.copyFileSync(file, `${file}.respaldo`);
    } catch {
      fail(`No pude leer ${file} (JSON inválido). Corrígelo o bórralo y reintenta.`);
    }
  }
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [NAME]: { command: process.execPath, args: [ENTRY], env } };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  console.log(c.ok("  ✔ Agregado a Claude Desktop (reinícialo para verlo). Respaldo: claude_desktop_config.json.respaldo"));
}
rl?.close();

console.log(c.b("\n=== ¡Listo! ===\n"));
if (registered) {
  console.log("Para usarlo:");
  console.log("  1. Abre una terminal y escribe:  claude");
  console.log(`  2. Escribe  /mcp  y verás "${NAME}" conectado.`);
  console.log('  3. Pregunta, por ejemplo: "Investiga con fuentes cuál es el PIB per cápita de Chile en los últimos 5 años"');
} else {
  console.log("Configuración para pegar manualmente en cualquier cliente MCP:");
  console.log(JSON.stringify({ mcpServers: { [NAME]: { command: process.execPath, args: [ENTRY], env } } }, null, 2));
}
console.log("\nPara cambiar la configuración, vuelve a ejecutar este instalador.\n");
