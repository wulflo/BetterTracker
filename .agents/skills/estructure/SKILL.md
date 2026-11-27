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
NDJSON, watchdogs, base neutra de color y saludo `profile.saved`. En la misma fecha
se actualizó `barcode.rs` (§2.2, §8.2, §8.4, §9.2, §12.3): en **Windows**,
`OFF_SEARCH_ALICIOUS` (`search.openfoodfacts.org/search`) es la vía principal y
`OFF_SEARCH_ENDPOINTS` queda en 2 hosts legacy de respaldo; Linux/Android conservan
los 3 originales. `ALICIOUS_FIELDS` pide `nutriments` en la misma respuesta, así
que una búsqueda cuesta **una sola petición** (antes se leía cada producto);
`ALICIOUS_PAGE_SIZE = 60` y `alicious_product` normalizan las etiquetas. También se
documentaron `SEARCH_DEADLINE`/timeout por petición, `SEARCH_CACHE` (600 s) y el
backoff 30–600 s (sin caché negativa), el fix de scroll de `FoodLog`/`styles.css`,
`status_detail`/`html_title` para distinguir un 503 de OFF de uno de proxy, el
segundo cliente `http_client_no_proxy()`, y la feature `system-proxy` de reqwest
activada explícitamente para igualar la ruta de red de la build de Store y la
normal. Seguimiento: `~/Descargas/CHECKLIST_WINDOWS_OFF_503.md`.

No se ha borrado ningún dato del usuario (`omega/`, `longlife/`).
