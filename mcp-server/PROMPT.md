# Prompt: servidor MCP "Fuentes Fidedignas"

> **Dónde ejecutarlo:** en **Claude Code** (terminal, app de escritorio o claude.ai/code)
> dentro de un repositorio de GitHub. Es un servidor MCP en TypeScript sin interfaz
> web, así que necesita un entorno que instale paquetes npm, corra tests y
> MCP Inspector y haga commits. Emergent no encaja: genera aplicaciones web con su
> propio stack (React + FastAPI + MongoDB).

---

Construye un servidor MCP en TypeScript con el SDK oficial
(`@modelcontextprotocol/sdk`), listo para producción, llamado `fuentes-mcp`.

## Objetivo

Darle a un agente de IA acceso a **fuentes de información verificables** para que
responda cualquier pregunta con **datos reales, citados y fechados**, y nunca
inventados. El agente debe consultar las fuentes *antes* de usar su propio
conocimiento. Si las fuentes no tienen la respuesta, el servidor lo dice
explícitamente.

## Fuentes (cada una se puede desactivar por variable de entorno)

| Fuente | Tipo | Credencial |
|---|---|---|
| Wikipedia (multi-idioma) | Enciclopedia, con fecha de última revisión | — |
| Wikidata | Datos estructurados (fechas, cifras, relaciones) | — |
| OpenAlex, Crossref | Literatura académica con DOI, citas y revisión por pares | `CONTACT_EMAIL` opcional |
| PubMed (NCBI) | Biomedicina | `NCBI_API_KEY` opcional |
| arXiv | Preprints | — |
| Banco Mundial | Indicadores oficiales por país y año | — |
| GitHub | Repos, código, issues, releases, archivos | `GITHUB_TOKEN` opcional |
| Web: cualquier URL | HTML, PDF, JSON o texto, extraído a texto legible | — |
| Buscador web | Brave Search API o SearXNG propio | `BRAVE_API_KEY` / `SEARXNG_URL` |
| Feeds RSS/Atom | Noticias y blogs oficiales | — |
| Documentos propios | Carpeta local con PDF, DOCX, MD, TXT, HTML, CSV y JSON, indexada con BM25 | `DOCS_DIR` |
| CRM Transfiereloo (opcional) | Contactos, empresas, oportunidades y tareas vía API REST | `CRM_BASE_URL` + `CRM_API_KEY` |

## Tools

**Multifuente y multitarea**
- `investigar(pregunta, fuentes?, max_por_fuente?)`: consulta todas las fuentes
  **en paralelo**, cada una con su timeout. Devuelve los resultados unidos, sin
  duplicados (por DOI o URL) y ordenados por fiabilidad y relevancia, junto con
  un informe de qué fuentes respondieron o fallaron.
- `investigar_lote(preguntas[])`: hasta 10 preguntas en una sola llamada.
- `iniciar_tarea(tipo, ...)`, `consultar_tarea(id)` y `cancelar_tarea(id)`:
  tareas largas en segundo plano (`investigacion_profunda`, `indexar_documentos`)
  con progreso.
- `listar_fuentes()`: qué fuentes están activas y por qué.

**Por fuente**: `buscar_*` paginado + `obtener_*` con el detalle completo.

**Escritura (solo en el CRM)**: desactivada por defecto
(`ALLOW_WRITES=false`). Cuando está activada, se confirma en dos pasos: la
primera llamada devuelve una vista previa y un `token_confirmacion` firmado
(HMAC, expira en 5 min, atado a los argumentos exactos), y solo la segunda
llamada con ese token ejecuta. No existe ninguna tool de borrado.

Cada tool tiene:
- una descripción de **cuándo usarla y cuándo no**;
- entrada validada con **Zod**;
- anotaciones MCP (`readOnlyHint`, `openWorldHint`, `destructiveHint`);
- salida **JSON compacta** donde cada dato trae `fuente`, `url`,
  `fecha_publicacion`/`fecha_actualizacion`, `consultado_en`, `fiabilidad`
  (alta/media/baja) y `motivo_fiabilidad`.

## Requisitos

- Transporte **stdio** y **HTTP streamable**, seleccionable con `MCP_TRANSPORT`.
  En HTTP: autenticación `Bearer` (`MCP_AUTH_TOKEN`), endpoint `/healthz` y
  protección contra DNS rebinding.
- Credenciales **solo** por variables de entorno, documentadas en `.env.example`.
- Errores accionables: código, mensaje y "qué hacer", por ejemplo
  «GitHub 403 por límite de uso: define GITHUB_TOKEN o espera 60 s».
- Solo lectura por defecto; escritura detrás de un flag.
- **Caché LRU con TTL** y **reintentos** con backoff exponencial y jitter,
  respetando `Retry-After`; sin reintentos para errores 4xx.
- Protección **SSRF** en `leer_url`: bloquea IPs privadas o locales y revisa
  cada redirección.
- **Logs JSON a stderr**, nunca a stdout.
- Tests (vitest) para **cada tool** con un `fetch` simulado y un cliente MCP en
  memoria; script para **MCP Inspector**; CI en GitHub Actions; Dockerfile.

## Entregables

Código, README en español con instalación, configuración y el comando exacto
`claude mcp add` (stdio y HTTP), `.env.example` y tests pasando.
