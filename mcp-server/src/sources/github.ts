import { SourceError } from "../errors.js";
import { makeEvidencia, pagina, type Evidencia, type Pagina } from "../evidence.js";
import { truncate } from "../text.js";
import { qs, type SourceContext } from "./context.js";

const API = "https://api.github.com";

function gh(ctx: SourceContext, accept = "application/vnd.github+json") {
  const headers: Record<string, string> = { accept, "x-github-api-version": "2022-11-28" };
  if (ctx.cfg.GITHUB_TOKEN) headers.authorization = `Bearer ${ctx.cfg.GITHUB_TOKEN}`;
  return {
    source: "github",
    headers,
    cacheScope: ctx.cfg.GITHUB_TOKEN ? "gh-auth" : "gh-anon",
    hints: {
      401: "GITHUB_TOKEN es inválido o expiró. Genera uno nuevo (permiso de solo lectura basta).",
      403: ctx.cfg.GITHUB_TOKEN
        ? "Límite de uso de GitHub agotado o el token no tiene acceso a ese repositorio. Espera unos minutos o revisa los permisos del token."
        : "Límite de uso anónimo de GitHub agotado (60/h). Define GITHUB_TOKEN para tener 5000/h, o espera.",
      404: "El repositorio, archivo o rama no existe o es privado. Verifica owner/repo/ruta con buscar_github.",
      422: "Consulta de búsqueda inválida para GitHub. Simplifica la consulta (calificadores válidos: language:, user:, repo:, stars:>N).",
    },
  };
}

function repoEvidencia(r: any): Evidencia {
  return makeEvidencia({
    id: `github:${r.full_name}`,
    titulo: r.full_name,
    extracto: r.description ?? "(sin descripción)",
    url: r.html_url,
    fuente: "github",
    tipo: "codigo",
    fecha_publicacion: r.created_at,
    fecha_actualizacion: r.pushed_at ?? r.updated_at,
    datos: { estrellas: r.stargazers_count, lenguaje: r.language, licencia: r.license?.spdx_id, archivado: r.archived, temas: r.topics?.length ? r.topics : undefined, forks: r.forks_count },
    fiab: { tipo: "codigo", estrellas: r.stargazers_count, archivado: r.archived },
  });
}

export const GITHUB_TIPOS = ["repos", "codigo", "issues"] as const;

