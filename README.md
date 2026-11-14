# Transfiereloo

| Carpeta | Qué es |
|---|---|
| [`mcp-server/`](mcp-server/) | **fuentes-mcp**: servidor MCP que da a Claude acceso a fuentes fidedignas (Wikipedia, papers, Banco Mundial, GitHub, web, tus documentos y el CRM) para responder con datos citados y fechados. |
| [`crm/`](crm/) | CRM Transfiereloo (Next.js + SQLite): contactos, empresas, oportunidades y tareas, con API REST. |

## Instalar el MCP en 1 paso

**Requisitos:** [Node.js 22 LTS](https://nodejs.org) y, para usarlo en la terminal, Claude Code (`npm install -g @anthropic-ai/claude-code`).

1. Descarga el repositorio (botón verde **Code → Download ZIP**, o `git clone`) y descomprímelo.
2. Ejecuta el instalador:
   - **Windows:** doble clic en **`INSTALAR-MCP.bat`**
   - **macOS / Linux:** `./instalar-mcp.sh`
3. Responde las preguntas. Todas son opcionales; si das Enter, la omites:
   - tu email de contacto;
   - la carpeta de tus documentos;
   - un token de GitHub;
   - la clave de Brave Search;
   - los datos del CRM.

El instalador hace todo lo demás:
- instala las dependencias y compila;
- **prueba que el servidor responda**;
- lo registra en **Claude Code** y, si lo tienes, en **Claude Desktop**.

**Para usarlo:** abre una terminal y escribe `claude`. Luego escribe `/mcp`: debe aparecer **fuentes** como conectado. Después pregunta lo que quieras, por ejemplo:

> Investiga con fuentes cuál es el PIB per cápita de Chile en los últimos 5 años

Para cambiar la configuración, vuelve a ejecutar el instalador. Los detalles técnicos están en [`mcp-server/README.md`](mcp-server/README.md).
