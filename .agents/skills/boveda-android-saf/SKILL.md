---
name: Bóveda Android SAF
description: Verificar que la bóveda en Android (selector SAF / tauri-plugin-android-fs) escriba eventos y lea/restaure copias longlife con el mismo coste y corrección que en escritorio; usar antes de tocar `vault.rs`, `commands.rs`, `vault.ts` o la UI de copias, y al investigar «no guarda en Android», «tarda mucho en leer snapshots» o «no restaura la copia».
---

# Bóveda Android SAF — escritura, snapshots y restauración

Propósito: impedir que el puente Rust↔Android se comporte distinto del escritorio.
En escritorio una lectura de la bóveda son llamadas `std::fs` baratas; en SAF cada
`read_dir`, `read`, `read_to_string`, `create_new_file` y `write` es un viaje
**sincrónico** al proceso Android (`AndroidFsExt::android_fs()` →
`run_mobile_plugin`). Un patrón correcto en local se vuelve aquí un bucle de
miles de IPC que congela la app y acaba fallando.

> Síntoma que motiva esta skill: en desktop todo funciona; en Android fallan las
> escrituras en la bóveda y el lector de snapshots tarda muchísimo y no consigue
> restaurar. **No se da por arreglado hasta que pase esta skill**, aunque los
> tests de escritorio estén en verde: `cargo test` no ejecuta ni una sola línea
> `#[cfg(target_os = "android")]`.

---

## 1. Reglas de escritura (append_event / backup / restore)

