---
name: Higiene de archivos
description: Revisar la gestión de archivos remanentes en Better Tracker (logs, temporales, snapshots `longlife`, registros `omega`, descargas del actualizador y artefactos generados) proponiendo limpieza segura sin borrar datos de usuario; usar al revisar diffs de bóveda, backups, actualizaciones o al cerrar una sesión de trabajo.
---

# Higiene de archivos — remanentes, logs, snapshots y registros

Propósito: que no queden **archivos huérfanos, temporales, duplicados ni copias
creciendo sin control**, sin destruir información del usuario. **Revisa y reporta**;
no borres nada sin confirmación explícita.

> Regla de oro: **datos de usuario primero**. Un evento, una copia o una nota son
> valiosos aunque parezcan «viejos». Un `.tmp`, un log de build o un instalador
> descargado son prescindibles. Si hay duda, clasifica y pregunta.

---

## 1. Clasificación antes de tocar nada

| Clase | Ejemplos en este repo | Acción permitida |
| :--- | :--- | :--- |
| **Dato del usuario** | `<bóveda>/omega/devices/<id>/events/*.json`, `events.jsonl` heredado, `longlife/<device>/<fecha>/` | Nunca borrar ni compactar automáticamente; solo con confirmación y copia. |
| **Copia con política** | `longlife/` y `Longlife` (legacy), `snapshot.json`, `.backup-complete` | Aplicar solo la retención vigente (`BACKUP_RETENTION = 7` en `vault.rs`). |
| **Temporal de escritura** | `.<nombre>.<uuid>.tmp` creados por `write_local_event` (`vault.rs:590`) | Borrar solo si la escritura terminó o falló y el destino existe; nunca mientras se escribe. |
| **Descarga del actualizador** | `.deb`/`.rpm`/`.apk` en Descargas (`commands.rs:421/547`) | Limpiar en caso de error/verificación fallida (ya se hace en `commands.rs:465/588`); tras instalación correcta, preguntar. |
| **Log / diagnóstico** | `*.log`, salida de `cargo`/`vite`/CI, volcados de error | Acotar tamaño y rotar; no mezclar con la bóveda. |
| **Artefacto generado** | `dist/`, `node_modules/`, `src-tauri/target/`, `src-tauri/gen/`, iconos generados | Nunca versionar; regenerables con `npm run build` / `cargo`. |
| **Documentación de trabajo** | `docs/CHECKLIST_*`, `docs/releases/*`, parches en `~/Descargas/diffs_*` | Archivar al cerrar la tarea; no borrar evidencia sin permiso. |

---

## 2. Checklist de revisión

### 2.1 Bóveda y registros (`omega/`)

- [ ] ¿El layout es el actual (`omega/devices/<device>/events/<id>.json`) y se sigue
      leyendo el heredado `events.jsonl` (`vault.rs:615-650`)? No elimines el formato
      antiguo: es compatibilidad con datos reales.
- [ ] ¿Los eventos siguen siendo **append-only**? No hay deduplicación destructiva ni
      compactación, salvo la deduplicación por `id` al leer (`:615-629`).
- [ ] ¿Cada archivo respeta `MAX_LOCAL_EVENT_BYTES` (8 MiB) y `MAX_LOCAL_DEPTH` (16)?
      Un evento gigante es sospechoso: reporta, no borres.
- [ ] ¿Se conserva la migración `Longlife` → `longlife` (`:1036-1050`) y la lectura
      de la carpeta en mayúsculas (`:1055+`)? No «normalices» borrando la legacy.

### 2.2 Copias (`longlife/`)

- [ ] ¿La retención está acotada a 7 días **por dispositivo** (`prune_local_device_backups`
      `:1134`, `prune_saf_device_backups` `:1955`)? Nunca aumentes el límite sin decisión.
- [ ] ¿Cada snapshot tiene manifiesto coherente (`manifest_matches` `:956`, SAF `:1716`)
      y marcador `.backup-complete`? Un snapshot `damaged` se reporta, no se silencia.
- [ ] ¿Los archivos `snapshot.json` y `.backup-complete` se cuentan como metadatos, no
      como datos (`snapshot_counts_ignore_its_own_metadata`)?
- [ ] ¿La escritura es atómica (temporal + `rename`, `:588-609`) y no quedan `.tmp`
      huérfanos? Busca `find <bóveda> -name '*.tmp'`.
