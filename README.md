# Lecturas de medidores

App para tomar lecturas de medidores desde el celular. Funciona **sin señal**
y se instala en Android y iPhone como una app más.

- **Administrador** (desde la computadora): carga las cuentas desde Excel, crea operadores,
  abre y cierra períodos, revisa y corrige lecturas y las exporta a Excel.
- **Operador** (desde el celular): descarga las cuentas, busca cada cuenta, carga la lectura
  y la confirma. Si no hay señal, la lectura queda guardada en el celular y se envía sola
  cuando vuelve la conexión.

Esta guía está pensada para alguien **sin conocimientos técnicos**. Seguí los pasos en orden.
Vas a necesitar unos 45 minutos la primera vez.

---

## Índice

1. [Qué vas a necesitar](#1-qué-vas-a-necesitar)
2. [Crear el proyecto en Supabase](#2-crear-el-proyecto-en-supabase)
3. [Crear las tablas (aplicar las migraciones)](#3-crear-las-tablas-aplicar-las-migraciones)
4. [Cerrar el registro público](#4-cerrar-el-registro-público-importante)
5. [Publicar las funciones de operadores](#5-publicar-las-funciones-de-operadores-edge-functions)
6. [Crear el primer administrador](#6-crear-el-primer-administrador)
7. [Configurar las variables de entorno](#7-configurar-las-variables-de-entorno)
8. [Publicar la app en Netlify](#8-publicar-la-app-en-netlify)
9. [Instalar la app en Android y en iPhone](#9-instalar-la-app-en-android-y-en-iphone)
10. [Importar cuentas desde Excel](#10-importar-cuentas-desde-excel)
11. [Trabajo diario del operador](#11-trabajo-diario-del-operador)
12. [Cerrar un período y abrir el siguiente](#12-cerrar-un-período-y-abrir-el-siguiente)
13. [Preguntas frecuentes y problemas](#13-preguntas-frecuentes-y-problemas)
14. [Para programadores](#14-para-programadores)

---

## 1. Qué vas a necesitar

- Una cuenta gratuita en **Supabase** (<https://supabase.com>): guarda los datos y los usuarios.
- Una cuenta gratuita en **Netlify** (<https://netlify.com>): publica la app en internet.
- Una cuenta en **GitHub** (<https://github.com>) con el código de esta carpeta subido a un
  repositorio. Es la forma más simple de que Netlify publique la app y la actualice sola.
- Los archivos de esta carpeta.

> 🔒 **Regla de oro:** en Supabase vas a ver dos claves. La **anon / publishable** es pública y
> va en la app. La **service_role / secret** es secreta: **nunca** la pegues en la app, en
> Netlify ni en ningún archivo. Esta app no la necesita en ningún lado; Supabase se la da sola
> a las funciones del paso 5.

---

## 2. Crear el proyecto en Supabase

1. Entrá a <https://supabase.com/dashboard> e iniciá sesión.
2. Tocá **New project**.
3. Completá:
   - **Name:** `lecturas-medidores` (o el que quieras).
   - **Database Password:** inventá una contraseña fuerte y **guardala** en un lugar seguro.
   - **Region:** `South America (São Paulo)`, que es la más cercana a Argentina.
4. Tocá **Create new project** y esperá un par de minutos hasta que termine.
5. Anotá dos datos (los vas a usar en el paso 7). Están en el botón **Connect** de arriba, o en
   **Project Settings → API Keys** y **Project Settings → Data API**:
   - **Project URL**: algo como `https://abcdefghijkl.supabase.co`
   - **anon / publishable key**: un texto largo que empieza con `eyJ…` o `sb_publishable_…`

---

## 3. Crear las tablas (aplicar las migraciones)

Las "migraciones" son archivos con instrucciones que crean las tablas, la seguridad y las
funciones. Están en la carpeta `supabase/migrations` y **hay que ejecutarlas en orden**.

1. En Supabase, abrí **SQL Editor** (menú de la izquierda).
2. Tocá **New query**.
3. Abrí en tu computadora el archivo `supabase/migrations/20260930000001_tablas.sql`
   con el Bloc de notas, copiá **todo** el contenido y pegalo en el editor.
4. Tocá **Run** (abajo a la derecha). Tiene que decir *Success. No rows returned*.
5. Repetí los pasos 2 a 4 con cada archivo, **en este orden**:

   | Orden | Archivo |
   |---|---|
   | 1 | `20260930000001_tablas.sql` |
   | 2 | `20260930000002_funciones_y_triggers.sql` |
   | 3 | `20260930000003_rls.sql` |
   | 4 | `20260930000004_periodos_y_sincronizacion.sql` |
   | 5 | `20260930000005_administracion.sql` |
   | 6 | `20260930000006_registro_seguro.sql` |
   | 7 | `20260930000007_ajustes_seguridad.sql` |
   | 8 | `20260930000008_rutas_y_avisos.sql` |
   | 9 | `20260930000009_lecturas_en_vivo.sql` |
   | 10 | `20260930000010_fotos_y_ubicacion.sql` |
   | 11 | `20260930000011_orden_de_recorrido.sql` |

6. **Datos de ejemplo (opcional):** si querés probar la app con 10 cuentas de prueba y un
   período "Octubre 2026", ejecutá también `supabase/seed.sql`. Para uso real no hace falta:
   vas a cargar tus cuentas desde Excel (paso 10) y abrir tu propio período (paso 12).

> Si Supabase muestra un error, no sigas con el próximo archivo: revisá que hayas copiado el
> archivo completo y que los anteriores se hayan ejecutado bien.

---

## 4. Cerrar el registro público (importante)

Los usuarios los crea solo el administrador desde la app. Para que nadie pueda registrarse
por su cuenta:

1. En Supabase: **Authentication → Sign In / Providers** (en algunas versiones:
   **Authentication → Settings**).
2. Desactivá **Allow new users to sign up** y guardá.

Aunque alguien lograra registrarse, su usuario queda **desactivado** y no puede ver ni cargar
nada (así lo hace la migración 6). Pero es mejor cerrarlo igual.

---

## 5. Publicar las funciones de operadores (Edge Functions)

Hay tres funciones:

- `crear-operador`: crea usuarios nuevos (pantalla **Operadores**).
- `gestionar-operador`: desactiva, reactiva y cambia contraseñas (pantalla **Operadores**).
- `asignar-cuentas`: asigna rutas o cuentas a un operador y le manda el aviso al celular
  (pantallas **Rutas** y **Cuentas**).

Hacen tareas que necesitan la clave secreta, por eso corren en Supabase y no en la app.

**Desde el panel de Supabase (sin instalar nada):**

1. En Supabase: **Edge Functions → Deploy a new function → Via Editor**.
2. En el nombre poné exactamente `crear-operador`.
3. Borrá el código de ejemplo, abrí `supabase/functions/crear-operador/index.ts`, copiá todo
   y pegalo.
4. Tocá **Deploy function**.
5. Repetí con `gestionar-operador` y con `asignar-cuentas`, cada una con su archivo
   `supabase/functions/<nombre>/index.ts`.

**O desde la terminal**, si tenés Node instalado:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase functions deploy crear-operador
npx supabase functions deploy gestionar-operador
npx supabase functions deploy asignar-cuentas
```

**Claves para los avisos push.** Los avisos al celular necesitan un par de claves (VAPID).
Se generan una sola vez:

1. En una terminal: `npx web-push generate-vapid-keys`. Muestra una *Public Key* y una
   *Private Key*.
2. En Supabase, **SQL Editor → New query**, pegá esto con tus claves y tocá **Run**:

   ```sql
   insert into public.configuracion_push (id, vapid_publica, vapid_privada, contacto)
   values (1, 'TU_PUBLIC_KEY', 'TU_PRIVATE_KEY', 'https://tu-app.netlify.app');
   ```

   La clave privada queda en una tabla que solo puede leer la función `asignar-cuentas`.
3. La *Public Key* también va en la variable `VITE_VAPID_PUBLIC_KEY` (paso 7).

> Opcional: si querés otro dominio interno para los "nombres de usuario" (ver paso 7), cargá
> el secreto `DOMINIO_USUARIOS` en **Edge Functions → Secrets** con el mismo valor que
> `VITE_DOMINIO_USUARIOS`.

---

## 6. Crear el primer administrador

1. En Supabase: **Authentication → Users → Add user → Create new user**.
2. Poné tu email y una contraseña, tildá **Auto Confirm User** y tocá **Create user**.
3. Abrí **SQL Editor → New query** y pegá el contenido de `supabase/crear_admin.sql`.
4. En la línea que dice `where email = 'admin@ejemplo.com'` cambiá el email por el tuyo.
5. Tocá **Run**. Abajo tiene que aparecer una fila con tu email y `rol = admin`.

Los demás usuarios (operadores y otros administradores) se crean desde la app, en la
pantalla **Operadores**.

---

## 7. Configurar las variables de entorno

La app necesita saber a qué proyecto de Supabase conectarse. Son estos datos:

| Variable | Qué poner |
|---|---|
| `VITE_SUPABASE_URL` | La **Project URL** del paso 2 |
| `VITE_SUPABASE_ANON_KEY` | La clave **anon / publishable** del paso 2 (¡nunca la service_role!) |
| `VITE_DOMINIO_USUARIOS` | `usuarios.lecturas.app` (dejalo así salvo que cambies el del paso 5) |
| `VITE_VAPID_PUBLIC_KEY` | La *Public Key* de los avisos push (paso 5). Sin ella, la app funciona igual pero sin avisos |

- **En Netlify** se cargan en el paso 8.
- **En tu computadora** (solo si vas a probar la app localmente): copiá el archivo
  `.env.example` con el nombre `.env` y completá los valores.

> ¿Para qué es el dominio de usuarios? Los operadores pueden ingresar con un nombre corto
> (por ejemplo `jperez`) en lugar de un email. Internamente se guarda como
> `jperez@usuarios.lecturas.app`. No se envía ningún mail a esa dirección.

---

## 8. Publicar la app en Netlify

**Opción A: desde GitHub (recomendada, se actualiza sola)**

1. Subí esta carpeta a un repositorio de GitHub. **No** subas el archivo `.env` (ya está
   excluido en `.gitignore`).
2. En Netlify: **Add new site → Import an existing project → GitHub** y elegí el repositorio.
3. Netlify lee solo el archivo `netlify.toml`: el comando de build (`npm run build`) y la
   carpeta a publicar (`dist`) ya están configurados.
4. Antes de publicar, abrí **Add environment variables** (o, después, **Site configuration →
   Environment variables**) y cargá las 3 variables del paso 7.
5. Tocá **Deploy**. En unos minutos vas a tener una dirección del tipo
   `https://nombre-al-azar.netlify.app`. Podés cambiarla en **Domain management**.
6. Cada vez que se suban cambios al repositorio, Netlify vuelve a publicar solo. Los celulares
   ven el aviso "Hay una versión nueva de la app" y se actualizan con un toque.

**Opción B: subir la carpeta a mano (sin GitHub)**

1. En tu computadora, con Node 22 instalado: creá el `.env` (paso 7) y ejecutá
   `npm install` y después `npm run build`.
2. En Netlify: **Add new site → Deploy manually** y arrastrá la carpeta `dist`.

> Si cambiás una variable de entorno en Netlify, hay que volver a publicar
> (**Deploys → Trigger deploy**) para que la app la tome.

---

## 9. Instalar la app en Android y en iPhone

La app también tiene estas instrucciones adentro (botón **Ayuda** del operador, o el enlace
"¿Cómo instalo la app en el celular?" en la pantalla de ingreso).

**Android (Chrome)**

1. Abrí la dirección de la app en **Chrome**.
2. Tocá el menú **⋮** (arriba a la derecha).
3. Elegí **Instalar app** (o **Agregar a la pantalla principal**) y confirmá.
4. Abrí la app desde el ícono **Lecturas**.

**iPhone (Safari)**

1. Abrí la dirección de la app en **Safari** (desde Chrome u otro navegador no se puede).
2. Tocá el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elegí **Agregar a inicio** y después **Agregar**.
4. Abrí la app desde el ícono **Lecturas**.

**La primera vez** hay que iniciar sesión **con internet**. Después la sesión queda guardada y
la app abre aunque no haya señal.

---

## 10. Importar cuentas desde Excel

1. Ingresá como administrador y abrí **Cuentas**.
2. Tocá **Descargar plantilla** para tener el Excel con el formato correcto. La primera fila
   debe tener estas columnas (el orden no importa):

   | numero_cuenta | titular | direccion | medidor | ultima_lectura | ruta |
   |---|---|---|---|---|---|
   | 10001 | García, María | Av. San Martín 1250 | MED-458721 | 15230 | Ruta 1 |

   - `ultima_lectura` es un número. Acepta `1234,5` o `1234.5`. Si el medidor es nuevo, poné `0`.
   - `ruta` es opcional. Si el Excel no tiene esa columna, las rutas que ya había no se tocan.
   - Si tus números de cuenta tienen ceros adelante (`00123`), en Excel poné esa columna como
     **Texto** para que no se pierdan.
3. Tocá **Importar Excel** y elegí tu archivo (`.xlsx`, `.xls` o `.csv`).
4. Revisá la **vista previa**:
   - **Nueva**: se va a crear.
   - **Se actualiza**: ya existe ese número de cuenta y cambió algún dato.
   - **Sin cambios** o **Se omite**: no se toca.
   - **Error**: falta un dato, el número es inválido o el número de cuenta está repetido en el
     archivo. Esas filas no se importan; podés corregir el Excel y volver a elegirlo.
5. La casilla **Actualizar las cuentas que ya existen** decide si se modifican las cuentas que
   ya estaban. Si la destildás, solo se agregan las nuevas.
6. Tocá **Importar N cuentas**.

> Mientras hay un **período abierto**, la *última lectura* de las cuentas que ya existen no se
> cambia (ni a mano ni por Excel), para que la "lectura anterior" que ven los operadores no
> cambie a mitad de período. Titular, dirección y medidor sí se actualizan.

Después de importar o modificar cuentas, los operadores tienen que tocar **Descargar cuentas**
de nuevo para ver los cambios.

### Asignar rutas a los operadores

1. Cargá la ruta de cada cuenta (columna `ruta` del Excel, o **Cuentas → Editar**).
2. Abrí **Rutas**. Hay una fila por ruta con la cantidad de cuentas y las pendientes del período.
3. En la columna **Operador** elegí quién lee esa ruta. Se le asignan todas las cuentas activas
   de la ruta y le llega un aviso al celular: "Tenés cuentas nuevas para leer". Al tocarlo, la
   app se abre y descarga las cuentas sola.
4. Para una sola cuenta: **Cuentas → Editar → Operador**.
5. Un operador puede tener **varias rutas**: en **Operadores → Asignar rutas** marcá todas las
   que lee. Le llega un solo aviso con las rutas nuevas.
6. Al crear una cuenta nueva hay que elegir el operador. Si la ruta ya tiene operador, se elige
   solo. Las cuentas nuevas del Excel también quedan del operador de su ruta.

**Siempre que el admin le manda datos a un operador le llega un aviso:** al asignarle una ruta
o una cuenta, al crear una cuenta en su ruta (a mano o por Excel) y al modificar una de sus
cuentas.

### Orden de recorrido

En **Rutas → Ordenar recorrido** el admin pone las cuentas de cada ruta en el orden en que se
caminan (con flechas, o **Ordenar por dirección** para empezar). En el celular, la pestaña
**Recorrido** muestra la ruta en ese orden, cuál sigue y un botón **Cómo llegar** que abre Google
Maps: usa la ubicación GPS de la última lectura, o la dirección más la **Localidad** que se
carga en el Panel.

### Foto del medidor y ubicación

Al cargar una lectura el operador puede sacar una foto del medidor (botón **Sacar foto**) y la
app toma la ubicación GPS sola. Funciona sin señal: la foto queda en el celular y se sube al
sincronizar (achicada, unos 100 KB). El admin ve la foto y el lugar en **Lecturas** (botones
Foto y Mapa) y todas las lecturas del período en **Mapa**. En **Panel** se puede exigir la
foto en cada lectura.

Las fotos se guardan en Supabase Storage, en el bucket privado `fotos-medidores` (lo crea la
migración 10). El plan gratis trae 1 GB: alcanza para unas 10.000 fotos.

### Lecturas en vivo

El panel del admin recibe cada lectura apenas el operador sincroniza, sin recargar: aparece un
cartel, la campana de arriba suma el aviso (con fecha, hora, operador y alertas) y el Panel y
Lecturas se actualizan solos. Con **Avisarme aunque no esté mirando** (dentro de la campana)
también llega una notificación del navegador cuando la pestaña está en segundo plano.

Cada operador descarga **sus cuentas y las que no tienen operador**. Una ruta en
"Sin asignar" la ven todos.

**Avisos en el celular:** cada operador tiene que tocar **Activar avisos** una vez, en la
pantalla de inicio de la app, y aceptar el permiso.

- **Android:** funciona en Chrome, con la app instalada o no.
- **iPhone:** solo funciona con la app **instalada en la pantalla de inicio** (Compartir →
  Agregar a inicio) y con iOS 16.4 o posterior. Desde Safari sin instalar no llegan avisos.
- Si un operador no activó los avisos, al asignarle una ruta la pantalla te lo dice para que
  le avises vos.

---

## 11. Trabajo diario del operador

1. **Con señal, antes de salir:** abrir la app → **Inicio → Descargar cuentas**.
2. **En la calle (con o sin señal):**
   - **Buscar** la cuenta por número, medidor, dirección o titular. Con el filtro
     *Pendientes* se ven solo las que faltan leer.
   - Cargar la **lectura actual**, o marcar **No se pudo leer** y elegir el motivo
     (casa cerrada, perro, medidor inaccesible…).
   - Revisar el resumen y tocar **Confirmar lectura**.
   - Si la lectura es **menor que la anterior** o el consumo es **muy alto**, la app pide
     revisar el medidor y confirmar de nuevo.
3. Arriba siempre se ve el estado, por ejemplo **"Sin conexión · 5 lecturas pendientes"**.
4. **Las lecturas se envían solas** cuando hay señal y la app está abierta: al abrirla, cuando
   vuelve la señal, cada 2 minutos, o con el botón **Sincronizar ahora**.
5. **Al terminar el día:** abrir la app con señal y verificar que diga **"todo enviado"**.

> ⚠️ **iPhone:** el iPhone no permite que la app envíe datos en segundo plano. Las lecturas se
> envían **solo con la app abierta**. En Android conviene hacer lo mismo.
>
> ⚠️ No cierres sesión ni borres los datos del navegador si tenés lecturas pendientes. Cerrar
> sesión no las borra (se envían al volver a ingresar), pero borrar los datos del navegador sí.

**Mis lecturas** muestra cada lectura del período con su estado:

- **Enviada**: ya está en el sistema.
- **Pendiente**: guardada en el celular, falta enviarla. Todavía se puede corregir.
- **Con conflicto**: otro operador ya había leído esa cuenta, o el período ya estaba cerrado.
  El dato **no se pierde**: el administrador lo ve y decide.
- **Rechazada**: el servidor la rechazó (por ejemplo, la cuenta fue dada de baja).

---

## 12. Cerrar un período y abrir el siguiente

**Antes de cerrar**, pedí a los operadores que abran la app con señal y verifiquen que no les
queden lecturas pendientes.

1. Abrí **Períodos → Cerrar período**.
2. La app muestra un **resumen**: cuántas cuentas se leyeron, cuántas quedaron pendientes, las
   alertas y los conflictos sin resolver.
3. Tildá **Revisé el resumen y quiero cerrar el período** y tocá **Cerrar período**.

Al cerrar:

- La lectura de cada cuenta leída pasa a ser su **última lectura** (y su consumo, el **último
  consumo**) para el próximo período.
- Las cuentas sin lectura o pendientes conservan su lectura anterior.
- Ya no se pueden cargar ni corregir lecturas de ese período. **No se puede deshacer.**

Para empezar el período siguiente: **Períodos → Abrir nuevo período**, poné el nombre
(por ejemplo "Noviembre 2026") y la fecha de inicio. Después los operadores tienen que tocar
**Descargar cuentas**.

**Exportar:** en **Lecturas** elegí el período y tocá **Exportar a Excel**. Sin filtros, el
archivo trae una hoja **Lecturas** y otra **Pendientes** (cuentas no visitadas).

---

## 13. Preguntas frecuentes y problemas

**La app dice "Falta configurar la conexión con Supabase".**
Faltan las variables del paso 7 en Netlify, o se cargaron después del último deploy. Cargalas
y hacé **Trigger deploy**.

**Al crear un operador aparece un error.**
Revisá que las dos funciones del paso 5 estén publicadas con esos nombres exactos. Si el error
dice *Invalid JWT*, en **Edge Functions → (la función) → Settings** desactivá
**Enforce JWT verification** (la función igual verifica que quien llama sea administrador).

**Un operador ve "Usuario desactivado".**
Un administrador lo desactivó. Se reactiva desde **Operadores → Activar**.

**Un operador olvidó su contraseña.**
**Operadores → Resetear contraseña** y pasale la nueva.

**¿Qué es un "conflicto"?**
Dos operadores leyeron la misma cuenta en el mismo período, o una lectura llegó después de
cerrar el período. El administrador los ve en **Lecturas → conflictos** y elige cuál queda
(**Mantener la registrada** o **Usar esta lectura**).

**¿Qué pasa si se rompe o se pierde el celular?**
Lo que ya se envió está a salvo en Supabase. Se pierden solo las lecturas que todavía estaban
pendientes en ese celular.

**¿Cuánto cuesta?**
Los planes gratuitos de Supabase y Netlify alcanzan para empezar. Ojo: en el plan gratuito,
Supabase **pausa** el proyecto si pasa una semana sin uso; se reactiva desde el panel.

---

## 14. Para programadores

**Stack:** React + Vite + TypeScript + Tailwind CSS · vite-plugin-pwa · Supabase (Postgres,
Auth, RLS, Edge Functions) · Dexie (IndexedDB) · SheetJS · Netlify.

```bash
npm install
cp .env.example .env   # completar
npm run dev            # http://localhost:5173
npm run build          # genera dist/ (incluye el service worker)
npm run typecheck
```

> SheetJS se instala desde el CDN oficial (`cdn.sheetjs.com`, versión 0.20.3), como
> recomienda SheetJS: la versión publicada en npm está desactualizada.

**Estructura**

```
src/
├── App.tsx                 rutas (el módulo admin se carga aparte)
├── auth/                   sesión, perfil guardado para uso offline, rutas por rol
├── sync/                   ProveedorSync: sincronización automática (sin Background Sync)
├── lib/
│   ├── db.ts               base local Dexie (cuentas, lecturas, meta)
│   ├── sincronizacion.ts   descarga de cuentas y envío de lecturas
│   ├── validarLectura.ts   reglas de validación del operador
│   ├── importarCuentas.ts  validación de la importación Excel
│   └── excel.ts            plantilla, importación y exportación (SheetJS)
├── layouts/                AdminLayout (menú lateral) · OperadorLayout (barra inferior)
└── pages/                  Login, Instalar, admin/*, operador/*
supabase/
├── migrations/             01 tablas · 02 triggers · 03 RLS · 04 sync y períodos · 05 admin · 06 registro seguro
├── functions/              crear-operador, gestionar-operador (autocontenidas)
├── seed.sql, crear_admin.sql
└── tests/                  pruebas SQL (Postgres local)
pruebas/                    pruebas de punta a punta con Playwright (ver pruebas/LEEME.md)
```

**Decisiones de diseño**

- El celular genera el `id` (uuid) de cada lectura. El envío usa la función
  `sincronizar_lecturas`, que inserta por id: reintentar nunca duplica.
- La restricción única `(cuenta_id, periodo_id)` detecta cuando otro operador ya leyó la cuenta.
  Esa lectura se guarda en `lecturas_conflictos` y devuelve estado `conflicto`.
- `lectura_anterior` la completa el servidor desde `cuentas.ultima_lectura` (trigger), y
  `consumo` es una columna calculada.
- Mientras hay un período activo, un trigger impide cambiar `cuentas.ultima_lectura`. Solo
  `cerrar_periodo()` la actualiza, en una transacción.
- RLS en todas las tablas. Las vistas usan `security_invoker`. Los perfiles nacen
  desactivados y solo `crear-operador` (con service_role, dentro de Supabase) los activa.
- La sesión y el perfil quedan en el celular: si el servidor no responde en 4 segundos, el
  operador entra con la sesión guardada.
- El service worker precachea toda la app (`registerType: 'prompt'`, con aviso de versión
  nueva). Las llamadas a Supabase nunca se cachean.