| Regla | Evidencia del riesgo | Obligación |
| :--- | :--- | :--- |
| No asumir que el nombre-creado es el nombre-pedido | `create_new_file` crea los padres, pero **añade un sufijo si el archivo ya existe y el proveedor puede sanear el nombre** (documentación del plugin 30.2 y `DocumentFileController.kt:213-239`) | Tras crear, verificar el nombre real (`create_new_file_and_return_relative_path` o `read_dir`) antes de dar el evento por guardado. Nombres canónicos: `<id>.json`, `events.jsonl`, `snapshot.json`, `.backup-complete`. |
| Idempotencia | `append_event` SAF (`vault.rs:464-479`) comprueba con `saf_lookup_file` y luego crea;si el proveedor cambió el nombre, la comprobación falla y se acumulan duplicados | La deduplicación debe basarse en el **id del evento**, nunca solo en coincidencia exacta de nombre de archivo. `read_events` ya deduplica por id (`vault.rs:617-620`); conservarlo. |
| Copia lenta por evento | `run_saf_backup` copiaba un `.json` por evento con ~3-4 IPC por archivo | Escribir **un solo `snapshot-events.jsonl`** con todos los eventos y declarar su recuento/tamaño en `snapshot.json`. El formato de `omega` no cambia: la sincronización externa sigue funcionando. Copias antiguas con árbol se leen igual. |
| Copias incompletas | `run_saf_backup` creaba eventos, `snapshot.json` y `.backup-complete` con `create_new_file` sin verificar el nombre real; si el proveedor renombraba el marcador, `saf_snapshot_info` no lo encontraba y la copia salía «Incompleta» | Usar `saf_write_new_file` (2062) para **todos** los archivos de la copia, incluido `.backup-complete`; verificar nombre y borrar duplicados. Además, crear el marcador con MIME concreto `application/octet-stream`: `text/plain` provoca que SAF añada `.txt` (flutter_file_picker#1843) y `*/*` está desaconsejado en `DocumentsContract.createDocument` (AndroidX CreateDocument lo deprecia). |
| Invoke SAF colgado | `Working…` indefinitely / «restore still running»; Tauri #14994 (tao#1271) dejaba un IPC esperando hasta el siguiente mensaje | Los watchdogs de 30 s hacen un `getAppInfo()` barato para desbloquear; el de 180 s libera el botón. No sustituye a corregir la causa, pero evita el bloqueo permanente. |
| Atomicidad | En local se escribe `.tmp` + `rename` (`vault.rs:581-605`); SAF no puede renombrar | En SAF el archivo se **crea nuevo** y se escribe una sola vez. Nunca reescribir un archivo existente con `write` y nunca borrar el destino antes de tener el contenido completo. |
| Serialización | `WRITE_LOCK` (`vault.rs:48`) protege evento copia/restauración | Mantener el lock alrededor de la operación completa, pero **no dejar IPC colgados dentro de él** más de lo imprescindible. |
| Persistencia del permiso | `select_vault` (`:319-321`) guarda `persist_uri_permission` y serializa `FsUri` (`:323-325`) | `saf_uri_from_root` (`:171-218`) debe reconstruir exactamente el JSON camelCase del plugin (`uri`, `documentTopTreeUri`), además del legado `topTreeUri`. Si el permiso se pierde, el error debe ser explícito, no un «no hay datos» silencioso. |

## 2. Reglas de lectura y snapshots (anti-bloqueo)

**Prohibido en SAF:** leer el contenido de todos los archivos para obtener
metadatos o para saber qué eventos ya existen.

| Defecto a vigilar | Evidencia actual | Corrección exigida |
| :--- | :--- | :--- |
| Contar bytes leyendo cada archivo | `saf_count_dir` (`vault.rs:1667-1679`) hace `android_fs().read(file)` por archivo; `read_dir` ya devuelve `Entry::file_len()` (plugin `entry.rs:125-131`, `EntryOptions::ALL`) | Usar `entry.file_len()`; **cero `read()` para contar**. |
| Contar dos veces la misma copia | `saf_snapshot_info` (`:1738`) llama `saf_count_dir`, y `saf_manifest_matches` (`:1716`) lo vuelve a hacer | Calcular `(files, bytes)` **una vez** por snapshot y reutilizarlo para `healthy`/`damaged`. |
| Leer toda la bóveda para restaurar | `restore_saf_snapshot` (`:1546-1547`) llama `read_saf_events_from_dir` + `read_saf_events`; ésta (`:1498-1509`) lee el contenido de **todos** los eventos actuales por IPC | Los eventos actuales se identifican por **nombre de archivo** (`<id>.json`), sin `read_to_string`. Solo se lee el contenido de los eventos que falten. |
| Recursión sin límites en SAF | `read_saf_events_from_dir` (`:1466-1495`) no aplica profundidad ni tamaño; en local sí (`:663-695`, `MAX_LOCAL_DEPTH`/`MAX_LOCAL_EVENT_BYTES`) | Aplicar los mismos límites en SAF (`MAX_SAF_DEPTH`, 8 MiB, saltar `snapshot.json`, `.backup-complete` y `*.tmp`). |
| `Promise.all`/paralelismo sobre archivos SAF | Cualquier lista sin acotar | Procesar por lotes o en un único `spawn_blocking`; nunca lanzar IPC por evento desde el hilo de UI. |

Preservar el patrón sano de `App.tsx`: una sola carga con `list_events` y
`lastLocalAppendRef` para no releer tras cada append (`rendimiento-ligereza`).

**Verificado en dispositivo (2026-11-27)**: creación, listado y restauración de snapshots funcionan con el formato de un solo NDJSON, **incluidas copias antiguas con árbol `omega`**. No usar nombres de herramientas de sincronización concretas en código ni docs: hablar de «sincronizador externo» o «servicio externo».

## 3. Tests obligatorios (antes de dar el cambio por cerrado)

Los tests de escritorio **no cubren SAF**. Hay que añadir capas que sí lo hagan:

### 3.1 Unitarios en host (sin dispositivo)

- [ ] Helpers puros **no escondidos tras `#[cfg(target_os = "android")]`** para
      poder probarlos en Linux: `saf_uri_from_root`, validación de `id` de
      snapshot (`:1512-1540`), extracción de id desde `<id>.json`,
      `build_restore_result` (`:1353-1375`) y `restore_folder_name`.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` pasa, incluidos los
      tests locales existentes de copias/restore (`vault.rs:2213+`).
- [ ] Test de conteo: con una lista de entradas falsas (`name`, `is_dir`,
      `file_len`) se comprueba que `snapshot.json` y `.backup-complete` **no**
      cuentan, que los bytes salen de `file_len` y que se cuenta **una sola vez**
      por snapshot.
- [ ] Test de plan de restauración: dado un conjunto de ids actuales, solo se
      leen/escriben los eventos faltantes; los ya presentes nunca se leen.

### 3.2 Doble de bóveda (recomendado para blindar el rendimiento)

- [ ] Extraer una interfaz mínima (`read_dir` → entradas con `name/is_dir/len`,
      `read`, `create_new_file`, `write`) con implementación local, SAF y un
      `FakeVault` en memoria que **cuente las operaciones**.
- [ ] Test con 7 snapshots × 500 eventos: `backup_status` debe hacer **0** lecturas
      de contenido (`read`) y un número acotado de `read_dir`; `restore` debe
      leer solo los eventos ausentes. Guardar los umbrales como aserciones para
      que una futura regressions rompa el test.

### 3.3 Dispositivo real (no sustituible)

- [ ] Seleccionar bóveda con SAF en Android 13+, crear un evento, **forzar
      parada** de la app, reabrir y verificar que el evento sigue ahí.
- [ ] Con ≥200 eventos, cronometrar: apertura de Ajustes → copias (<2 s) y
      «Restaurar» (<3 s). Si tarda más, hay otra vez un bucle de IPC.
- [ ] Borrar algunos eventos, restaurar una copia y comprobar: `imported > 0`,
      los eventos aparecen tras actualizar y **no hay ids duplicados**.
- [ ] Verificar con un gestor de archivos que los nombres son exactos
      (`<id>.json`, `events.jsonl`), sin `(1)`, `.json.json` ni `.tmp` huérfanos.
- [ ] Reiniciar el móvil y repetir un append: el permiso persistido debe seguir
      funcionando.

## 4. Verificación estática y de regresión

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npx tsc --noEmit
npm test
npm run build
npx knip                  # si está disponible: archivos/funciones huérfanas
npx jscpd src/            # si está disponible: bloques duplicados
git status --short
```

Si el cambio toca bóveda, revisar también `src-tauri/examples/bench_vault.rs` y
que no queden comandos `#[tauri::command]` registrados sin uso.

## 5. Checklist final (marcar todo antes de responder)

- [ ] `append_event` SAF crea el archivo con el nombre canónico y verifica el
      nombre real devuelto por el plugin.
- [ ] No hay ningún `read`/`read_to_string` SAF usado solo para contar o para
      comprobar existencia.
- [ ] `backup_status` cuenta cada snapshot una sola vez y usa `file_len()`.
- [ ] La restauración solo lee los eventos faltantes y respeta los ids ya
      presentes.
- [ ] Límites de profundidad/tamaño aplicados también en SAF.
- [ ] Tests de §3.1 y §3.2 en verde; §3.3 ejecutado o explicitamente pendiente
      con motivo.
- [ ] No se ha borrado ni compactado ningún dato del usuario (`omega/`,
      `longlife/`).

## 6. Formato del informe

| Hallazgo | Evidencia (`archivo:línea`) | Plataforma | Impacto | Corrección / test que lo cubre |
| :--- | :--- | :--- | :--- | :--- |

Máximo 10 hallazgos; distingue **rapid fix** de refactor. Si el hallazgo es de
interfaz (tiempo de carga percibido, spinner), cruza el informe con
`Rendimiento y ligereza` y `Estilo UI`.
