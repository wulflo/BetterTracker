---
name: Estructure
description: OBLIGATORIA antes de editar cualquier archivo de Better Tracker. Lee docs/Estructure.md como mapa para localizar código; tras el cambio actualiza únicamente las secciones afectadas, conservando tablas y números de línea aproximados. No toques código de aplicación desde esta skill.
---

**Protocolo (siempre, antes de cualquier `edit`/`write` en el proyecto):**

1. Lee `docs/Estructure.md` y usa sus tablas como mapa: busca el **nombre del
   símbolo**, no solo el número de línea (las líneas son aproximadas).
2. Localiza el símbolo real en el código con `grep` antes de editar.
3. Tras el cambio, vuelve a `docs/Estructure.md` y actualiza **solo** las
   secciones y filas afectadas: rutas de archivos, firmas de comandos, flujos
   y números de línea aproximados. Conserva el formato de tablas; no reescribas
   el índice completo.
4. Si el cambio afecta a símbolos documentados en guías de usuario, usa
   `guia-de-uso`; si es bóveda/Android, carga también `boveda-android-saf` y
   `android-review`; si es interfaz, `estilo-ui` / `critica-visual`.
5. Esta skill **no modifica código de aplicación**: solo el mapa documental.

El mapa `docs/Estructure.md` fue sincronizado con el código el 2026-11-27: incluye
índice `BTI1`/deltas, `vault_fingerprint`, 19 comandos, snapshots SAF de un solo
NDJSON, watchdogs, base neutra de color y saludo `profile.saved`.

No se ha borrado ningún dato del usuario (`omega/`, `longlife/`).
