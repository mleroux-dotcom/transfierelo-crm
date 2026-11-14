# fuentes-mcp

Servidor **MCP** (Model Context Protocol) en TypeScript, hecho con el SDK oficial
`@modelcontextprotocol/sdk`. Da a un agente de IA acceso a **fuentes de información
verificables**, para que responda con **datos reales, citados y fechados**, y
consulte las fuentes **antes** de usar su propio conocimiento.

- **Varias fuentes:** Wikipedia, Wikidata, OpenAlex, Crossref, PubMed, arXiv,
  Banco Mundial, GitHub, cualquier URL (HTML, PDF, DOCX, JSON), buscador web
  (Brave o SearXNG), feeds RSS/Atom, documentos propios y CRM Transfiereloo
  (opcional).
- **Multitarea:** búsqueda en paralelo con deduplicación, lotes de preguntas y
  tareas largas en segundo plano.
- **Trazabilidad:** cada dato trae `fuente`, `url`, `fecha_publicacion` /
  `fecha_actualizacion`, `consultado_en`, `fiabilidad` y `motivo_fiabilidad`.
- **Producción:** stdio y HTTP streamable, autenticación Bearer, caché con TTL,
  reintentos con backoff, protección SSRF, logs JSON a stderr, solo lectura por
  defecto, 71 tests, CI y Docker.

> El prompt completo con el que se especificó este servidor está en [`PROMPT.md`](PROMPT.md).

---

## Instalación

### Rápida (recomendada)

Desde la raíz del repositorio:
- **Windows:** doble clic en `INSTALAR-MCP.bat`.
- **macOS / Linux:** ejecuta `./instalar-mcp.sh`.

El instalador:
- compila el servidor;
- lo prueba;
- te pide la configuración opcional;
- lo registra en Claude Code y en Claude Desktop.

Para usarlo sin preguntas: `node scripts/instalar.mjs --si` (toma los valores de las variables de entorno).

### Manual

Requisitos: **Node.js 22 o superior**.

```bash
git clone https://github.com/mleroux-dotcom/transfierelo-crm.git
cd transfierelo-crm/mcp-server
npm ci
npm run build
cp .env.example .env      # opcional: edita las variables que quieras
npm test                  # 71 tests, sin acceso a internet
```

## Registrarlo en Claude Code

### Local (stdio)

Usa la ruta **absoluta** a `dist/index.js`:

```bash
claude mcp add fuentes --scope user \
  -e CONTACT_EMAIL=tu@email.com \
  -e GITHUB_TOKEN=ghp_xxx \
  -e DOCS_DIR=/ruta/a/mis/documentos \
  -- node /ruta/absoluta/transfierelo-crm/mcp-server/dist/index.js
```

Con el CRM y la escritura habilitados:

```bash
claude mcp add fuentes --scope user \
  -e CRM_BASE_URL=https://crm.transfiereloo.cl \
  -e CRM_API_KEY=TU_CRM_API_KEY \
  -e ALLOW_WRITES=true \
  -- node /ruta/absoluta/transfierelo-crm/mcp-server/dist/index.js
```

Todas las variables son opcionales. Sin ninguna, quedan activas Wikipedia,
Wikidata, los papers, el Banco Mundial, GitHub (modo anónimo), `leer_url` y los
feeds.

Para comprobar el registro: `claude mcp list`. Dentro de Claude Code: `/mcp`.

### Remoto (HTTP streamable)

