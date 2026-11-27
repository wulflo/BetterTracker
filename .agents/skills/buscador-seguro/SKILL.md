---
name: Buscador seguro
description: Revisar que los buscadores de Better Tracker (especialmente el unificado de alimentos: base local, códigos y Open Food Facts por palabras clave) funcionen y sean seguros, sin fetch desde el webview, con consultas saneadas y resultados acotados; usar al tocar FoodLog.tsx, vault.ts, barcode.rs o cualquier campo de búsqueda.
---

# Buscador seguro — funcionamiento y defensa

Propósito: verificar que un buscador **encuentre lo que debe** y que **no pueda
convertirse en un vector de ataque ni colgar la UI**. **Revisa y reporta**; no
cambies código salvo petición explícita.

> Complementa a `Saneado de texto` (entrada) y a `Rendimiento y ligereza` (coste).
> Aquí el foco es la consulta, la red y los resultados.

---

## 1. Alcance

| Pieza | Dónde | Qué revisar |
| :--- | :--- | :--- |
| Campo unificado | `src/components/FoodLog.tsx` | Detección de código vs. texto, debounce, resultados y botón «+». |
| Frontera TS | `src/vault.ts` (`lookupBarcode`, `searchFoodsRemote`) | IPC en nativo, saneado, modo navegador. |
| Backend | `src-tauri/src/barcode.rs` (`lookup_barcode`, `search_foods_remote`, `search_alicious`) | Hosts fijos (`OFF_SEARCH_ALICIOUS` + `OFF_SEARCH_ENDPOINTS`), presupuesto global + timeout por petición, límites y backoff, caché positiva, mapping. |
| Registro | `src-tauri/src/lib.rs` (`generate_handler!`) | Comandos registrados y usados. |
| Datos | `src/foodDb.ts` (`searchFoods`, `findFoodByBarcode`), `src/barcodeCatalog.ts` | Límites, caché, búsqueda por clave. |
| CSP | `src-tauri/tauri.conf.json` | `connect-src 'none'`: ningún `fetch` en el webview. |

---

## 2. Funcionamiento

- [ ] ¿Un mismo campo detecta correctamente las dos modalidades? 6–14 dígitos →
      código de barras; texto → búsqueda por palabras clave.
- [ ] ¿El lector USB/Bluetooth que termina en Enter sigue funcionando (submit)?
- [ ] ¿Se conserva la comprobación del dígito de control GTIN y la opción «Buscar igual»?
- [ ] ¿La búsqueda local funciona **sin red** y se muestra primero?
- [ ] ¿Hay debounce (~300 ms) y se descartan respuestas obsoletas (id de petición)?
- [ ] ¿Los resultados se deduplican (por código) y llevan etiqueta de origen?
- [ ] ¿El botón «+» guarda el alimento remoto como `food.saved` antes de añadirlo
      a la ingesta, para poder usarlo sin conexión?
- [ ] ¿Los estados vacíos, de carga y de error son claros y no bloquean la UI?
- [ ] ¿En modo navegador la ausencia de Rust se explica y no rompe el flujo?
- [ ] ¿Los textos y tooltips están en ES y EN (`tx`/`t`)?

---

## 3. Seguridad

- [ ] **CSP**: `connect-src 'none'`. En la app nativa, ninguna búsqueda usa `fetch`
      desde React; todo pasa por `invoke` a Rust.
- [ ] **URL fija**: los hosts y los campos están escritos en el backend; el usuario
      nunca controla la URL ni el path (ni `..`, ni esquemas `javascript:`/`file:`).
      La búsqueda por palabras clave en **Windows** usa `OFF_SEARCH_ALICIOUS`
      (`https://search.openfoodfacts.org/search`) como vía principal y solo
      `OFF_SEARCH_ENDPOINTS` (2 hosts legacy: `world/cgi` y `fr/cgi`) como
      respaldo; en **Linux/Android** se conservan los 3 endpoints originales
      (`world/cgi`, `fr/cgi`, `world/api/v2`) porque ya funcionaban: no los cambies
      «para uniformizar». Todo debe ser HTTPS y terminar en `.openfoodfacts.org`;
      verificar que no se añada un host nuevo sin revisar y que la lista no tenga
      duplicados.
- [ ] **503 anónimo de OFF**: la página de error indica límite de peticiones para
      usuarios anónimos y prioridad para registrados; **no** es un fallo de permiso
      INTERNET, de TLS ni de CSP, y **no** es específico de Windows/Android. Si
      aparece 503, comprobar primero qué hosts responden con `curl` (UA de la app)
      antes de culpar a una plataforma. En Windows el cliente prueba primero
      Search-a-licious y, solo si falla, los 2 hosts legacy; conserva el primer
      estado HTTP para diagnóstico y muestra un aviso accionable en ES/EN
      (`FoodLog.tsx`); en Linux/Android se mantiene el mensaje original.
      `status_detail`/`html_title` añaden `Server` y `<title>` al error: si el 503
      viene de OFF dirá `nginx` y «Page temporarily unavailable…»; si lo devuelve
      un proxy intermedio, se verá otro servidor/página.
- [ ] **MSIX de Store**: `runFullTrust` ya da acceso de red a una app desktop de
      integridad media; `internetClient` solo aplica a apps AppContainer, así que
      **no** es la causa de un 503 (fuente: docs de Microsoft sobre capabilities).
      Un bloqueo de permisos/firewall daría «No se pudo consultar…», no un estado
      HTTP. Antes de culpar a permisos, pedir el texto completo del aviso.
