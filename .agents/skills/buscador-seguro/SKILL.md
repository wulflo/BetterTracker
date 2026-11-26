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
| Backend | `src-tauri/src/barcode.rs` (`lookup_barcode`, `search_foods_remote`) | URL fija, timeout, límites, caché, mapping. |
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
- [ ] **URL fija**: el host y los campos están escritos en el backend; el usuario
      nunca controla la URL ni el path (ni `..`, ni esquemas `javascript:`/`file:`).
- [ ] **Saneado en dos capas**: TS recorta y colapsa espacios; Rust rechaza vacío,
      >80 caracteres, caracteres de control y lo que no sea alfanumérico/espacio
      o `-_,¿?¡!.`. Comprobar que ambas capas coinciden.
- [ ] **Límites**: `page_size` y número máximo de resultados (8), longitud máxima
      de consulta y de entrada del campo (`maxLength`).
- [ ] **Timeout y User-Agent** en el cliente HTTP; sin secretos ni credenciales.
- [ ] **Caché acotada**: TTL y número máximo de entradas; sin mapas que crezcan
      sin límite ni caché compartida sin sincronización.
- [ ] **Sin HTML**: los resultados se renderizan como texto de React; nunca
      `innerHTML` ni `dangerouslySetInnerHTML` con datos remotos.
- [ ] **Errores**: se muestran mensajes traducidos y genéricos, sin volcar la
      respuesta cruda del proveedor ni trazas.
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
