import fs from "node:fs/promises";
import path from "node:path";
import { SourceError } from "../errors.js";
import { makeEvidencia, pagina, type Evidencia, type Pagina } from "../evidence.js";
import type { Logger } from "../logger.js";
import { htmlToText, stemTokens, truncate } from "../text.js";
import { extractDocx, extractPdf } from "./extract.js";

export const DOC_EXTENSIONS = [".md", ".markdown", ".txt", ".rst", ".html", ".htm", ".pdf", ".docx", ".csv", ".tsv", ".json"];
const CHUNK_CHARS = 1500;

interface Chunk {
  id: string;
  file: string; // relative path
  n: number;
  page?: number;
  text: string;
  tf: Map<string, number>;
  len: number;
}

interface FileEntry {
  mtimeMs: number;
  size: number;
  title: string;
  chunks: Chunk[];
  fullText: string;
  pages?: string[];
  error?: string;
}

export interface IndexStats {
  archivos: number;
  fragmentos: number;
  errores: { archivo: string; error: string }[];
  indexado_en?: string;
}

function splitChunks(text: string): string[] {
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > CHUNK_CHARS) {
      out.push(cur.trim());
      cur = "";
    }
    if (p.length > CHUNK_CHARS * 1.5) {
      for (let i = 0; i < p.length; i += CHUNK_CHARS) out.push(p.slice(i, i + CHUNK_CHARS).trim());
      continue;
    }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Local document index with BM25 ranking. Re-syncs incrementally (only changed files are re-read). */
export class DocumentIndex {
  private files = new Map<string, FileEntry>();
  private df = new Map<string, number>();
  private chunkCount = 0;
  private avgLen = 0;
  private lastSync = 0;
  private syncing?: Promise<IndexStats>;
  private indexedAt?: string;

  constructor(
    private readonly root: string,
    private readonly maxFileBytes: number,
    private readonly logger: Logger,
    private readonly minSyncIntervalMs = 30_000,
  ) {}

