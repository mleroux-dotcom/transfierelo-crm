# Mi CRM

CRM sencillo para gestionar **contactos, empresas, oportunidades (pipeline) y tareas**, con una **API REST** para conectarlo con Emergent u otras herramientas.

- Next.js 15 + React 19
- Base de datos SQLite integrada en Node (archivo `data/crm.db`, no hay que instalar ningún servidor)
- Login con contraseña para la web y clave API para integraciones

---

## ⚡ Lo más fácil (Windows)

1. Descomprime la carpeta `mi-crm` donde quieras (por ejemplo en Documentos).
2. Haz **doble clic en `PUBLICAR.bat`**.
3. Se abrirá el navegador para entrar en **Railway**. Si no tienes cuenta, se crea ahí mismo con Google o GitHub. Acepta.
4. Espera unos 3–5 minutos. Al terminar se abrirá tu CRM y el archivo **`CREDENCIALES.txt`** con la URL, la contraseña y la clave API.
5. Abre **`EMERGENT.txt`**: tiene el texto listo para pegar en Emergent, ya con tu URL y tu clave.

Tus claves ya están generadas en el archivo `.env`. Si quieres cambiarlas, edítalo antes del paso 2.

Para usarlo solo en tu PC (sin internet): doble clic en **`INICIAR-LOCAL.bat`**.

Para **guardar el código fuente** en un repositorio privado de tu GitHub: doble clic en **`GUARDAR-EN-GITHUB.bat`**. Tus claves (`.env`) no se suben. Vuelve a ejecutarlo cada vez que cambies algo.

Para subir una nueva versión del código, vuelve a hacer doble clic en `PUBLICAR.bat`. Los datos se conservan.

---

## 🌐 Enlace con transfiereloo.cl

**1. El CRM en tu dominio: `https://crm.transfiereloo.cl`**

`PUBLICAR.bat` conecta el dominio indicado en `CRM_DOMINIO` (en `.env`) y abre **`DNS-DOMINIO.txt`** con el registro que debes crear. Normalmente es un **CNAME** con nombre `crm` apuntando a `xxxx.up.railway.app`. Lo creas en el panel donde gestionas el DNS de transfiereloo.cl (NIC Chile, Cloudflare o tu hosting). Se usa un subdominio para que tu web actual no se toque.

**2. Formularios de la web → CRM**

Pega el contenido de **`web/formulario-transfiereloo.html`** en tu página de contacto: un bloque "HTML personalizado" en WordPress, "Insertar código" en Wix, o directamente en el HTML. Cada envío:
- crea un contacto con estado **lead** (si el email ya existe, añade el mensaje a sus notas);
- crea una tarea **"Contactar a {nombre}"** para el día siguiente.

Solo se aceptan envíos desde las webs de `CRM_ALLOWED_ORIGINS` (por defecto `https://transfiereloo.cl` y `https://www.transfiereloo.cl`). Hay protección anti-bots y un límite de 10 envíos cada 10 minutos por IP. Este formulario **no** usa la clave API, así que tu clave nunca queda expuesta en la web.

¿Ya tienes tu propio formulario? Haz que envíe por POST a `https://crm.transfiereloo.cl/api/public/lead` con los campos `nombre`, `email` y/o `telefono`, y opcionalmente `mensaje`, `empresa` y `origen`. Acepta tanto JSON como formulario normal; en este último caso, después de enviar vuelve a la página con `?enviado=1`.

---

## 1. Instalación en Windows

1. **Instala Node.js 22 LTS o superior** desde <https://nodejs.org> (botón "LTS"). Acepta las opciones por defecto.
2. **Instala Git** desde <https://git-scm.com/download/win>.
3. Abre **PowerShell** y descarga el proyecto:
   ```powershell
   cd $HOME\Documents
   git clone https://github.com/TU_USUARIO/mi-crm.git
   cd mi-crm
   ```
4. Instala las dependencias:
   ```powershell
   npm install
   ```
5. Crea tu archivo de configuración y edítalo:
   ```powershell
   copy .env.example .env
   notepad .env
   ```
   Cambia `CRM_PASSWORD`, `CRM_API_KEY` y `CRM_SECRET` por valores tuyos. Para generar una clave aleatoria:
   ```powershell
   -join (1..40 | % { [char]((48..57)+(97..122) | Get-Random) })
   ```
6. Arranca el CRM:
   ```powershell
   npm run dev
   ```
7. Abre <http://localhost:3000> y entra con tu contraseña.

La primera vez se crean unos datos de ejemplo (Acme, Globex…). Puedes borrarlos desde la propia web.

**Modo producción** (más rápido): `npm run build` y luego `npm start`.

**Copia de seguridad:** todos los datos están en `data\crm.db`. Copia ese archivo (con el CRM parado).

---

## 2. Usar el CRM