1. Despliega el servidor (ver [Despliegue](#despliegue)) con `MCP_TRANSPORT=http` y `MCP_AUTH_TOKEN`.
2. Regístralo:

```bash
claude mcp add --transport http fuentes https://mcp.tudominio.cl/mcp \
  --header "Authorization: Bearer TU_MCP_AUTH_TOKEN"
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "fuentes": {
      "command": "node",
      "args": ["/ruta/absoluta/transfierelo-crm/mcp-server/dist/index.js"],
      "env": { "CONTACT_EMAIL": "tu@email.com", "DOCS_DIR": "/ruta/a/documentos" }
    }
  }
}
```

---

## Tools

### Multifuente y multitarea

| Tool | Para qué |
|---|---|
| `investigar` | **Primera tool ante cualquier pregunta.** Consulta todas las fuentes activas en paralelo, cada una con su timeout. Elimina duplicados por DOI o URL, ordena por relevancia y fiabilidad e informa qué fuentes respondieron o fallaron. |
| `investigar_lote` | Hasta 10 preguntas a la vez. |
| `iniciar_tarea` | Tareas largas en segundo plano: `investigacion_profunda` (busca, lee el contenido completo de los mejores resultados y sigue trabajos relacionados) e `indexar_documentos`. |
| `consultar_tarea`, `cancelar_tarea` | Avance, resultado o cancelación de una tarea. |
| `listar_fuentes` | Qué fuentes están activas y, si no lo están, por qué. |

### Por fuente

| Fuente | Tools | Credencial |
|---|---|---|
| Wikipedia | `buscar_wikipedia`, `obtener_articulo_wikipedia` | — |
| Wikidata | `consultar_wikidata` (cifras y fechas, con referencias) | — |
| OpenAlex · Crossref · PubMed · arXiv | `buscar_papers`, `obtener_paper` (DOI, `pmid:`, `arxiv:`, `openalex:`) | `CONTACT_EMAIL`, `NCBI_API_KEY` (opcionales) |
| Banco Mundial | `buscar_indicador_banco_mundial`, `datos_banco_mundial` | — |
| GitHub | `buscar_github` (repos, código, issues), `obtener_repo_github`, `obtener_archivo_github` | `GITHUB_TOKEN` (opcional) |
| Web | `leer_url` (HTML, PDF, DOCX, JSON, texto) | — |
| Buscador web | `buscar_web` | `BRAVE_API_KEY` o `SEARXNG_URL` |
| Feeds | `leer_feed` (RSS/Atom) | — |
| Documentos propios | `buscar_documentos` (BM25), `obtener_documento` | `DOCS_DIR` |
| CRM Transfiereloo | `crm_buscar_contactos`, `crm_obtener_contacto`, `crm_buscar_empresas`, `crm_obtener_empresa`, `crm_buscar_oportunidades`, `crm_obtener_oportunidad`, `crm_buscar_tareas`, `crm_resumen_pipeline` | `CRM_BASE_URL` + `CRM_API_KEY` |
| CRM (escritura) | `crm_crear_contacto`, `crm_crear_tarea`, `crm_actualizar_oportunidad`, `crm_completar_tarea` | además, `ALLOW_WRITES=true` |

Una tool solo se registra si su fuente está activa. Así el agente nunca ve tools
que no puede usar.

El servidor también incluye el **prompt** `responder_con_fuentes`, que guía al
agente a investigar primero y citar cada afirmación.

### Formato de salida

```json
{
  "id": "doi:10.1038/s41586-021-03819-2",
  "titulo": "Highly accurate protein structure prediction with AlphaFold",
  "extracto": "Proteins are essential to life…",
  "url": "https://doi.org/10.1038/s41586-021-03819-2",
  "fuente": "openalex",
  "tipo": "paper",
  "autores": ["John Jumper", "…"],
  "fecha_publicacion": "2021-07-15",
  "consultado_en": "2026-11-14T20:36:54.654Z",
  "fiabilidad": "alta",
  "motivo_fiabilidad": "publicación revisada por pares, 25000 citas",
  "datos": { "revista": "Nature", "citas": 25000 }
}
```

### Reglas de fiabilidad

La fiabilidad mide la **procedencia** del dato, no si es verdadero. Las reglas
son fijas (ver `src/evidence.ts`):

| Nivel | Cuándo |
|---|---|
| **alta** | Paper revisado por pares (revista con DOI); estadística oficial; dominio institucional (`.gob`, `.gov`, `.edu`, `who.int`…); documentos propios; CRM. |
| **media** | Wikipedia y Wikidata (colaborativas); preprints; repos con ≥100 estrellas; feeds de medios. |
| **baja** | Web general; repos poco adoptados o archivados; papers retractados. |

---

## Escritura segura (CRM)

- **Desactivada por defecto.** Sin `ALLOW_WRITES=true`, las tools de escritura
  ni siquiera existen.
- **Confirmación en dos pasos:**
  1. La primera llamada no modifica nada. Devuelve una vista previa (incluido
     el antes y después, y los posibles duplicados) y un `token_confirmacion`.
  2. Solo una segunda llamada con los **mismos argumentos** y ese token ejecuta
     la escritura.
- El token es un HMAC atado a la tool y a los argumentos exactos. Expira en 5
  minutos y sirve una sola vez. Si se cambia cualquier dato, deja de valer.
- No existe ninguna tool de borrado.

## Robustez

- **Caché:** LRU con TTL (`CACHE_TTL_SECONDS`). Los catálogos lentos se guardan
  más tiempo; por ejemplo, los indicadores del Banco Mundial, 24 horas. Cada
  escritura en el CRM vacía su caché.
- **Reintentos:** backoff exponencial con jitter ante 408/429/5xx, errores de
  red y timeouts. Se respeta `Retry-After`. Un 4xx no se reintenta.
- **Errores accionables:** siguen el formato
  `ERROR [código] (fuente): qué pasó\nQué hacer: …`.
  Por ejemplo: *"Límite de uso anónimo de GitHub agotado (60/h). Define
  GITHUB_TOKEN para tener 5000/h, o espera."*
- **Degradación parcial:** si una fuente falla, `investigar` sigue con las
  demás e informa el fallo en `fuentes[]`.
- **SSRF:** `leer_url` y `leer_feed` bloquean `localhost`, las IPs privadas y
  link-local (incluida la de metadatos de la nube), los protocolos que no son
  HTTP y las redirecciones hacia cualquiera de esos destinos.
- **Logs:** JSON por **stderr**, nunca por stdout, porque stdout es el canal
  del protocolo. Los secretos se redactan.

---

## Probar con MCP Inspector

```bash
npm run inspector                          # interfaz web del Inspector (stdio)

# Modo CLI:
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name investigar --tool-arg pregunta="vacuna contra la malaria R21"

# Contra el servidor HTTP:
MCP_TRANSPORT=http MCP_AUTH_TOKEN=dev node dist/index.js &
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3333/mcp --transport http \
  --header "Authorization: Bearer dev" --method tools/list
```

## Tests

```bash
npm test          # vitest: 71 tests (cada tool + caché, reintentos, SSRF, tokens, HTTP)
npm run typecheck
```

Los tests usan un `fetch` simulado con respuestas reales de cada API, y un
cliente MCP oficial conectado en memoria (o por HTTP real en `http.test.ts`).
No necesitan internet.

---

## Despliegue

### Docker

```bash
docker build -t fuentes-mcp .
docker run -p 3333:3333 -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
  -e MCP_ALLOWED_HOSTS=mcp.tudominio.cl -e CONTACT_EMAIL=tu@email.com fuentes-mcp
```

### Railway, Render, Fly…

- **Raíz:** `mcp-server/`
- **Build:** `npm ci && npm run build`
- **Start:** `node dist/index.js`
- **Variables:**
  - `MCP_TRANSPORT=http`
  - `MCP_HTTP_HOST=0.0.0.0`
  - `MCP_AUTH_TOKEN=…`
  - `MCP_ALLOWED_HOSTS=<tu dominio>`
- **Healthcheck:** `/healthz`

El puerto se toma de `PORT` (lo inyecta la plataforma) si no defines
`MCP_HTTP_PORT`.

El modo HTTP no guarda sesión (*stateless*): cada petición crea un servidor
ligero que comparte la caché, la cola de tareas y el índice de documentos. Las
tareas en segundo plano viven en la memoria del proceso. Si escalas a varias
réplicas, consulta cada tarea en la misma réplica (*sticky sessions*).

## Arquitectura

```
src/
  index.ts             entrada: carga .env, elige stdio o http
  server.ts            McpServer + instrucciones + prompt; buildDeps()
  http-transport.ts    HTTP streamable (Bearer, Host allowlist, /healthz)
  config.ts            variables de entorno validadas con Zod
  http.ts · cache.ts   cliente HTTP con caché TTL, reintentos, límites, guard SSRF
  evidence.ts          esquema de evidencia + reglas de fiabilidad
  research.ts          investigar (paralelo, dedupe, ranking) + investigación profunda
  tasks.ts             cola de tareas en segundo plano
  confirm.ts           tokens de confirmación HMAC
  sources/             wikipedia, wikidata, papers, worldbank, github, web, documents, crm
  tools/               registro de tools (Zod + anotaciones MCP)
```