- [ ] ¿Existen rutas SAF duplicadas por dispositivo/fecha? La deduplicación de raíces
      (`local_backup_roots` `:1017`, `saf_backup_roots` `:1855`) ya las controla.

### 2.3 Descargas e instaladores

- [ ] ¿Los paquetes se descargan en streaming con límite (`MAX_PACKAGE_BYTES` 300 MiB,
      `MAX_APK_BYTES` 180 MiB) y se limpian al fallar o rechazar la firma?
- [ ] ¿`open_update_file` solo abre la última ruta validada
      (`validate_update_file_path`, `commands.rs:506`)? No amplíes la allowlist sin seguridad.
- [ ] ¿El usuario sabe que las descargas quedan en `~/Descargas`? Proponer limpieza
      manual, nunca automática sin confirmar.

### 2.4 Logs, temporales y trabajo interno

- [ ] ¿Hay `*.log`, `*.bak`, `*.orig`, `*.swp`, `*.tmp` sueltos en el repo o en la bóveda?
      Clasifícalos antes de borrar (§1).
- [ ] ¿`git status --short` muestra artefactos generados sin trackear? Deben estar en
      `.gitignore` (`dist/`, `target/`, `gen/`, `node_modules/`).
- [ ] ¿Los parches/checklists de una sesión ya cerrada siguen en `~/Descargas`?
      Archívalos con la versión; no los mezcles con la bóveda ni los borres sin permiso.
- [ ] ¿Los scripts de manifiesto/hash dejaron salidas temporales (`scripts/*.tmp`,
      `latest.json` duplicado)? Ver `scripts/`.

### 2.5 Seguridad de la limpieza

- [ ] Antes de cualquier borrado: **confirmación del usuario + copia de seguridad**.
- [ ] Nunca `rm -rf` sobre una bóveda, `omega/`, `longlife/` ni `~/Descargas` completa.
- [ ] Prefiere mover a una carpeta de cuarentena (`*_revisar`) antes que eliminar.
- [ ] Tras limpiar, verifica que la app arranca y que `vault_backup_status` sigue
      coherente; documenta qué se quitó y por qué.

---

## 3. Formato del informe

| Archivo / patrón | Clase (§1) | Evidencia (`ruta:línea`) | Riesgo | Acción propuesta |
| :--- | :--- | :--- | :--- | :--- |

Añade siempre una línea final: **«No se ha borrado nada; esperando confirmación.»**
(salvo que el usuario autorizara la limpieza explícitamente).

## 4. Comandos de inspección (solo lectura)

```bash
cd /home/alonso/Documentos/Repositorios/BetterTracker
git status --short --ignored | head -80
find . -type f \( -name '*.tmp' -o -name '*.log' -o -name '*.bak' -o -name '*.orig' \) -not -path './node_modules/*' -not -path './src-tauri/target/*'
# Sustituye <bóveda> por la ruta real (nunca por ~/Descargas completa):
find '<bóveda>/longlife' -maxdepth 4 -name 'snapshot.json' -o -name '.backup-complete'
find '<bóveda>' -type f -name '*.tmp'
du -sh '<bóveda>/omega' '<bóveda>/longlife' dist src-tauri/target 2>/dev/null
```

> Estos comandos **no modifican nada**. Cualquier borrado requiere el paso 2.5.

## Referencias rápidas

| Tema | Dónde |
| :--- | :--- |
| Layout de bóveda y constantes | `src-tauri/src/vault.rs:25-48` (`BACKUP_DIR`, `BACKUP_RETENTION`, límites) |
| Escritura atómica y `.tmp` | `src-tauri/src/vault.rs:564-613` |
| Lectura/dedup de eventos y NDJSON | `src-tauri/src/vault.rs:615-743` |
| Copias locales y SAF | `src-tauri/src/vault.rs:931-1473`, `:1474-1998` |
| Retención y manifiesto | `src-tauri/src/vault.rs:956-970`, `:1134-1165`, `:1955-1984` |
| Descargas y limpieza | `src-tauri/src/commands.rs:421-546`, `:547-692` |
| Frontera TS de bóveda | `src/vault.ts` (`listEvents`, `appendEvent`, `restoreSnapshot`) |
| Ignorados por git | `.gitignore` |