| Sección | Qué hace |
|---|---|
| Panel | Resumen: nº de contactos, valor del pipeline, ganado, próximas tareas |
| Contactos | Búsqueda, filtro por estado (lead / cliente / inactivo), ficha con sus oportunidades y tareas |
| Empresas | Empresas con sus contactos y oportunidades |
| Oportunidades | Tablero por etapas: Nuevo → Contactado → Propuesta → Negociación → Ganado / Perdido |
| Tareas | Pendientes, hechas, vencidas (en rojo) |

---

## 3. API REST

Todas las peticiones necesitan la cabecera `x-api-key: TU_CRM_API_KEY` (o `Authorization: Bearer TU_CRM_API_KEY`).

Recursos: `contacts`, `companies`, `deals`, `tasks`.

| Método | Ruta | Acción |
|---|---|---|
| GET | `/api/{recurso}?q=texto&campo=valor` | Listar (búsqueda y filtros opcionales) |
| POST | `/api/{recurso}` | Crear |
| GET | `/api/{recurso}/{id}` | Obtener uno |
| PATCH | `/api/{recurso}/{id}` | Actualizar (solo los campos enviados) |
| DELETE | `/api/{recurso}/{id}` | Borrar |
| GET | `/api/openapi.json` | Especificación OpenAPI completa |
| GET | `/api/health` | Comprobar que está en marcha (sin clave) |
| POST | `/api/public/lead` | Formulario web público (sin clave, solo webs autorizadas) |

Campos:

- **contacts**: `first_name`*, `last_name`, `email`, `phone`, `position`, `status` (`lead`/`cliente`/`inactivo`), `company_id`, `notes`
- **companies**: `name`*, `industry`, `website`, `phone`, `notes`
- **deals**: `title`*, `value`, `stage` (`nuevo`/`contactado`/`propuesta`/`negociacion`/`ganado`/`perdido`), `contact_id`, `company_id`, `expected_close` (AAAA-MM-DD), `notes`
- **tasks**: `title`*, `due_date` (AAAA-MM-DD), `done` (true/false), `contact_id`, `deal_id`

\* obligatorio

Ejemplo desde PowerShell:

```powershell
$h = @{ "x-api-key" = "TU_CRM_API_KEY" }
Invoke-RestMethod http://localhost:3000/api/contacts -Headers $h
Invoke-RestMethod http://localhost:3000/api/contacts -Method Post -Headers $h -ContentType "application/json" `
  -Body '{"first_name":"Ana","email":"ana@ejemplo.com","status":"lead"}'
```

---

## 4. Conectar con Emergent

Emergent está en la nube, así que **no puede ver `localhost`**: el CRM tiene que tener una URL pública.

### Paso A: dar una URL pública al CRM

**Opción rápida (pruebas): túnel desde tu PC.** El CRM sigue corriendo en tu ordenador:
```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```
Te dará una URL tipo `https://algo.trycloudflare.com`. Cambia cada vez que lo arrancas y solo funciona con el PC encendido.

**Opción estable: desplegarlo** en un servicio con **disco persistente** (SQLite guarda un archivo), por ejemplo Railway o Render:
1. Conecta tu repositorio de GitHub.
2. Build command: `npm install && npm run build`. Start command: `npm start`.
3. Añade un volumen o disco persistente y pon la variable `CRM_DB_PATH` apuntando a él (p. ej. `/data/crm.db`).
4. Añade las variables `CRM_PASSWORD`, `CRM_API_KEY` y `CRM_SECRET`.

> Vercel no sirve con SQLite tal cual: su sistema de archivos no es persistente.

### Paso B: conectar desde Emergent

1. Comprueba que funciona: abre `https://TU-URL/api/health` en el navegador. Debe responder `{"ok":true}`.
2. En Emergent, guarda la clave como **variable de entorno o secreto** (p. ej. `CRM_API_KEY`). No la pegues en el código.
3. Pídele a Emergent lo que quieras construir. Plantilla:

   > Quiero que esta app se conecte a mi CRM existente mediante su API REST.
   > URL base: `https://TU-URL`. Especificación OpenAPI: `https://TU-URL/api/openapi.json` (necesita la cabecera `x-api-key`).
   > Autenticación: cabecera `x-api-key` con el valor de la variable de entorno `CRM_API_KEY`. Llama a la API **solo desde el backend**, nunca desde el navegador.
   > Construye: [por ejemplo, un formulario web de captación que cree un contacto con status "lead" y una tarea "Llamar a {nombre}" a 2 días vista / un agente que consulte las oportunidades abiertas y me resuma el pipeline].

### Editar el código del CRM con Emergent

Si prefieres que Emergent modifique este mismo CRM, conecta tu GitHub en Emergent y usa este repositorio. Ten en cuenta que Emergent suele generar apps con su propio stack (React + FastAPI + MongoDB), así que lo más limpio suele ser mantener el CRM aquí y conectar las apps de Emergent por API.