- [ ] **Proxy del sistema (Windows)**: `reqwest 0.12.28` crea el cliente con
      `auto_sys_proxy = true`, así que la ruta de salida depende de
      `HTTP_PROXY`/`HTTPS_PROXY` y, en Windows, del registro. La build de Store
      (`--no-default-features --features microsoft-store`) no activaba
      `hyper-util/client-proxy-system` al excluir el updater, mientras que la
      normal lo heredaba de él: única diferencia de red verificable entre ambas.
      Debe seguir activada la feature `system-proxy` de reqwest en `Cargo.toml`
      (con `cargo tree -e features -i hyper-util` en ambos perfiles). Además,
      `search_foods_remote` prueba en Windows el cliente del sistema y el directo
      (`http_client_no_proxy()`, `.no_proxy()`) y se queda con el primero que
      responda. Comprobar que `not(windows)` sigue usando solo el cliente original
      dos veces.
- [ ] **Buscador legacy de OFF deprecado**: `cgi/search.pl` devuelve 503 en
      **casi todas** las búsquedas de texto (medido 10/12 el 2026-11-27; el propio
      equipo de OFF lo confirma en `openfoodfacts-dart#1263` y
      `SparkyFitness#1079`), y no es un fallo exclusivo de Windows. El reemplazo
      oficial es `search.openfoodfacts.org/search?q=…` (respuesta `hits`). Con
      `fields=code,product_name,…,nutriments,…` **trae las macros en la misma
      respuesta**: no hay que leer los productos uno por uno con
      `/api/v2/product/{code}.json` (eso costaba hasta 16 lecturas por búsqueda).
      `ALICIOUS_PAGE_SIZE = 60` compensa que solo parte del índice tiene macros y
      `alicious_product` normaliza `brands`/`categories`. `q` es Lucene: hay que
      limpiar `?`, `¿`, `:`, `(`, `)`, `"`, `~`, `^`, `*`, `\`, `/`, `+`, `|`,
      `&` (`alicious_query`), o devuelve 0 resultados. En Windows se prueba primero
      con **una sola** petición de búsqueda; los 2 hosts legacy quedan solo como
      respaldo. No añadir hosts nuevos escritos a mano sin verificarlos con `curl`.
- [ ] **Límites de OFF**: 10 búsquedas/min/IP y 15 lecturas de producto/min/IP;
      al superarlos responde 503 (y puede bloquear la IP). `take_rate_budget`
      aplica 8 búsquedas por minuto en Windows (`PRODUCT_RATE` de 12 existe, pero
      hoy solo se usa en tests: no lo consume la búsqueda), y un 503/429 activa
      `note_rate_limited` (30 s → 60 → 120 → 240 → 600 s). Nunca reintentar en
      bucle: una búsqueda no debe lanzar 6 peticiones ni repetir hosts en paralelo.
- [ ] **Saneado en dos capas**: TS recorta y colapsa espacios; Rust rechaza vacío,
      >80 caracteres, caracteres de control y lo que no sea alfanumérico/espacio
      o `-_,¿?¡!.`. Comprobar que ambas capas coinciden.
- [ ] **Límites**: `page_size` y número máximo de resultados (8), longitud máxima
      de consulta y de entrada del campo (`maxLength`).
- [ ] **Timeout y User-Agent** en el cliente HTTP; sin secretos ni credenciales.
      El presupuesto total es `SEARCH_DEADLINE = 20 s`; en Windows cada petición
      lleva `.timeout(remaining)` para que un timeout suelto de 12 s no lo rebase.
      En Linux/Android se mantiene solo el timeout del cliente (ruta original).
- [ ] **Caché acotada**: `SEARCH_CACHE` (600 s) para aciertos en todas las
      plataformas. En Windows, el backoff (`SEARCH_BACKOFF`, 30–600 s) evita
      relanzar peticiones mientras OFF está saturado y un éxito lo reinicia; no
      volver a introducir una caché negativa paralela. Verificar que
      `cfg(not(windows))` no aplica ni presupuesto ni backoff.
- [ ] **Sin HTML**: los resultados se renderizan como texto de React; nunca
      `innerHTML` ni `dangerouslySetInnerHTML` con datos remotos.
- [ ] **Errores**: se muestran mensajes traducidos y accionables, sin volcar la
      respuesta cruda del proveedor ni trazas. Para un 503 se indica el estado
      HTTP y que la búsqueda local sigue disponible (`errorText` + `tx`).
- [ ] **Pegado**: el guardián global (`src/inputGuard.ts`) sigue aplicando texto
      plano; el buscador no añade un listener que lo contradiga.
- [ ] **Sin bucles**: la búsqueda remota no se dispara en cada render ni por cada
      tecla sin debounce; no hay `setState` en el callback de red sin guardia.

---

## 4. Verificación

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo deny --manifest-path src-tauri/Cargo.toml check
npm audit --omit=dev --audit-level=high
```

Casos manuales recomendados: consulta vacía, un carácter, 200 caracteres,
`leche\n<script>`, código de 5 y de 15 dígitos, checksum inválido, red caída,
mismo término repetido (caché) y añadir un resultado remoto y recargar la app.

---

## 5. Formato del informe

| Hallazgo | Evidencia (`archivo:línea`) | Funciona / Seguro / Riesgo | Propuesta |
| :--- | :--- | :--- | :--- |

Prioriza los **bloqueantes** (fetch desde webview, URL controlable por el usuario,
HTML inyectable, sin límite de resultados) sobre las mejoras de UX. Si no hay
hallazgos, dilo explícitamente.

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Campo unificado | `src/components/FoodLog.tsx` |
| Comandos de red | `src-tauri/src/barcode.rs`, `src-tauri/src/lib.rs` |
| TS ↔ Rust | `src/vault.ts` |
| Datos locales | `src/foodDb.ts`, `src/barcodeCatalog.ts` |
| CSP | `src-tauri/tauri.conf.json` |
| Saneado de pegado | `src/inputGuard.ts`, skill `Saneado de texto` |
