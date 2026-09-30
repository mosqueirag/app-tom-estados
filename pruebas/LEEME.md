# Pruebas automáticas

Son para quien mantenga el código (no hace falta correrlas para usar la app).

| Archivo | Qué prueba | Casos |
|---|---|---|
| `../supabase/tests/01_prueba_rls_y_cierre.sql` | Seguridad (RLS), sincronización, conflictos y cierre de período | SQL |
| `../supabase/tests/02_prueba_administracion.sql` | Regla de "última lectura" con período abierto, vistas del admin | SQL |
| `../supabase/tests/03_prueba_rutas.sql` | Rutas, qué cuentas ve cada operador, registro de avisos push | SQL |
| `fase2.mjs` | Login, rutas por rol, sesión guardada sin señal | 16 |
| `fase3.mjs` | Módulo administrador completo, importación y exportación Excel | 30 |
| `fase4.mjs` | Módulo operador: descarga, búsqueda, validaciones, offline, sincronización, conflictos | 20 |
| `fase5.mjs` | PWA: manifest, íconos, service worker, abrir y cargar en modo avión | 11 |
| `fase6.mjs` | Rutas: asignar a operadores, filtro, Excel con ruta, descarga por operador, abrir desde el aviso | 15 |
| `fase7.mjs` | Lecturas en vivo (Realtime simulado), campana con fecha y hora, cuenta nueva con operador de la ruta, varias rutas por operador | 20 |
| `fase8.mjs` | Foto del medidor (con y sin señal, obligatoria), GPS, foto y mapa en el admin | 17 |

## Cómo se corren

Necesitan Postgres 16, [PostgREST](https://postgrest.org) y Playwright con Chromium.

1. `bash pruebas/preparar-base.sh` crea la base `e2e` con las migraciones y levanta PostgREST en `:3000`
   (ajustar las rutas del script a tu máquina).
2. `VITE_SUPABASE_URL=http://supabase.test VITE_SUPABASE_ANON_KEY=x npx vite build && npx vite preview --port 4173`
3. `node pruebas/fase3.mjs` (repetir el paso 1 antes de cada archivo de fase 3 a 5).

Las Edge Functions se simulan en estas pruebas; su código real está en `supabase/functions`.