  private async walk(dir: string, acc: { rel: string; abs: string; mtimeMs: number; size: number }[] = []) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (dir === this.root) throw new SourceError("not_found", `No se puede leer DOCS_DIR (${this.root}): ${(err as Error).message}`, "Verifica que la carpeta exista y tenga permisos de lectura.", false, "documentos");
      return acc;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await this.walk(abs, acc);
      else if (e.isFile() && DOC_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) {
        const st = await fs.stat(abs);
        acc.push({ rel: path.relative(this.root, abs).split(path.sep).join("/"), abs, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
    return acc;
  }

  private async readFile(abs: string, size: number): Promise<{ title: string; text: string; pages?: string[] }> {
    if (size > this.maxFileBytes) throw new Error(`supera el máximo de ${(this.maxFileBytes / 1e6).toFixed(0)} MB (DOCS_MAX_FILE_MB)`);
    const ext = path.extname(abs).toLowerCase();
    const base = path.basename(abs);
    const buf = await fs.readFile(abs);
    if (ext === ".pdf") {
      const pdf = await extractPdf(buf);
      return { title: pdf.titulo || base, text: pdf.paginas.join("\n\n"), pages: pdf.paginas };
    }
    if (ext === ".docx") return { title: base, text: await extractDocx(buf) };
    const raw = buf.toString("utf8");
    if (ext === ".html" || ext === ".htm") {
      const h = htmlToText(raw);
      return { title: h.titulo || base, text: h.texto };
    }
    if (ext === ".md" || ext === ".markdown") {
      const h1 = raw.match(/^#\s+(.+)$/m)?.[1];
      return { title: h1?.trim() || base, text: raw };
    }
    return { title: base, text: raw };
  }

  /** Brings the index up to date with the folder. Concurrent callers share the same run. */
  async sync(force = false, onProgress?: (done: number, total: number) => void): Promise<IndexStats> {
    if (this.syncing) return this.syncing;
    if (!force && Date.now() - this.lastSync < this.minSyncIntervalMs && this.indexedAt) return this.stats();
    this.syncing = (async () => {
      const found = await this.walk(this.root);
      const seen = new Set(found.map((f) => f.rel));
      let changed = false;
      for (const rel of [...this.files.keys()]) if (!seen.has(rel)) (this.files.delete(rel), (changed = true));
      let done = 0;
      for (const f of found) {
        const prev = this.files.get(f.rel);
        if (!force && prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) {
          onProgress?.(++done, found.length);
          continue;
        }
        changed = true;
        try {
          const { title, text, pages } = await this.readFile(f.abs, f.size);
          const chunks: Chunk[] = [];
          const parts: { text: string; page?: number }[] = pages ? pages.flatMap((pg, i) => splitChunks(pg).map((t) => ({ text: t, page: i + 1 }))) : splitChunks(text).map((t) => ({ text: t }));
          parts.forEach((part, n) => {
            const tokens = stemTokens(`${n === 0 ? title + " " : ""}${part.text}`);
            chunks.push({ id: `doc:${f.rel}#${n}`, file: f.rel, n, page: part.page, text: part.text, tf: termFreq(tokens), len: tokens.length });
          });
          this.files.set(f.rel, { mtimeMs: f.mtimeMs, size: f.size, title, chunks, fullText: text, pages });
        } catch (err) {
          this.logger.warn("no se pudo indexar documento", { archivo: f.rel, error: (err as Error).message });
          this.files.set(f.rel, { mtimeMs: f.mtimeMs, size: f.size, title: f.rel, chunks: [], fullText: "", error: (err as Error).message });
        }
        onProgress?.(++done, found.length);
      }
      if (changed || !this.indexedAt) this.rebuildStats();
      this.lastSync = Date.now();
      return this.stats();
    })().finally(() => (this.syncing = undefined));
    return this.syncing;
  }

  private rebuildStats() {
    this.df.clear();
    let total = 0;
    let n = 0;
    for (const f of this.files.values())
      for (const c of f.chunks) {
        n++;
        total += c.len;
        for (const t of c.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
    this.chunkCount = n;
    this.avgLen = n ? total / n : 0;
    this.indexedAt = new Date().toISOString();
  }

  stats(): IndexStats {
    const errores = [...this.files.entries()].filter(([, f]) => f.error).map(([archivo, f]) => ({ archivo, error: f.error! }));
    return { archivos: this.files.size, fragmentos: this.chunkCount, errores, indexado_en: this.indexedAt };
  }

  private evidencia(c: Chunk, extracto: string, score?: number): Evidencia {
    const f = this.files.get(c.file)!;
    return makeEvidencia({
      id: c.id,
      titulo: f.title + (c.page ? ` (pág. ${c.page})` : ""),
      extracto,
      url: `file://${path.join(this.root, c.file)}`,
      fuente: "documentos propios",
      tipo: "documento",
      fecha_actualizacion: new Date(f.mtimeMs).toISOString(),
      datos: { archivo: c.file, fragmento: c.n, ...(c.page ? { pagina: c.page } : {}), ...(score !== undefined ? { puntaje: Number(score.toFixed(3)) } : {}) },
    });
  }

  async search(query: string, p: { pagina: number; por_pagina: number; archivo?: string }): Promise<Pagina> {
    await this.sync();
    const q = [...new Set(stemTokens(query))];
    if (!q.length) throw new SourceError("invalid_input", "La consulta no tiene palabras significativas.", "Usa términos concretos (nombres, conceptos, cifras).", false, "documentos");
    const k1 = 1.2;
    const b = 0.75;
    const scored: { c: Chunk; s: number }[] = [];
    for (const f of this.files.values()) {
      for (const c of f.chunks) {
        if (p.archivo && !c.file.includes(p.archivo)) continue;
        let s = 0;
        for (const t of q) {
          const tf = c.tf.get(t);
          if (!tf) continue;
          const df = this.df.get(t) ?? 0;
          const idf = Math.log(1 + (this.chunkCount - df + 0.5) / (df + 0.5));
          s += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.len) / (this.avgLen || 1)));
        }
        if (s > 0) scored.push({ c, s });
      }
    }
    scored.sort((a, b2) => b2.s - a.s);
    const start = (p.pagina - 1) * p.por_pagina;
    const items = scored.slice(start, start + p.por_pagina).map(({ c, s }) => this.evidencia(c, snippet(c.text, q), s));
    const avisos = !this.files.size ? [`La carpeta ${this.root} no contiene documentos soportados (${DOC_EXTENSIONS.join(", ")}).`] : undefined;
    return pagina(items, { pagina: p.pagina, por_pagina: p.por_pagina, total: scored.length, avisos });
  }

  async get(idOrPath: string, p: { pagina_pdf?: number; desde_caracter: number; max_caracteres: number }) {
    await this.sync();
    const rel = idOrPath.replace(/^doc:/, "").replace(/#\d+$/, "").replace(/^\/+/, "");
    const f = this.files.get(rel);
    if (!f) throw new SourceError("not_found", `No existe el documento "${rel}" en el índice.`, "Usa buscar_documentos para obtener el id exacto (doc:<ruta>#n).", false, "documentos");
    if (f.error) throw new SourceError("unsupported", `El documento no se pudo leer: ${f.error}`, "Revisa el archivo; puede estar dañado, cifrado o ser una imagen escaneada.", false, "documentos");
    let full = f.fullText;
    if (p.pagina_pdf) {
      if (!f.pages) throw new SourceError("invalid_input", "pagina_pdf solo aplica a archivos PDF.", "Omite pagina_pdf para este documento.", false, "documentos");
      full = f.pages[p.pagina_pdf - 1] ?? "";
      if (!full) throw new SourceError("not_found", `El PDF tiene ${f.pages.length} páginas.`, `Usa una página entre 1 y ${f.pages.length}.`, false, "documentos");
    }
    const texto = full.slice(p.desde_caracter, p.desde_caracter + p.max_caracteres);
    const end = p.desde_caracter + texto.length;
    const first = f.chunks[0] ?? { id: `doc:${rel}#0`, file: rel, n: 0, text: "", tf: new Map(), len: 0 };
    return {
      documento: this.evidencia({ ...first, page: p.pagina_pdf }, truncate(full, 300)),
      texto,
      ...(f.pages ? { paginas_pdf: f.pages.length } : {}),
      desde_caracter: p.desde_caracter,
      total_caracteres: full.length,
      ...(end < full.length ? { siguiente_caracter: end } : {}),
    };
  }
}

/** Picks the ~400-char window with the most query-term hits. */
function snippet(text: string, q: string[]): string {
  const W = 400;
  if (text.length <= W) return text;
  // Strip accents char-by-char so indices stay aligned with the original text.
  const lower = text.toLowerCase().replace(/[^\x00-\x7f]/g, (ch) => ch.normalize("NFD")[0] ?? ch);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < text.length; i += 100) {
    const win = lower.slice(i, i + W);
    const sc = q.reduce((acc, t) => acc + (win.includes(t) ? 1 : 0), 0);
    if (sc > bestScore) ((bestScore = sc), (best = i));
  }
  return (best > 0 ? "…" : "") + truncate(text.slice(best, best + W), W);
}