export async function buscarGithub(ctx: SourceContext, p: { query: string; tipo: (typeof GITHUB_TIPOS)[number]; pagina: number; por_pagina: number }): Promise<Pagina> {
  if (p.pagina * p.por_pagina > 1000) throw new SourceError("invalid_input", "GitHub solo entrega los primeros 1000 resultados de una búsqueda.", "Refina la consulta en vez de paginar más allá.", false, "github");
  const params = qs({ q: p.query, per_page: p.por_pagina, page: p.pagina });
  if (p.tipo === "repos") {
    const { body } = await ctx.http.json<any>(`${API}/search/repositories?${params}`, gh(ctx));
    return pagina((body.items ?? []).map(repoEvidencia), { pagina: p.pagina, por_pagina: p.por_pagina, total: body.total_count, avisos: body.incomplete_results ? ["GitHub devolvió resultados incompletos (timeout interno)."] : undefined });
  }
  if (p.tipo === "codigo") {
    if (!ctx.cfg.GITHUB_TOKEN) throw new SourceError("auth", "La búsqueda de código de GitHub exige autenticación.", "Define GITHUB_TOKEN, o usa tipo 'repos' y luego obtener_archivo_github.", false, "github");
    const { body } = await ctx.http.json<any>(`${API}/search/code?${params}`, gh(ctx, "application/vnd.github.text-match+json"));
    const items = (body.items ?? []).map((it: any) =>
      makeEvidencia({
        id: `github:${it.repository?.full_name}/${it.path}`,
        titulo: `${it.repository?.full_name}: ${it.path}`,
        extracto: truncate((it.text_matches ?? []).map((m: any) => m.fragment).join("\n…\n") || it.name, 800),
        url: it.html_url,
        fuente: "github",
        tipo: "codigo",
        datos: { repo: it.repository?.full_name, ruta: it.path, sha: it.sha },
        fiab: { tipo: "codigo", estrellas: it.repository?.stargazers_count },
      }),
    );
    return pagina(items, { pagina: p.pagina, por_pagina: p.por_pagina, total: body.total_count });
  }
  const { body } = await ctx.http.json<any>(`${API}/search/issues?${params}`, gh(ctx));
  const items = (body.items ?? []).map((it: any) =>
    makeEvidencia({
      id: `github:${String(it.repository_url).replace(`${API}/repos/`, "")}#${it.number}`,
      titulo: `${it.pull_request ? "PR" : "Issue"} #${it.number}: ${it.title}`,
      extracto: truncate(it.body ?? "", 600),
      url: it.html_url,
      fuente: "github",
      tipo: "codigo",
      autores: it.user?.login ? [it.user.login] : undefined,
      fecha_publicacion: it.created_at,
      fecha_actualizacion: it.updated_at,
      datos: { estado: it.state, comentarios: it.comments, etiquetas: (it.labels ?? []).map((l: any) => l.name) },
      fiab: { tipo: "codigo" },
    }),
  );
  return pagina(items, { pagina: p.pagina, por_pagina: p.por_pagina, total: body.total_count });
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
function checkRepo(repo: string) {
  if (!REPO_RE.test(repo)) throw new SourceError("invalid_input", `"${repo}" no es un repositorio válido.`, 'Usa el formato "owner/repo", por ejemplo "modelcontextprotocol/servers".', false, "github");
}

export async function obtenerRepoGithub(ctx: SourceContext, p: { repo: string; max_caracteres_readme: number }) {
  checkRepo(p.repo);
  const { body: r } = await ctx.http.json<any>(`${API}/repos/${p.repo}`, gh(ctx));
  const [readme, release] = await Promise.all([
    ctx.http.text(`${API}/repos/${p.repo}/readme`, { ...gh(ctx, "application/vnd.github.raw+json") }).then((x) => x.body).catch(() => undefined),
    ctx.http.json<any>(`${API}/repos/${p.repo}/releases/latest`, gh(ctx)).then((x) => x.body).catch(() => undefined),
  ]);
  return {
    repo: repoEvidencia(r),
    rama_principal: r.default_branch,
    issues_abiertos: r.open_issues_count,
    ultima_version: release ? { nombre: release.name || release.tag_name, tag: release.tag_name, fecha: release.published_at, url: release.html_url } : undefined,
    readme: readme ? truncate(readme, p.max_caracteres_readme) : undefined,
  };
}

export async function obtenerArchivoGithub(ctx: SourceContext, p: { repo: string; ruta: string; ref?: string; desde_caracter: number; max_caracteres: number }) {
  checkRepo(p.repo);
  const path = p.ruta.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const [{ body }, repoInfo] = await Promise.all([
    ctx.http.json<any>(`${API}/repos/${p.repo}/contents/${path}?${qs({ ref: p.ref })}`, gh(ctx)),
    ctx.http.json<any>(`${API}/repos/${p.repo}`, gh(ctx)).then((x) => x.body).catch(() => undefined),
  ]);
  if (Array.isArray(body)) {
    return { tipo: "directorio" as const, repo: p.repo, ruta: p.ruta, entradas: body.map((e: any) => ({ nombre: e.name, ruta: e.path, tipo: e.type, tamano: e.size })) };
  }
  if (body.type !== "file" || typeof body.content !== "string") {
    throw new SourceError("unsupported", `La ruta es de tipo "${body.type}" y no se puede leer como texto.`, "Indica la ruta de un archivo de texto.", false, "github");
  }
  const full = Buffer.from(body.content, "base64").toString("utf8");
  const lastCommit = await ctx.http
    .json<any[]>(`${API}/repos/${p.repo}/commits?${qs({ path: p.ruta, sha: p.ref, per_page: 1 })}`, gh(ctx))
    .then((x) => x.body?.[0]?.commit?.committer?.date as string | undefined)
    .catch(() => undefined);
  const texto = full.slice(p.desde_caracter, p.desde_caracter + p.max_caracteres);
  const end = p.desde_caracter + texto.length;
  return {
    tipo: "archivo" as const,
    archivo: makeEvidencia({
      id: `github:${p.repo}/${body.path}`,
      titulo: `${p.repo}: ${body.path}`,
      extracto: truncate(full, 300),
      url: body.html_url,
      fuente: "github",
      tipo: "codigo",
      fecha_actualizacion: lastCommit,
      datos: { sha: body.sha, tamano: body.size, ref: p.ref },
      fiab: { tipo: "codigo", estrellas: repoInfo?.stargazers_count, archivado: repoInfo?.archived },
    }),
    texto,
    desde_caracter: p.desde_caracter,
    total_caracteres: full.length,
    ...(end < full.length ? { siguiente_caracter: end } : {}),
  };
}
