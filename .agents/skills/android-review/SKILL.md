---
name: Android Review
description: Auditoría completa y sistemática de Better Tracker para Android (Tauri v2 + SAF): escritura/lectura de bóveda, hilos y locks, IPC, permisos y manifiesto, red (Open Food Facts), estado del frontend, UI táctil y tests. Usar cuando aparezcan síntomas Android que se arreglan uno a uno, antes de dar por terminada cualquier release y siempre que se toque vault.rs, commands.rs, App.tsx o estilos.
---

# Android Review — auditoría completa

Propósito: **dejar de corregir síntomas uno por uno**. Un fallo en Android casi nunca es aislado: la bóveda, los backups, el estado de React y la UI táctil comparten las mismas causas (IPC sincrónico, locks globales, writes no verificados, estado optimista que se sobreescribe). Esta skill exige recorrer **todas** las capas y entregar un informe único antes de editar.

> Regla de oro: si un síntoma aparece «solo en Android», buscar primero la asimetría con la ruta de escritorio: `std::fs` barato y atómico frente a `run_mobile_plugin` sincrónico, sin timeout y con nombre de archivo decidido por el proveedor SAF.

**Estado 2026-11-27**: snapshots verificados en dispositivo (creación, listado, restauración, incluidas copias antiguas). Queda abierto el cierre aleatorio de la app: sin `logcat` del momento no se puede distinguir OOM, panic de Rust ni crash del WebView; pedir pantalla, acción, nº de eventos y nº de copias.

---

## 1. Inventario obligatorio (sin saltarse nada)

1. `grep -rn 'cfg(target_os = "android")' src-tauri/src` — enumerar **todas** las ramas Android y verificar que ninguna haga trabajo pesado en el hilo equivocado.
2. `grep -rn 'android_fs()\|android_fs_async()' src-tauri/src` — toda API **bloqueante** debe estar dentro de `spawn_blocking`. Ninguna en un comando `async` directo.
3. `grep -rn 'spawn_blocking\|WRITE_LOCK\|BACKUP_LOCK' src-tauri/src` — auditar cada lock: quién lo toma, cuánto lo mantiene y si un lock lento puede bloquear un `append_event`.
4. `grep -rn 'invoke<' src` — listar todos los comandos y su manejo de errores (`catch`, toast con `errorText`, sin mensajes genéricos que oculten la causa).
5. `grep -rn 'await .*appendEvent\|await .*onRefresh\|await .*refresh\|setEvents\|setGoalMode\|setNutri' src` — buscar estados optimistas sobreescritos por lecturas en vuelo y `await`s que dejan spinners colgados.
6. `grep -rn 'read_to_string\|\.read(' src-tauri/src/vault.rs` — cada lectura SAF debe ser necesaria; prohibido leer contenido para contar o comprobar existencia.
7. `grep -rn 'create_new_file\|create_dir_all\|write(' src-tauri/src/vault.rs` — verificar nombre real devuelto, idempotencia y atomicidad.
8. `grep -rn 'touch-action\|pointer-events\|onPointer\|onTouch\|-webkit-tap-highlight-color\|font-size' src/styles.css src/*.tsx src/components/*.tsx` — sensibilidad táctil, scroll y tipografía tokenizada.
9. `git log --all --oneline --graph` + reflog (incluye amends/force) — comparar con la última versión que funcionaba; si el código SAF no cambió, la regresión puede ser **volumen de datos** o un cambio de dependencias.

---

## 2. Reglas por capa

### 2.1 Rust / SAF

- [ ] Ninguna API bloqueante (`android_fs()`) en un comando `async`: usar `spawn_blocking`.
- [ ] `WRITE_LOCK` solo para escrituras cortas de eventos; `BACKUP_LOCK` para copias/restauración/borrado. Un backup jamás bloquea un append.
- [ ] `backup_status` se consulta **fuera** de cualquier lock.
- [ ] Conteo de copias con `Entry::file_len()`, una sola vez por copia; cero `read()` para contar.
- [ ] Restauración: ids de eventos actuales **por nombre de archivo** (`<id>.json`), leer solo los faltantes; un archivo ilegible no aborta el resto; límites de profundidad/tamaño.
- [ ] `create_new_file_and_return_relative_path` + comparación del nombre real; nombres canónicos (`<id>.json`, `events.jsonl`).
- [ ] Raíz SAF no reconocida = error explícito (nunca fallback a `std::fs` sobre `content://`).
- [ ] Permiso persistido validado con mensaje accionable.
- [ ] `config.json` con escritura atómica (temporal + `rename`).
- [ ] Retención de copias global (7 en total), no por dispositivo; borrar las más antiguas.
- [ ] Errores con contexto (`{e}`), nunca `String(e)` genérico desde el frontend.

### 2.2 Red / Open Food Facts

