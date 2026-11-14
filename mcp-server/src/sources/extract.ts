import { SourceError } from "../errors.js";

export async function extractPdf(buf: Buffer): Promise<{ paginas: string[]; titulo?: string; fecha?: string }> {
  try {
    const { getDocumentProxy, extractText, getMeta } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(doc, { mergePages: false });
    let titulo: string | undefined;
    let fecha: string | undefined;
    try {
      const meta: any = await getMeta(doc);
      titulo = meta?.info?.Title || undefined;
      const raw: string | undefined = meta?.info?.CreationDate;
      const m = raw?.match(/D:(\d{4})(\d{2})(\d{2})/);
      if (m) fecha = `${m[1]}-${m[2]}-${m[3]}`;
    } catch {}
    return { paginas: (text as string[]).map((t) => t.replace(/[ \t]+/g, " ").trim()), titulo, fecha };
  } catch (err) {
    throw new SourceError("unsupported", `No se pudo extraer texto del PDF: ${(err as Error).message}`, "Puede estar escaneado (solo imágenes) o dañado; busca otra versión del documento.", false, "pdf");
  }
}

export async function extractDocx(buf: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await (mammoth.default ?? mammoth).extractRawText({ buffer: buf });
    return value.replace(/\n{3,}/g, "\n\n").trim();
  } catch (err) {
    throw new SourceError("unsupported", `No se pudo leer el DOCX: ${(err as Error).message}`, "Verifica que el archivo no esté dañado o protegido.", false, "docx");
  }
}