- [ ] Toda petición desde Rust; CSP `connect-src 'none'` **no** se relaja (no es la causa de fallos de búsqueda).
- [ ] reqwest 0.12 + `rustls-tls-webpki-roots` en Android; ninguna dependencia nueva con 0.13 + `rustls` usada para crear clientes propios.
- [ ] **`cfg(not(windows))` se conserva tal cual**: los 3 endpoints originales
      (`world/cgi`, `fr/cgi`, `world/api/v2`), dos pasadas con el cliente original,
      sin presupuesto ni backoff y con el mensaje de error original. No
      «uniformizar» con la ruta de Windows (Search-a-licious + 2 hosts de
      respaldo): Android/Linux ya funcionaban con esa ruta. La mejora de
      Search-a-licious (macros en la misma respuesta, **1 petición por búsqueda**)
      es solo Windows; no trasladarla a `not(windows)` sin una incidencia real.
- [ ] Antes de atribuir un 503 a una plataforma, repetir el mismo `curl` con el UA
      de la app desde el PC y **varias veces**: OFF devuelve 503 de forma
      intermitente (límite por IP y global), así que una sola muestra no prueba
      nada. El presupuesto de 8 búsquedas/minuto, el backoff 30–600 s y
      Search-a-licious son **solo Windows** (`#[cfg(windows)]`); en Android no se
      han tocado. En Windows la feature
      `system-proxy` de reqwest debe seguir activada (build Store y build normal
      leen así el proxy del registro) y existe el respaldo directo
      `http_client_no_proxy()`.
- [ ] Añadir un alimento remoto **no** depende de que se guarde el alimento en la bóveda: primero se registra la comida.
- [ ] Cambiar el campo de búsqueda tras añadir no relanza otra petición.

### 2.3 Frontend / estado

- [ ] `EVENT_APPENDED` solo tras `invoke` con éxito; errores siempre visibles.
- [ ] Una generación de refresh invalida lecturas iniciadas antes de un append (`refreshGenerationRef`).
- [ ] Restauración / importaciones: **una sola** actualización de estado por lote; nunca un `setState` por evento importado.
- [ ] Guardas tipo `waterSaving.current` con watchdog que los libera si el invoke se cuelga.
- [ ] Derivaciones como `goalModeFromEvents` eligen por timestamp (relojes desincronizados entre dispositivos), con override optimista hasta ver el evento.
- [ ] Sin `await` de lecturas caras dentro del `finally` que controla un spinner.

### 2.4 UI táctil y accesibilidad

- [ ] Cero `touch-action: none` en contenedores con scroll; siluetas/gráficos decorativos con `pointer-events: none`.
- [ ] `-webkit-tap-highlight-color: transparent` global; feedback `:active` redondeado bajo `@media (hover: none)`.
- [ ] Pestañas largas en rejilla de 2 filas en pantallas ≤720 px.
- [ ] Tipografías 100% tokenizadas (`--fs-*`, `--font-scale`) y ajustables desde Ajustes → Apariencia, persistidas y aplicadas antes del primer pintado.
- [ ] Textos nuevos siempre en ES y EN (`tx(lang, es, en)`).
- [ ] **Estabilidad del scroll**: cuando OFF devuelve resultados de golpe, la
      interfaz no debe irse al final. `FoodLog.applyRemoteResults` (191) guarda
      `window.scrollY` y `.food-results.scrollTop` antes del `setState` y
      `useLayoutEffect` (199) los restaura antes del pintado; `.food-results`
      lleva `overflow-anchor: none` y `.is-searching` reserva 220 px mientras
      llega la respuesta. Verificar en 390×844 y en dispositivo.

### 2.5 Tests y verificación

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` (incluye tests de retención global y restore).
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`.
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build`.
- [ ] Compilar APK real con NDK (no basta con cargo test: no ejecuta código `cfg(android)`): verificar firma, `INTERNET` y tamaño.
- [ ] Checklist en dispositivo: escribir/editar, agua, objetivo, OFF buscar/añadir, listar copias, restaurar, scroll táctil, fuentes.

---

## 3. Procedimiento

1. Ejecutar el inventario §1 y anotar **todo**, aunque parezca menor.
2. Clasificar cada hallazgo: `Rust`, `Red`, `Estado`, `UI`, `Test`, `Docs`.
3. Para cada hallazgo: evidencia `archivo:línea`, síntoma que explica, plataforma, impacto, corrección y test que lo cubre.
4. Agrupar causalmente (varios síntomas con la misma causa) y corregir **la causa**, no el síntoma.
5. Añadir cada hallazgo y su estado al checklist de `~/Descargas`.
6. Repetir la auditoría completa antes de cerrar la sesión; no darla por terminada con tests en verde si queda algún ítem sin verificar en dispositivo.

---

## 4. Formato del informe

| # | Hallazgo | Evidencia | Capa | Síntoma que explica | Impacto | Corrección / test |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |

Máximo 15 hallazgos, agrupados por causa. Marcar los ya corregidos y los pendientes de prueba en dispositivo. Terminar con: **«No se ha borrado ningún dato del usuario; queda pendiente la prueba en Android real.»**
