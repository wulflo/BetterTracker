# Estructure

> **Índice técnico detallado de Better Tracker (Better Fitness Tracker).**
>
> Versión del código indexada: **0.10.7** (`VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `VAULT_SCHEMA_VERSION = 1`).
> Fecha del índice: **2026-11-27**.
>
> Este documento **no modifica ni describe cambios en el código**: es solo un mapa de referencia.
> Responde a la pregunta _«¿dónde está la pieza que hace que funcione cada cosa?»_.
> Está escrito para que, partiendo de una funcionalidad observable en la app, puedas llegar al
> archivo, función, comando Rust o clave de almacenamiento exactos que la implementa — y viceversa.

---

## 0. Cómo leer este documento

### 0.1 Convenciones

| Notación | Significado |
| :--- | :--- |
| `ruta/archivo.tsx:123` | Archivo y línea aproximada donde empieza el símbolo. Las líneas son las de la versión 0.10.7 y pueden moverse con edits posteriores; el **nombre del símbolo** es el dato estable. |
| `símbolo()` | Función, componente o método exportado. |
| `#[tauri::command]` | Función Rust expuesta al frontend mediante `invoke("nombre")`. |
| `LNNN` | Número de línea dentro del archivo que se está describiendo. |
| `[F]`, `[D]`, `[R]`, `[I]` | Etiquetas de capa: frontend/dominio, React/UI, Rust/backend, infraestructura. Se usan en el índice final (§12). |

### 0.2 Estructura del documento

1. **§1 Mapa general** — capas, arranque, modos de app, frontera TS↔Rust.
2. **§2 Índice maestro de archivos** — inventario con líneas y responsabilidad.
3. **§3 Modelo de datos y persistencia** — tipos, `localStorage`, bóveda, copias `longlife`.
4. **§4 Núcleo de dominio** — energía, composición corporal, proyección, nutrición, zonas, códigos.
5. **§5 Frontend React** — shell, vistas y componentes.
6. **§6 Interfaz** — i18n, tema, CSS y selector.
7. **§7 Servicios compartidos** — bóveda TS, actualizaciones, enlaces, guardias.
8. **§8 Backend Rust / Tauri** — comandos, persistencia, seguridad, actualizaciones.
9. **§9 Pruebas** — Vitest y Playwright.
10. **§10 Build, CI, releases y empaquetado**.
11. **§11 Documentación existente** (índice, no duplicar).
12. **§12 Índice funcionalidad → código** — la tabla de búsqueda rápida.
13. **§13 Glosario** — eventos, unidades y convenciones.

### 0.3 Documentación relacionada (no duplicar)

| Documento | Qué contiene | Cuándo consultarlo |
| :--- | :--- | :--- |
| `README.md` / `README.es.md` | Visión general, features, build por plataforma. | Primer contacto. |
| `docs/USAGE.md` / `docs/USAGE.en.md` | Guía de usuario (es / en): proyección, composición, actualizaciones. | Cómo se usa, no dónde está. |
| `docs/METODOLOGIA.md` | Fórmulas y fuentes científicas (TDEE, composición, Monte Carlo, fuerza). | Por qué un cálculo. |
| `docs/VERSIONING.md` | Fuente única de versión, manifiestos, firma y publicación. | Publicar versión. |
| `docs/KEYSTORES.md` / `docs/RELEASE_SECRETS.md` | Claves de firma, keystore Android y secretos. | Firmar artefactos. |
| `docs/MICROSOFT_STORE.md` | Identidad MSIX y flujo de Partner Center. | Publicar en la Store. |
| `DECISIONES.md` | Por qué se eligió cada arquitectura (HTTP/TLS, bóveda, actualizaciones, UI). | Contexto histórico. |
| `docs/AVANCES.md`, `docs/releases/v*.md` | Estado y trazabilidad de fases. | Seguimiento de trabajo. |
| `PRIVACY_POLICY.md` / `THIRD_PARTY_LICENSES.md` | Privacidad y licencias. | Cumplimiento. |

---

## 1. Mapa general del sistema

### 1.1 Capas y tecnologías

```
                      ┌──────────────────────────────────────┐
                      │ index.html (18 líneas) + theme-init.js│
                      │ #root + tema aplicado antes del pintado│
                      └───────────────┬──────────────────────┘
                                      │ <script type="module" src="/src/main.tsx">
                      ┌───────────────▼──────────────────────┐
                      │ src/main.tsx → ThemeProvider →       │
                      │ LanguageProvider → App.tsx (1258 L)   │
                      └───────────────┬──────────────────────┘
                    ┌─────────────────┼──────────────────┐
        ┌───────────▼──────────┐  ┌───▼────────────┐  ┌──▼──────────────────┐
        │ Vistas (5)           │  │ Servicios      │  │ Dominio puro        │
        │ Panel/Training/      │  │ vault.ts,      │  │ metrics.ts (2323 L) │
        │ History/Body/        │  │ updater.ts,    │  │ bodyRange.ts (1376) │
        │ Wellness             │  │ links.ts       │  │ nutrition/recipes/  │
        └───────────┬──────────┘  └───┬────────────┘  │ wellness/foodDb     │
                    └─────────────────┼───────────────└──┬──────────────────┘
                                      │ invoke()
                      ┌───────────────▼──────────────────────┐
                      │ src-tauri/src/lib.rs (126 L)         │
                      │ 19 comandos + plugins + single-instance│
                      │ commands.rs · vault.rs · barcode.rs   │
                      └───────────────┬──────────────────────┘
                                      │ FS / HTTPS (Rust)
                      ┌───────────────▼──────────────────────┐
                      │ Bóveda: <vault>/omega/…/*.json       │
                      │ Copias: <vault>/longlife/<device>/…  │
                      │ GitHub Releases · Open Food Facts    │
                      └──────────────────────────────────────┘
```

- **Desktop/móvil:** Tauri v2 + Rust + React 18 + TypeScript + Vite 6. Sin react-router: la
  navegación es estado local de React (`View` en `App.tsx:35`).
- **Sin Tailwind y sin base de datos.** Toda la UI es React + CSS en `src/styles.css`; la
  persistencia es un log append-only de eventos JSON en la bóveda.
- **Dependencias npm relevantes:** `@tauri-apps/api`, `plugin-process`, `plugin-updater`, React/ReactDOM.
- **Dependencias Rust relevantes:** `tauri` 2, `tauri-plugin-dialog/opener/single-instance/updater/process/android-fs`,
  `serde`, `uuid`, `chrono`, `reqwest` 0.12 (rustls-webpki), `minisign-verify`, `sha2`, `base64`.

### 1.2 Puntos de entrada

| Archivo | Líneas | Rol |
| :--- | ---: | :--- |
| `index.html` | 18 | Documento único con `<div id="root">`, meta de tema y dos scripts. |
| `public/theme-init.js` | 17 | IIFE síncrono que aplica `bt.theme`/`bt.accent` antes del primer pintado (la CSP prohíbe inline scripts). |
| `src/main.tsx` | 25 | `boot()` (11): `installInputGuard()`, `createRoot`, providers y `invoke("frontend_ready")` 700 ms después. |
| `src/App.tsx` | 1258 | Shell, navegación, bóveda/backups con watchdog, Ajustes con pestañas, saludo y toasts. |
| `src/theme.tsx` | 108 | Modo (dark/light) + 9 acentos; `applyTheme()` (56). |
| `src/i18n.tsx` | 97 | `es`/`en`, `t()`, `tx()`, `locale()`, `plural()`, `formatNumber()`. |
| `vite.config.ts` | 14 | `root: '.'`, `publicDir: 'public'`, JSX automático, puerto 1420. |
| `tsconfig.json` | 14 | Strict, `jsx: react-jsx`, `moduleResolution: bundler`, `noEmit`. |

### 1.3 Flujo de arranque

1. `index.html:12` carga `theme-init.js` de forma síncrona: lee `bt.theme` y `bt.accent` y escribe
   `document.documentElement.dataset.theme` / `.accent`.
2. `index.html:16` carga `/src/main.tsx`; `src/styles.css` se importa en `main.tsx:9`.
3. `boot()` (`main.tsx:11-23`) instala el guardia de pegado, monta
   `ThemeProvider > LanguageProvider > App` y, si `isTauri()`, avisa al backend con
   `frontend_ready` para cerrar la splash y mostrar la ventana `main`.
4. `App.tsx:177-190` pide `get_app_info`, `get_vault_info` y `get_device_id`; si no hay bóveda,
   muestra la pantalla hero con «Seleccionar bóveda» (`625-646`) y un campo opcional «Tu nombre», guardado como `profile.saved` (`App.tsx:310-330`).
5. Si hay bóveda: `refresh()` (`129-168`) llama a `list_events()`, guarda el contador en
   `bt.event-count:<vault>` y detecta regresiones externas de la bóveda.
6. Red de seguridad en Rust: `lib.rs:49-65` muestra `main` a los 10 s aunque el frontend no
   haya llamado a `frontend_ready`.

### 1.4 Modos de app

| Modo | Cómo se detecta | Particularidades |
| :--- | :--- | :--- |
| Escritorio (GitHub Releases) | Tauri con feature `updater` | Actualizador nativo + descarga propia de `.deb`/`.rpm`; ventanas `splash`/`main`; single-instance. |
| Microsoft Store | `npm run build:store` (`--no-default-features --features microsoft-store`) | Sin updater ni `process`; capability `updater.json` excluida; MSIX firmado por Microsoft. |
| Navegador | `isTauri() === false` (`vault.ts:13`) | Bóveda simulada en `bt.mock.*`; sin backups ni actualizaciones; `seedSample()` en Ajustes. |
| Android | `target_os = "android"` | Bóveda SAF; `tauri_plugin_android_fs`; sin single-instance; APK descargada por Rust a Descargas. |
| iOS | `cfg(mobile)` | Bóveda interna; `select_vault` devuelve error (`vault.rs:337-341`). |

### 1.5 El DOM maestro y las ventanas

- `index.html`: `<html lang="es">`, meta `theme-color`, `#root`, `theme-init.js` y `main.tsx`.
- `tauri.conf.json:13-39`: ventana `splash` (420×260, visible, `splash.html`) y `main`
  (1200×800, mínimo 900×600, `visible: false`, sin decoraciones).
- `WindowChrome.tsx` implementa los controles y tiradores de redimensionado con
  `getCurrentWindow()` (solo desktop); `frontend_ready` o el watchdog hacen la transición.
- CSP (`tauri.conf.json:42`): `connect-src 'none'`; **toda la red sale de Rust**, nunca del webview.

### 1.6 Frontera TypeScript ↔ Rust: `invoke` ↔ comando

El frontend usa 19 llamadas `invoke` (13 wrappers en `vault.ts`, 3 en `updater.ts`, una en `links.ts`, una en `main.tsx`, una en `UpdatePanel.tsx`). El backend registra 19 comandos (§8.2).

| `invoke` | Definición Rust | Quién lo llama (frontend) |
| :--- | :--- | :--- |
| `frontend_ready` | `commands.rs:748` | `main.tsx:21` (`boot`) |
| `get_vault_info` | `vault.rs:506` | `vault.ts:95` → `App.tsx:125` |
| `select_vault` | `vault.rs:469` | `vault.ts:109` → `App.tsx chooseVault` (310) |
| `vault_backup_status` | `vault.rs:1752` | `vault.ts:118` → `App.tsx:252` |
| `vault_run_backup` | `vault.rs:1789` | `vault.ts:124` → `App.tsx:169/224/270` |
| `vault_delete_backups` | `vault.rs:2007` | `vault.ts:140` → `App.tsx:302` |
| `vault_restore_snapshot` | `vault.rs:1898` | `vault.ts:152` → `App.tsx:406` |
| `get_device_id` | `commands.rs:759` | `vault.ts:168` → `App.tsx:133` |
| `list_events` | `commands.rs:771` | `vault.ts:163` → `App.tsx refresh` (129) |
| `search_foods_remote` | `barcode.rs:422` | `vault.ts:221` → `FoodLog.tsx` |
| `append_event` | `commands.rs:778` | `vault.ts:176` → todas las vistas |
| `vault_fingerprint` | `commands.rs:764` | `vault.ts:160` → `App.tsx refresh` (133) |
| `get_app_info` | `commands.rs:743` | `vault.ts:194` → `App.tsx:125` |
| `lookup_barcode` | `barcode.rs:211` | `vault.ts:205` → `FoodLog.tsx` |
| `open_external` | `commands.rs:695` | `links.ts:17` (HTTPS: repo oficial + vídeos permitidos) |
| `fetch_update_manifest` | `commands.rs:165` | `updater.ts:282` |
| `download_and_install_linux_package` | `commands.rs:421` | `updater.ts:241` |
| `download_android_apk` | `commands.rs:547` | `updater.ts:259` |
| `open_update_file` | `commands.rs:497` | `UpdatePanel.tsx:128` |

APIs de Tauri **sin `invoke`**: `getCurrentWindow()` (`WindowChrome.tsx`), `getVersion()`
(`updater.ts:185`), `listen()` para `update-progress` (`updater.ts:75`), y los plugins
`updater`/`process` importados dinámicamente en `updater.ts:190-230`.

### 1.7 Flujo típico: registrar un evento

1. La vista construye `newEvent(deviceId, kind, payload)` (`vault.ts:289`) y llama a
   `appendEvent` (`173`), que usa `invoke` en Tauri o `bt.mock.events` en navegador.
2. `appendEvent` despacha `better-tracker:event-appended` (`vault.ts:171`); `App.tsx:148`
   hace append optimista y evita releer durante 1,2 s (`lastLocalAppendRef`).
3. Rust valida el `device_id`, escribe `<vault>/omega/devices/<id>/events/<event-id>.json`
   de forma atómica bajo `WRITE_LOCK` y refleja el evento en la copia de hoy (best-effort).
4. Los reductores (`metrics.ts`, `wellness.ts`, `foodDb.ts`, `nutrition.ts`) reconstruyen el
   estado derivado en cada render; las vistas lo memoizan con `useMemo`.

### 1.8 Flujo típico: comprobar e instalar una actualización

`UpdatePanel` → `checkForUpdate` (`updater.ts:161`) → `fetch_update_manifest` (Rust) →
`latest.json` de GitHub → comparación `isNewerVersion` (`419`). Según plataforma:
plugin nativo (AppImage/Windows), `download_and_install_linux_package` (`.deb`/`.rpm` con
SHA-256 + minisign) o `download_android_apk` (SHA-256 y publicación en Descargas).
El progreso llega como evento `update-progress`; la ruta del instalador queda guardada en
`UpdateState` y solo esa ruta puede abrirse (`validate_update_file_path`, `commands.rs:506`).

---

## 2. Índice maestro de archivos

### 2.1 Frontend — `src/`

| Archivo | Líneas | Responsabilidad en una frase |
| :--- | ---: | :--- |
| `main.tsx` | 24 | Arranque React y providers. |
| `App.tsx` | 1258 | Shell, 5 vistas (Panel/Training/Body/Wellness/History), bóveda, backups, Ajustes con pestañas y toasts. |
| `theme.tsx` | 140 | Modo/acento y `applyTheme()`. |
| `i18n.tsx` | 97 | Diccionarios ES/EN y helpers de formato. |
| `types.ts` | 281 | Todos los tipos del dominio. |
| `vault.ts` | 372 | Frontera TS↔Rust de la bóveda; mocks en navegador. |
| `metrics.ts` | 2323 | Reductores, energía, composición, nutrición, series. |
| `bodyRange.ts` | 1376 | Rangos seguros y proyección corporal (Monte Carlo). |
| `foodDb.ts` | 937 | 521 alimentos, unidades, búsqueda y GTIN. |
| `recipes.ts` | 1299 | 50 recetas sin gluten/frutos secos, rotación por semilla y alérgenos. |
| `nutrition.ts` | 345 | Digest semanal de nutrición. |
| `wellness.ts` | 403 | Hábitos, ánimo, rachas y resúmenes. |
| `meals.ts` | 85 | Borrador diario en `localStorage`. |
| `zones.ts` | 249 | 10 zonas corporales y clasificación de ejercicios. |
| `dates.ts` | 9 | `dayNames(lang)` compartido por Panel/Training/Wellness. |
| `energy.ts` | 74 | `bmrMifflin`, `bmrDynamic`, `bmrAgeAdjusted` (Schofield/Porter), `bmrEquationLabel` y `walkingKcalPerDay`. |
| `barcodeCatalog.ts` | 107 | Catálogo offline de 11.232 códigos. |
| `projectionInputs.ts` | 255 | Hook de frecuencia/pasos/ingesta para la proyección. |
| `updater.ts` | 432 | Actualizaciones híbridas por plataforma. |
| `links.ts` | 42 | URLs oficiales, apertura segura y validación de vídeos. |
| `inputGuard.ts` | 59 | Solo pegado de texto plano; anti-drop/contexto. |
| `errors.ts` | 37 | Normalización de errores de Tauri. |
| `PanelView.tsx` | 924 | Alimentación: Ingesta, Agua y Recetas. |
| `TrainingView.tsx` | 1791 | Biblioteca (con descripciones/vídeos), rutinas, plan, sesión, calendario y progreso. |
| `HistoryView.tsx` | 737 | Historial de entrenamiento y nutrición. |
| `BodyView.tsx` | 824 | Medidas, composición y proyección. |
| `WellnessView.tsx` | 715 | Hábitos con clasificación, ánimo, recordatorios y semana. |
| `BodyFigure.tsx` | 136 | Silueta SVG **solo ilustrativa**: adapta su forma al sexo y a las circunferencias del formulario; no tiene nodos ni interacción (no bloquea el desplazamiento táctil). |
| `components/Select.tsx` | 170 | Select accesible usado por toda la app. |
| `components/Fields.tsx` | 104 | `NumberInput`, `Field`, `EmptyState`, `Stat`. |
| `components/Icons.tsx` | 188 | Iconos SVG y `LogoMark`. |
| `components/Charts.tsx` | 456 | `LineChart`, `BarChart`, heatmaps, sparkline, `WeekBars`. |
| `components/FoodLog.tsx` | 864 | Diario de comidas; búsqueda unificada local + códigos + palabras clave. Conserva el scroll cuando llegan resultados remotos (`applyRemoteResults` 191, `useLayoutEffect` 199). |
| `components/FatTrend.tsx` | 164 | Evolución de grasa/cintura. |
| `components/RestTimer.tsx` | 202 | Temporizador de descanso. |
| `components/UpdatePanel.tsx` | 288 | UI de actualizaciones. |
| `components/WindowChrome.tsx` | 277 | Controles/tiradores de ventana (desktop). |
| `components/ProjectionInputs.tsx` | 188 | Campos manuales de la proyección. |
| `components/ProjectionCurve.tsx` | 177 | Curva SVG con `ResizeObserver`. |
| `components/ProjectionWeights.tsx` | 132 | Tabla semana a semana de la proyección. |
| `views/custom-select.ts` | 265 | Implementación de referencia **no enlazada** + `migrateSelect`. |
| `styles.css` | 4526 | Tokens, temas, componentes y media queries; sin box-shadow. |
| `data/barcodeCatalog.json` | 1 (614 KB) | 11.232 tuplas `[código, nombre, categoría, país]`. |
| `data/barcodeCatalogMeta.json` | 139 | Metadatos, recuentos y 16 plantillas de macros. |
| `data/foodNames.en.ts` | 502 | Nombres de alimentos en inglés. |
| `*.test.ts` (10 archivos) | — | Tests unitarios de dominio (§9). |

### 2.2 Backend — `src-tauri/`

| Archivo | Líneas | Responsabilidad |
| :--- | ---: | :--- |
| `src/lib.rs` | 126 | Builder, plugins, 19 comandos, instancia única, watchdog. |
| `src/main.rs` | 229 | `--version`, ajustes de WebKitGTK en Linux y `run()`. |
| `src/commands.rs` | 933 | 14 comandos: info, splash, enlaces, eventos y actualizaciones. |
| `src/vault.rs` | 3449 | 7 comandos: configuración, bóveda, índice de eventos, fingerprint y copias `longlife`. |
| `src/barcode.rs` | 977 | `lookup_barcode` y `search_foods_remote` contra Open Food Facts. En **Windows** manda Search-a-licious con `nutriments` en la misma respuesta (una petición por búsqueda), `OFF_SEARCH_ENDPOINTS` queda en 2 hosts legacy de respaldo, con presupuesto de 8 búsquedas/minuto, backoff 30–600 s y timeout por petición; en Linux/Android se conservan los 3 endpoints originales sin cambios. |
| `src/manifest.rs` | 68 | Parser estricto del `release-manifest.json` (opt-in, no usado en runtime). |
| `src/version.rs` | 154 | Versión embebida, `AppInfo`, `compare_versions`, formato de instalación. |
| `build.rs` | ~70 | Inyecta `VERSION`, commit, fecha y `VAULT_SCHEMA_VERSION`. |
| `Cargo.toml` | ~70 | Crate `better-tracker`, features `updater`/`microsoft-store`. |
| `tauri.conf.json` | 69 | Config base: ventanas, CSP, bundle (`publisher: wulflo`), updater. |
| `tauri.linux.conf.json` | 5 | Targets `deb`, `rpm`, `appimage`. |
| `tauri.windows.conf.json` | 11 | Targets `nsis`, `msi`; `installMode: currentUser`. |
| `tauri.store.conf.json` | 17 | Sin updater; solo capability `main`. |
| `capabilities/main.json` | 16 | Permisos core + control de ventana. |
| `capabilities/mobile.json` | 7 | Solo `core:default` en Android. |
| `capabilities/updater.json` | 10 | `updater:default` + `process:default` en escritorio. |
| `deny.toml` | — | Política de licencias/vulnerabilidades de cargo-deny. |

### 2.3 Infraestructura

| Ámbito | Archivos |
| :--- | :--- |
| CI/CD | `.github/workflows/ci.yml`, `release.yml`, `package-linux.yml`, `store-msix.yml`, `.github/dependabot.yml` |
| Versionado | `VERSION`, `VAULT_SCHEMA_VERSION`, `scripts/sync-version.mjs`, `scripts/normalize-version.mjs` |
| Manifiestos | `scripts/generate-updater-manifest.mjs`, `generate-release-manifest.mjs`, `validate-manifest.mjs`, `check-sha256sums.mjs`, `schemas/release-manifest.schema.json` |
| Empaquetado | `scripts/package-linux.sh`, `snapcraft.yaml`, `snap/gui/`, `packaging/flatpak/`, `packaging/windows-store/`, `scripts/prepare-store-msix.mjs`, `prepare-store-icons.mjs` |
| Firma | `scripts/verify-signing.sh`, `sign-local.sh`, `docs/KEYSTORES.md` |
| Iconos | `scripts/generate-icons.mjs`, `src-tauri/icons/app-icon.png` |
| Datos | `scripts/generate-barcode-catalog.mjs` |
| Pruebas visuales | `playwright.config.ts`, `tests/visual/smoke.spec.ts` |
| Asistentes de código | `.agents/skills/` (13 skills, incl. `actualizador-seguro` y `vault-performance-guard`) y `.agents/commands/estructure-sync.md`. Antes se llamaban `.opencode/`. |

---

## 3. Modelo de datos y persistencia

### 3.1 Tipos del dominio (`src/types.ts`)

| Grupo | Tipos (L) | Campos / unidades clave |
| :--- | :--- | :--- |
| Persona y objetivo | `Sex` 1, `GoalMode` 2, `ActivityLevel` 3, `Goal` 166 | `cut\|maintain\|bulk`; `auto\|sedentary\|light\|moderate\|high\|very_high`. `Goal` está declarado pero **no se usa**; la UI usa el evento `goal.mode`. |
| Alimentos | `FoodCategory` 11, `MealSlot` 29, `FoodPer100` 31, `Food` 39, `BarcodeProduct` 57, `FoodLogItem` 62 | Macros por 100 g; `units` = gramos por unidad; `water` en ml; `FoodLogItem` guarda macros ya calculados. |
| Entrenamiento | `Exercise` 78 (con `description`/`videoUrl` opcionales), `SetEntry` 90, `WorkoutEntry` 96, `Workout` 101, `Session` 108, `Routine` 125, `Plan` 131, `Mesocycle` 139, `PR` 237 | `weight` en kg; `duration` en **segundos**; `Plan.days` 0=domingo; 1RM en `estimate1RM`. |
| Cuerpo | `BodyMeasures` 209, `MeasurementEntry` 229, `WeightEntry` 151 | Todas las circunferencias en **cm**, peso en **kg**, altura en **cm**; `EMPTY_MEASURES` 257. |
| Nutrición | `NutritionEntry` 156, `Reminder` 143 | `kcal`, macros en g, `water` en ml. |
| Bienestar | `HabitFrequency` 174, `Habit` 176, `HabitLog` 192, `MoodScore` 199, `MoodEntry` 201 | Clave lógica de log `${habitId}:${date}`; resumen máx. 5 palabras. |
| Plataforma | `AppInfo` 241, `VaultEvent` 249 | `AppInfo` = versión, commit, build_date, `vault_schema_version`, `install_format`. |

Los tipos derivados viven en sus módulos: `TrainingSummary`/`MacroResult`/`EnergyBreakdown`
(`metrics.ts`), `BodyProjection`/`ProjectionTrajectoryPoint` (`bodyRange.ts`), `NutritionDigest`
(`nutrition.ts`), `WellnessDigest` (`wellness.ts`), `Recipe` (`recipes.ts`).

### 3.2 Claves de `localStorage`

| Clave | Definida en | Contenido |
| :--- | :--- | :--- |
| `bt.theme` | `theme.tsx:35` (y `public/theme-init.js`) | `'dark'` o `'light'` (defecto `dark`). |
| `bt.accent` | `theme.tsx:36` (y `theme-init.js`) | Uno de los 9 acentos (defecto `violet`). |
| `bt.lang` | `i18n.tsx:5` | `'es'` o `'en'` (**defecto `en`** al instalar). |
| `bt.meal.draft.v1` | `meals.ts:3` | `{date, items: FoodLogItem[]}`; se descarta si no es hoy. |
| `bt.event-count:<vault>` | `App.tsx:148` | Último nº de eventos visto; avisa si la bóveda retrocede. |
| `bt.font.scale` | `theme.tsx:37` | Escala de texto 1/1,1/1,2/1,3/1,5. |
| `bt.settings.tab` | `App.tsx:83` | Última pestaña de Ajustes abierta. |
| `bt.mock.vault` / `bt.mock.device` / `bt.mock.events` | `vault.ts:9-11` | Bóveda simulada en navegador; `clearMockData()` (366) las borra. |

`better-tracker:event-appended` (`vault.ts:171`) es un `CustomEvent` de `window`, no storage.

### 3.3 La bóveda (Rust, `src-tauri/src/vault.rs`)

| Ruta | Contenido |
| :--- | :--- |
| `<app_data_dir>/config.json` | `Config` (101-111): `vault_path`, `vault_label`, `device_id` (UUID v4), `backup_skip_date`. Permisos 0700/0600 en Unix. |
| `<app_data_dir>/events-index.json` | Índice derivado con magic `BTI1`, versión 1 y ruta de bóveda; guarda id/mtime/tamaño/eventos por archivo. Se descarta y reconstruye si está corrupto, es de otra bóveda o supera 128 MiB (`vault.rs:64-70,852-899`). |
| `<app_data_dir>/events-index.delta.jsonl` | Journal append-only de lo nuevo; se compacta cada 256 registros y se vacía al guardar el índice (`vault.rs:797-840,1102-1107`). |
| `<vault>/omega/devices/<device>/events/<id>.json` | **Un archivo por evento**: `{id, device_id, timestamp, kind, payload}` (struct 50-57). Escritura atómica vía temporal + `rename`. |
| `omega/devices/<device>/events.jsonl` | Formato heredado NDJSON; se sigue leyendo (631-650). |
| `omega/devices/restored-<...>/events.jsonl` | Eventos importados de una copia; nunca sobrescriben los actuales. |
| `<vault>/longlife/<device>/<YYYY-MM-DD>/` | Copia diaria con `snapshot.json` (manifiesto) y `.backup-complete`. En escritorio conserva además el árbol `omega`; **en Android no**: un solo NDJSON por copia evita 3-4 llamadas SAF por evento. |
| `<vault>/longlife/<device>/<YYYY-MM-DD>/snapshot-events.jsonl` | En Android es **el contenido de la copia** y lo que se restaura (una lectura SAF); en escritorio es un índice derivado del árbol `omega`. |
| `<vault>/Longlife/` | Nombre heredado; se migra a `longlife` al listar (1041-1053). |

Límites y constantes (`vault.rs:30-70`): profundidad local 16 / SAF 64, 8 MiB por archivo de
evento, retención de copias 7 días y cuatro mutex: `WRITE_LOCK` (eventos), `BACKUP_LOCK`
(copias/restauración, no bloquea appends), `CONFIG_LOCK` (config.json) e `INDEX_LOCK`
(índice y deltas).

`read_events` (`vault.rs:1118`) delega en `indexed_events` (1035): solo comprueba
metadatos (relative + mtime + tamaño) y lee los archivos nuevos o cambiados; en SAF
esto elimina una IPC por evento ya indexado. `vault_fingerprint` (999) calcula una
huella barata con esos mismos metadatos para que `App.tsx` salte `listEvents()`
cuando nada cambió.

**Migraciones de layout** (no hay campo `schema_version` en los eventos): `devices/` →
`omega/devices/`, `Longlife` → `longlife`, `events.jsonl` → un `.json` por evento y dos
formatos de `FsUri` de Android SAF (`parse_saf_root`, auxiliar puro probado en
escritorio; `saf_uri_from_root` solo lo adapta al plugin). En Android se valida además
el permiso persistido y una raíz que no sea SAF da error explícito en vez de caer en
`std::fs`. `config.json` se escribe con temporal + `rename`. El número de esquema
se inyecta en compilación desde `VAULT_SCHEMA_VERSION` (= 1) y se expone en `AppInfo`.

### 3.4 Copias `longlife` y restauración

- `vault_backup_status` (1758) lista copias; `vault_run_backup` (1799) crea la de hoy
  (o la rehace si está dañada/obsoleta); `vault_restore_snapshot` (~1905) importa solo los
  ids ausentes; `vault_delete_backups` (2007) borra y fija `backup_skip_date`.
- `count_dir` (1397) excluye `snapshot.json`, `.backup-complete` **y**
  `snapshot-events.jsonl`: si el índice se contara como dato, una copia recién creada
  aparecía como «Dañada» (`2` archivos frente a `1` del manifiesto).
  `manifest_matches_meta()` compara esos recuentos; `local_backup_is_stale()` solo
  considera obsoleta la copia si `omega` **ganó** datos.
- En Android la lógica equivalente usa `FsUri` y MediaStore (`run_saf_backup`, 2669).
  **El formato de `omega` no cambia**: sigue siendo un `.json` por evento, así que
  la sincronización con un servidor externo (o cualquier herramienta de archivos)
  funciona igual. Solo cambia el interior de `longlife`: en vez de copiar cada
  archivo de evento se escribe un único `snapshot-events.jsonl`, y el manifiesto
  declara su número de eventos y su tamaño. Las copias antiguas con árbol `omega`
  se siguen leyendo y restaurando.
  Todos los archivos de la copia (índice, `snapshot.json` y `.backup-complete`) se
  escriben con `saf_write_new_file` (2062): compara el nombre real devuelto por el
  proveedor y borra duplicados, porque un marcador renombrado hacía que la copia
  apareciera «Incompleta» aunque el contenido estuviera bien. El
  marcador usa MIME concreto `application/octet-stream`: con `text/plain` SAF añade
  `.txt` (flutter_file_picker#1843) y `*/*` está desaconsejado en `createDocument`.
  Los avisos de 30 s de
  `createBackup`/`restoreCopy` hacen un `getAppInfo()` barato como workaround del
  bloqueo de IPC Android de Tauri #14994 (cerrado en tao#1271).
  `saf_snapshot_info` (2499) hace **un solo `read_dir` por copia**, lee el manifiesto y
  el índice (una lectura cada uno) y usa los recuentos del manifiesto en vez de recorrer
  el árbol por IPC; solo las copias antiguas sin manifiesto caen al recorrido recursivo.
  `ndjson_count` (1538) verifica que el índice tenga un evento por archivo declarado.
  La restauración lee el índice centralizado en una sola llamada y escribe un único
  `events.jsonl`; un archivo ilegible no aborta el resto. `backup_status` se consulta
  fuera de `WRITE_LOCK` para no bloquear los append.
- `App.tsx:163` programa un backup automático a los 2,5 s del arranque y cada 6 h.
  `createBackup` (350) y `restoreCopy` (431) tienen watchdog de 30 s (aviso) y
  180 s (libera el botón con error): en SAF una copia puede tardar minutos y antes
  el botón se quedaba en «Working…» o la restauración en curso para siempre.
- Verificación específica: skill `.agents/skills/boveda-android-saf/SKILL.md`.

---

## 4. Núcleo de dominio

### 4.1 `src/metrics.ts` (2301 líneas) — el motor

| Área | Símbolos (L) |
| :--- | :--- |
| Fechas y formato | `DAY_MS` 25, `todayISO` 27, `parseISO` 34, `addDays` 39, `daysBetween` 45, `startOfWeek` 77, `weekKey` 84, `formatProjectionDate` 63 |
| Reductores | `visibleTrainingEvents` 329, `reduceExercises` 338, `reduceWorkouts` 352, `reduceSessions` 358, `reducePRs` 364, `reduceWeights` 370, `reduceMeasurements` 377, `reduceNutrition` 388, `reduceRoutines` 414, `reducePlans` 430, `reduceMesocycles` 440, `reduceReminders` 450 |
| Preferencias por evento | `goalModeFromEvents` 102, `activityLevelFromEvents` 205, `trainingFrequencyFromEvents` 261, `averageStepsFromEvents` 243, `averageIntakeFromEvents` 273 |
| Entrenamiento | `trainingSummary` 526, `estimateTraining` 669, `trainingAlerts` 733, `estimate1RM` 2160, `weeklySeries` 2177, `exerciseSeries` 2244 |
| Energía | `bmrMifflin` 861, `activityBaseFactor` 901, `trainingEatKcalPerDay` 931, `computeEnergyExpenditure` 948, `computeMacros` 974 |
| Agua y saciedad | `computeWaterGuidance` 1096, `computeSatiety` 1275 |
| Composición | `bodyComposition` 1759, `bodyProgressSeries` 2137 |

**Energía (0.10.1 corrigió el doble conteo de pasos):**
`TEF = 0.10·ingesta`; `NEAT = max((PAL−1)·BMR, (pasos/1000)·0.45·peso)` — los pasos
son un **suelo**, no se suman al PAL; `EAT = (sesiones/semana ÷ 7)·(min/60)·peso·MET`
con `MET = 4.5·fracciónFuerza + 6.5·(1−fracciónFuerza)`; `TDEE = BMR + TEF + NEAT + EAT`
(`computeEnergyExpenditure`, 948-968). `computeMacros` (974) aplica 0.85/1.0/1.1 según
objetivo, proteína 2,0/1,8 g/kg, grasa `max(0.6·kg, kcal·0.24/9)` y el resto en carbs.

**Composición corporal:** 13 ecuaciones candidatas (Navy 1595, RFM 1608, Deurenberg 1615,
Cun Bae 1621, Army 1638/1645/1669, Marine 1679/1686, Friedl 1702, Afu 1719/1729,
Boer 1740). `bodyComposition` (1759) agrupa por familias, pondera por `1/SEE²`, aplica
mediana por familia, factor Huber y produce `avg`/`min`/`max`, `fatMass`, `leanMass`,
`coverage`, `confidence` (15–95), FFMI, clasificación USARIEM y WHtR.

### 4.2 `src/bodyRange.ts` (1376 líneas) — proyección

- `safeBmiRange` 166 (OMS 18.5–24.9), `safeBodyFatRange` 207 (por sexo/edad),
  `classifyValue` 257, `targetBodyFat` 294, `strengthFactor` 140 (12 sesiones/mes = 1).
- `projectBody` 805: objetivo desde **composición** (masa magra + grasa objetivo) con
  respaldo por IMC; transitorio de agua/glucógeno `clamp((ingesta−TDEE)·0.010, ±1.8 kg)`;
  avisos (ingesta < BMR, déficit ≤ −30 %, superávit ≥ 20 %, ritmo); 4 hitos con
  percentiles 5/95; máximo 1095 días y trayectoria plana de 84 días en mantenimiento.
- `integrateOnce` 497-687: simulación día a día con dos compartimentos
  (`RHO_FAT_KCAL_KG=9400`, `RHO_LEAN_KCAL_KG=1800`), Forbes para la partición,
  termogénesis adaptativa (`AT ← AT + (0.11·AT·ΔE − AT)/18`) y tope de ritmo semanal.
- Monte Carlo (457-495, 716-762): `mulberry32` + Box-Muller, **81 escenarios**, banda
  = percentiles 5/95 por día (intervalo del 90 %).

### 4.3 Nutrición, bienestar, recetas y zonas

| Módulo | Símbolos y reglas |
| :--- | :--- |
| `nutrition.ts` (345) | `dailyNutrition` 66, `weeklyNutritionStats` 143 (solo días registrados), `nutritionDigest` 163 (avisos de proteína/fibra/agua/adherencia), `nutritionStreak` 328. |
| `wellness.ts` (403) | `reduceHabits` 54, `reduceHabitLogs` 90, `reduceMoods` 106, `isHabitDue` 138, `wellnessDigest` 182, `habitStreaks` 263 (366 días), `autoSummary` 304 (≤5 palabras), `defaultHabits` 341. |
| `recipes.ts` (1299) | `RECIPES` 97 (50 recetas bilingües), `recipeMacros` 374, `recommendRecipes` 414 (score por objetivo y macros restantes), `recipeLogItems` 464. |
| `zones.ts` (249) | `ZONES` 27 (10 zonas con `weeklySets`, `weeklyMinutes`, `recoveryHours`), `zoneForExercise` 240 (zone guardada → tipo → `KEYWORDS`), `zoneColor` 251. |

### 4.4 Alimentos y códigos de barras

- `foodDb.ts` (922): `FOODS` 700 (521 alimentos), `foodUnits` 708, `calcFood` 725,
  `resizeFoodLogItem` 756, `mealTotals` 842, `searchFoods` 868 (NFD sin diacríticos;
  todos los tokens deben coincidir), `reduceCustomFoods` 892.
- `validBarcodeChecksum` 803 (mod 10 GS1), `barcodeVariants` 813 (original, sin ceros,
  pad 12/13/14), `findFoodByBarcode` 830.
- Prioridad de búsqueda: **bóveda** (`food.saved`) → **catálogo local** (`barcodeCatalog.ts:73`,
  11.232 códigos AR/PE/MX con macros estimados) → **Open Food Facts** (`vault.ts:202` → Rust).
- `recipes.ts`, `barcodeCatalog.ts` y `foodDb.ts` usan `src/data/foodNames.en.ts` para
  nombres bilingües (`localizedFoodName`, 70).

---

## 5. Frontend React

### 5.1 `App.tsx` — shell y estado global

- `View` 35 (`panel|training|history|body|wellness`), `NAV` 38 (panel, training, body, wellness, history), estado `view` 69.
- Ajustes: `SettingsTab` 37, `SETTINGS_TABS` 40, estado `settingsTab` 81 (persistido en
  `localStorage["bt.settings.tab"]`), navegación por teclado `onSettingsTabKeyDown` 102,
  barra de pestañas 668-705 y paneles 706-1046 (`appearance|vault|backups|updates|about`).
- Callbacks: `notify` 105 (toast), `refresh` 129, `chooseVault` 310, `createBackup` 350,
  `removeBackups` 410, `restoreCopy` 434, `seedSample` 553 (solo navegador).
- Efectos: carga/refresh 177-249, backups 193/227/241-242, `unhandledrejection` → toast 300-305.
- `PanelView` recibe `onNavigate` para «Ver todo» (1230/1307). Ajustes en 649-1057:
  apariencia/idioma, bóveda, copias `longlife`, `UpdatePanel` (1003) y «Acerca de».

### 5.2 Vistas

| Vista | Archivo | Pestañas / estado propio |
| :--- | :--- | :--- |
| Alimentación | `PanelView.tsx` (924) | `PANEL_TABS` (`ingesta|agua|recetas`; se retiraron Resumen, Cuerpo y Recordatorios); `useProjectionInputs` 130; deriva `macros`, `comp`, `projection` 154-160. |
| Entrenamiento | `TrainingView.tsx` (1791) | `TABS` 63 (`library|routines|plan|session|calendar|progress`); `LibraryTab` 155 (alta/edición con descripción y vídeo), `RoutinesTab` 537, `ExercisePicker` 847, `PlanTab` 903, `SessionTab` 1113, `ProgressTab` 1516. |
| Historial | `HistoryView.tsx` (722) | `tab` (`training|nutrition`), `filter`, `visibleCount` 56 (ventana con «Mostrar más»). |
| Figura corporal | `BodyView.tsx` (824) | `BODY_TABS` (`datos|composicion|proyeccion`), registro rápido de peso, Medidas arriba y glosarios. | `form` 44; `BodyFigure`, `FatTrend` 216, `ProjectionInputs/Curve/Weights`. |
| Hábitos | `WellnessView.tsx` (715) | `kind` (good/strong/addictive/bad), puntos con signo, rachas y recordatorios migrados; `form`, `mood`, `summary`; usa `wellness.ts` y `defaultHabits`. |

### 5.3 Componentes compartidos

| Componente | Archivo : L | Notas |
| :--- | :--- | :--- |
| `Select` | `components/Select.tsx:23` | Único selector en uso; teclado, `searchable`, `hint`. |
| `NumberInput`, `Field`, `EmptyState`, `Stat` | `components/Fields.tsx:3/49/67/88` | Primitivas de formulario. |
| `Icon`, `LogoMark` | `components/Icons.tsx:151/177` | SVG por nombre. |
| `LineChart`, `BarChart`, `ProgressBar`, `BodyHeatmap`, `CalendarHeatmap`, `MiniSparkline`, `WeekBars` | `components/Charts.tsx:28/101/140/178/301/427/442` | Todos en SVG; leen tokens de tema. |
| `FoodLog` | `components/FoodLog.tsx:46` | ~20 estados: búsqueda, unidades, edición, barras; `applyRemoteResults` (191) + `useLayoutEffect` (199) evitan el salto de scroll en Android al llegar OFF. |
| `FatTrend` | `components/FatTrend.tsx:25` | Usa `bodyProgressSeries`. |
| `RestTimer` | `components/RestTimer.tsx:65` | `primeTimerAlarm` 23, beep/vibración. |
| `UpdatePanel` | `components/UpdatePanel.tsx:30` | `onCheck` 57, `onInstall` 78, `onOpenSaved` 125. |
| `WindowControls`, `WindowResizeHandles` | `components/WindowChrome.tsx:194/274` | Solo desktop. |
| `ProjectionCurve` | `components/ProjectionCurve.tsx:33` | `ResizeObserver` para ancho. |

---

## 6. Interfaz: i18n, tema y CSS

### 6.1 `src/i18n.tsx` (97)

- `Lang = 'es' | 'en'` (3), `STORAGE_KEY = 'bt.lang'` (5), **inglés por defecto** (78-86).
- `DICT` (7-38): ~13 claves por idioma (`app.subtitle`, `nav.*`, `nav.mobile.*`, `settings`, `language`).
- `t(key, lang)` 40 (cae al español si falta), `tx(lang, es, en)` 48 (traducción en línea,
  mecanismo dominante en los componentes), `locale` 53, `plural` 58, `formatNumber` 63.
- `LanguageProvider` 77 / `useLanguage` 95; actualiza `document.documentElement.lang`.

### 6.2 `src/theme.tsx` (140)

- `ThemeMode = 'dark'|'light'` (3), `Accent` (4) con 9 valores, `ACCENTS` 23.
- `MODE_KEY = 'bt.theme'` 35, `ACCENT_KEY = 'bt.accent'` 36; `applyTheme` 56 escribe
  `data-theme`/`data-accent` y actualiza `<meta name="theme-color">` desde `--bg`.
- `FONT_KEY = bt.font.scale` (37), `FONT_SCALES` (40) y `applyFontScale` (51-54) escriben `--font-scale`; selector en `App.tsx:916-921`.
- Se aplica al importar el módulo (71-73) y en `ThemeProvider` (89); `useTheme` 106.

### 6.3 `src/styles.css` (4526)

- `:root` 1-52: tokens `--bg`, `--surface*` (1-4), `--primary*` (incl. `-rgb`, `-deep`),
  `--on-surface*`, `--outline*`, `--error/success/warning/info`, radios `--radius-*` y
  `--box-border`/`--box-border-strong` (derivados de `--primary-rgb`). **No hay
  `box-shadow`**: la UI es plana, el foco usa `outline` y las cajas usan `--box-border`.
- `:root[data-accent='…']` 54-327 y `:root[data-theme='light'][data-accent='…']` 377-492:
  9 acentos × 2 modos. El bloque final «Base neutra + acento puntual» sobrescribe
  fondos, superficies y bordes con escalas casi neutras: la jerarquía es por
  luminosidad y el hue del acento queda para acciones, activo, foco y bordes sutiles.
- `:root[data-theme='light']` 336-373: paleta clara (también redefine `--box-border`).
  Bloque final «Base neutra + acento puntual» 4424-4526; ver skill `estilo-ui`.
- El saludo de la cabecera (`.topbar .row > .hint`) se muestra también en móvil con
  elipsis; el badge «Solo local» queda como punto de estado por debajo de 560 px.
- `.app-shell` usa 220 px de sidebar (intermedio entre 258 y 180) y `.topbar` ~48 px
  de alto, con fondo `--bg` para integrarse con el contenido (no una franja aparte).
  `.nav-item` es un botón con fondo propio y borde; el activo usa `--nav-active-bg`.
  Las tarjetas usan `--card-*-rgb` aclarados por acento claro, sin franjas superiores.
  En claro, `--on-chrome-muted` da ≥5,5:1 en sidebar y ≥9:1 en topbar; en oscuro ≥8:1.
  `.food-result-add` es un cuadrado de 32 px con `padding: 0`; `--side-hue-rgb` (9 acentos)
  matiza los chips de iconos y `--wash-side` el degradado lateral.
- Convenciones: `.app-shell`, `.sidebar`, `.topbar`, `.content`, `.page`, `.card`, `.grid`,
  `.metric`, `.badge`, `.notice`, `.segmented`, `.tabs`, `.modal-backdrop`, `.toast`, `.chip`.
- Ajustes con pestañas: `.settings-body`, `.settings-tabs`, `.settings-tab`,
  `.settings-panels`, `.settings-tab-panel[hidden]` (junto a `.modal-body`, ≈ 2148).
- Responsive: media queries desde 2457; `.bottom-nav` visible en móvil (3585).

---

## 7. Servicios compartidos

| Servicio | Archivo | Rol |
| :--- | :--- | :--- |
| Bóveda TS | `vault.ts` | `isTauri` 13, `VaultInfo` 40, `getVaultInfo` 92, `selectVault` 100, backups 118-153, `getDeviceId` 152, `vaultFingerprint` 158, `listEvents` 163, `appendEvent` 176, `getAppInfo` 187, `lookupBarcode` 205, `searchFoodsRemote` 221, `newEvent` 356, `clearMockData` 366. |
| Actualizaciones | `updater.ts` | `UPDATE_MANIFEST_URL` 22, `watchUpdateProgress` 75, `checkForUpdate` 161, `installUpdate` 207, `isNewerVersion` 419; oculta el panel en Snap/Flatpak/Store. |
| Enlaces | `links.ts` (42) | `REPOSITORY_URL` 4, `openExternal` 12, `isExerciseVideoUrl` 35 (HTTPS; usa `open_external` en Tauri). |
| Guardia de entrada | `inputGuard.ts` | `installInputGuard` 17: solo texto plano al pegar, bloqueo de drop/contexto. |
| Errores | `errors.ts` | `errorText` 6 normaliza errores opacos de Tauri. |
| Entradas de proyección | `projectionInputs.ts` | `useProjectionInputs` persiste `training.frequency`, `steps.average`, `intake.average` e `intake.auto` (≥5 días → media). |

---

## 8. Backend Rust / Tauri

### 8.1 `lib.rs` — arranque

- `run()` 11: Builder → single-instance (21-24) → `dialog`/`opener`/`UpdateState` (26-29)
  → updater/process solo con feature `updater` (37-42) → `android-fs` (44-47) → watchdog (49-65)
  → `generate_handler!` (66-89) → `generate_context!()` (90).
- `single_instance_plugin` 95-129: en Snap usa `dbus_id("snap.better-tracker.better-tracker")`;
  al abrir una segunda instancia enfoca la ventana existente.
- `main.rs`: `--version`/`-V` (7-11) y `configure_webkit_rendering` (33-65), que desactiva
  DMA-BUF en NVIDIA/VM/render por software para evitar crashes en WebKitGTK.

### 8.2 Los 19 comandos registrados

| Comando | Definición | Dominio |
| :--- | :--- | :--- |
| `get_app_info` | `commands.rs:743` | Único comando de versión (`AppInfo`); se eliminaron 4 alias. |
| `frontend_ready` | `commands.rs:748` | Splash → main. |
| `open_external` | `commands.rs:695` | Repositorio + vídeos de ejercicios (whitelist). |
| `lookup_barcode` / `search_foods_remote` | `barcode.rs:211/422` | Open Food Facts por código o palabras clave (Search-a-licious de 1 petición con macros + 2 hosts de respaldo en Windows; 3 en el resto). |
| `get_device_id` | `commands.rs:759` | UUID persistido. |
| `list_events` / `append_event` | `commands.rs:771/778` | Bóveda (`spawn_blocking`). |
| `fetch_update_manifest` | `commands.rs:166` | `latest.json`. |
| `download_and_install_linux_package` | `commands.rs:422` | `.deb`/`.rpm` + SHA-256 + minisign. |
| `open_update_file` | `commands.rs:498` | Solo la última ruta descargada. |
| `download_android_apk` | `commands.rs:548` | APK → Descargas. |
| `select_vault` / `get_vault_info` | `vault.rs:469/506` | Selección de bóveda (SAF/diálogo). |
| `vault_backup_status` / `vault_run_backup` / `vault_restore_snapshot` / `vault_delete_backups` | `vault.rs:1752/1789/1898/2007` | Copias `longlife`. |
| `vault_fingerprint` | `commands.rs:764` | Huella barata de la bóveda para saltar `list_events`. |

### 8.3 Seguridad y actualizaciones (`commands.rs`)

- Whitelist: `validate_release_url` 65, `validate_sha256` 75, `validate_external_url` 703
  (repositorio `github.com/wulflo/BetterTracker`, `/releases`, `/blob/main/PRIVACY_POLICY.md`
  y hosts de vídeo permitidos: YouTube/youtu.be/Vimeo, solo HTTPS y sin `..`).
- Descarga: `stream_to_file` 212-296 con límite de tamaño, hash SHA-256 progresivo y eventos
  `update-progress` cada 512 KB.
- Firma: `verify_package_signature_with_key` 106-160 con `minisign-verify` en bloques de 1 MiB;
  desde `0.9.10` (`SIGNED_LINUX_PACKAGES_FROM`, 22) se exige firma en `.deb`/`.rpm`.
- `UpdateState` 34-51 guarda la última ruta verificada; `validate_update_file_path` 506-542
  exige ruta absoluta, sin `ParentDir`, extensión de instalador y coincidencia exacta.
- Endpoints: `UPDATE_MANIFEST_URL` 15 y la pubkey de `tauri.conf.json:66` son la misma clave.

### 8.4 `barcode.rs`, `manifest.rs` y `version.rs`

- `lookup_barcode` 211: normaliza, prueba variantes UPC/EAN/GTIN (`barcode_variants` 566),
  timeout 12 s, User-Agent `BetterTracker/<versión>`. `product_for_barcode` 633 normaliza
  nombre, macros por 100 g y categoría; rechaza productos sin macros. Sin caché en Rust:
  el frontend guarda el resultado como `food.saved`. El endpoint por código (`api/v2/product`)
  sigue funcionando aunque la búsqueda por palabras clave esté saturada.
- `http_client_no_proxy` 190 (solo Windows): segundo cliente con `.no_proxy()`. El
  normal usa `auto_sys_proxy = true` (reqwest 0.12.28), así que en Windows la salida
  depende del proxy del sistema; `search_foods_remote` hace una pasada con ese
  cliente y otra directa, y se queda con la primera que responda. La feature
  `system-proxy` de reqwest está activada **explícitamente** en `Cargo.toml`:
  antes la build de Store no activaba `hyper-util/client-proxy-system` (al excluir
  el updater) y por tanto no leía el proxy del registro de Windows, mientras que
  la build normal lo heredaba del updater; era la única diferencia de red
  verificable entre ambas builds. En Linux/Android `ProxyMatcher::system()` solo
  lee variables de entorno, así que el comportamiento no cambia.
- `OFF_SEARCH_ALICIOUS` 182 / `alicious_query` 281 / `ALICIOUS_FIELDS` 301 /
  `ALICIOUS_PAGE_SIZE` 306 / `alicious_product` 312 / `clean_off_tag` 339 /
  `search_alicious` 357 (solo Windows; compiladas también en tests): buscador
  oficial `search.openfoodfacts.org/search` que sustituye al legacy `cgi/search.pl`
  y `api/v2/search` (deprecados, devuelven 503 de forma intermitente).
  `alicious_query` elimina los metacaracteres de Lucene (`¿leche?` daba 0
  resultados). `ALICIOUS_FIELDS` incluye `nutriments`, así que la respuesta trae
  las macros: **una sola petición por búsqueda**, sin `fetch_product_with_timeout`
  por código. Se piden 60 `hits` porque solo parte del índice tiene macros;
  `alicious_product` normaliza `brands`/`categories` y solo se conservan los que
  pasan `product_for_barcode`. `search_foods_remote` 422 lo prueba primero y solo
  usa los 2 endpoints legacy si falla. Linux/Android conservan la ruta original.
- `status_detail` 140 / `html_title` 159: ante una respuesta HTTP no exitosa añaden al
  mensaje la cabecera `Server` y el `<title>` de la página. Así un 503 de OFF
  (`nginx`, «Page temporarily unavailable - Open Food Facts») se distingue de un 503
  devuelto por un proxy intermedio. Afecta a `search_foods_remote` y `fetch_product`.
- `search_foods_remote` 422: `SEARCH_DEADLINE = 20 s` y `SEARCH_CACHE`
  (600 s / 24 entradas) para aciertos; el mapping es `product_for_barcode` y el frontend
  guarda el resultado como `food.saved`.
  - **Solo Windows** (`#[cfg(windows)]`): `OFF_SEARCH_ENDPOINTS` (20) queda reducido a
    **2** hosts legacy (`world` y `fr`, solo `cgi/search.pl`) como respaldo de
    Search-a-licious, sin segunda pasada: OFF documenta 10 búsquedas/min/IP y devuelve
    503 al superarlas, así que multiplicar hosts empeora el bloqueo. Además
    `take_rate_budget` 80 / `SEARCH_RATE` / `PRODUCT_RATE` aplican un presupuesto de
    8 búsquedas por minuto (`PRODUCT_RATE` de 12 solo se usa en tests), y
    `backoff_remaining` 97 / `note_rate_limited`
    108 / `clear_rate_limit` 121 implementan espera exponencial 30 s → 600 s tras un
    503/429; `rate_limited_message` 131 explica el límite y cuánto falta. El aviso se
    muestra en `FoodLog.tsx` vía `errorText`.
  - **Linux/Android/iOS** (`#[cfg(not(windows))]`): los 3 endpoints originales, dos
    pasadas con el cliente original y el error original. No se tocó la ruta que ya
    funcionaba.
- `manifest.rs`: `parse_manifest` con `deny_unknown_fields`, `select_asset` 35, `is_newer` 47.
  Es opt-in: hoy no se llama desde ningún comando.
- `version.rs`: `VERSION`/`COMMIT`/`BUILD_DATE` por `env!`, `VAULT_SCHEMA_VERSION` por
  `include!`; `app_info` 20, `compare_versions` 32 (tuplas u64), `detect_install_format` 53.

### 8.5 Features, capabilities y publisher

- `Cargo.toml`: `default = ["updater"]`, `updater = [deps…]`, `microsoft-store = []`;
  `reqwest 0.12` con `rustls-tls-webpki-roots` (evita el panic JNI de 0.13 en Android).
- `capabilities/`: `main.json` (core + ventana), `mobile.json` (solo core), `updater.json`
  (updater + process, excluida en Store). La splash no tiene permisos.
- **Autor/publicador:** `bundle.publisher = "wulflo"` y `copyright` en `tauri.conf.json`,
  `authors = ["wulflo"]` en `Cargo.toml` (Maintainer de `.deb` y Manufacturer de MSI),
  `MS_STORE_PUBLISHER_DISPLAY_NAME = 'wulflo'` en `store-msix.yml` y en
  `scripts/prepare-store-msix.mjs`. Flatpak usa `<developer>Alonso</developer>`.

---

## 9. Pruebas, benchmarks y verificación

### 9.1 Vitest (`npm test`, 9 archivos, 92 casos)

| Archivo | Casos | Cubre |
| :--- | ---: | :--- |
| `metrics.test.ts` | 30 | Reductores, energía, composición (Fuchs/Brennen/Boer, DA 2023), agua, saciedad, autoconsistencia. |
| `bodyRange.test.ts` | 20 | Rangos OMS, objetivo por composición, fuerza/pasos, ritmo, intervalo 90 %, proyecciones largas. |
| `foodDb.test.ts` | 14 | 521 alimentos, unidades, búsqueda sin acentos, GTIN/checksum, OFF. |
| `wellness.test.ts` | 7 | Resumen ≤5 palabras, altas/bajas, programación, rachas. |
| `nutrition.test.ts` | 6 | Semanas lunes-domingo, promedios, adherencia ±10 %, racha. |
| `recipes.test.ts` | 4 | Macros coherentes y ranking de recomendaciones. |
| `barcodeCatalog.test.ts` | 4 | Catálogo AR/PE/MX y variantes GTIN-14. |
| `meals.test.ts` | 2 | Caducidad y borrado del borrador diario. |
| `updater.test.ts` | 5 | Comparación semántica de versiones y mensaje MSIX. |

### 9.2 Playwright y Rust

- `tests/visual/smoke.spec.ts`: un test que carga `/` y falla si hay errores de consola;
  `playwright.config.ts` levanta `npm run dev` en el puerto 1420.
- Rust: 53 `#[test]` en `main.rs` (2), `manifest.rs` (2), `version.rs` (2), `barcode.rs` (12),
  `commands.rs` (7) y `vault.rs` (28). CI ejecuta `cargo test`, `clippy -D warnings`,
  `cargo deny check` y `cargo audit`.
- `src-tauri/examples/bench_vault.rs`: benchmark manual de serialización de 10.000 eventos.

---

## 10. Build, CI, releases y empaquetado

### 10.1 Workflows

| Workflow | Disparo | Salida |
| :--- | :--- | :--- |
| `ci.yml` | push/PR a main; `workflow_call` | Sincronización de versión, iconos, `tsc`, tests, `npm audit`, `cargo test/clippy/deny/audit`. |
| `release.yml` | tags `v*`; `workflow_dispatch` | Draft, builds Linux/Windows/Android, Snap/Flatpak, manifiestos y publicación. |
| `package-linux.yml` | `workflow_call` / manual | `.deb` → `linux-deb-root` → snap y flatpak; publicación opcional en Snap Store. |
| `store-msix.yml` | manual | MSIX sin firmar para Partner Center (sin updater). |

### 10.2 Versión y firma

- `VERSION = 0.10.7`, `VAULT_SCHEMA_VERSION = 1`; `scripts/sync-version.mjs` propaga la
  versión a `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`,
  `package-lock.json`, `snapcraft.yaml`, metainfo Flatpak y `tauri.properties` Android
  (`versionCode = major·1.000.000 + minor·1.000 + patch`).
- Firma: minisign para el updater (`TAURI_SIGNING_PRIVATE_KEY`) y para `.deb`/`.rpm`;
  keystore Android (`ANDROID_KEYSTORE_*`, alias `better-tracker`); Authenticode Windows
  opcional; credencial acotada de Snap Store; Microsoft firma el MSIX.
- `scripts/generate-updater-manifest.mjs` genera `latest.json` con 5 claves obligatorias:
  `linux-x86_64`, `linux-deb-x86_64`, `linux-rpm-x86_64`, `windows-x86_64`, `android-aarch64`.
  `generate-release-manifest.mjs` genera el catálogo de auditoría validado contra
  `schemas/release-manifest.schema.json`. `check-updater-compat.mjs` comprueba
  además que ninguna entrada tenga `signature` vacía (compatibilidad con clientes
  Android antiguos); el workflow lo ejecuta antes de publicar.

### 10.3 Empaquetado por plataforma

| Plataforma | Artefactos | Detalle |
| :--- | :--- | :--- |
| Linux | `.deb`, `.rpm`, `.AppImage` (+`.sig`) | `tauri.linux.conf.json`; Snap y Flatpak reutilizan el `.deb` sin recompilar Rust. |
| Windows | `.exe` (NSIS), `.msi` (+`.sig`) | `tauri.windows.conf.json`; `installMode: currentUser`. |
| Microsoft Store | `.msix` | `npm run build:store`, `prepare-store-msix.mjs`, `makeappx`. |
| Android | APK firmada | `tauri android init`, minSdk 33, publicada en `Descargas/BetterTracker`. |

### 10.4 Dependabot

`.github/dependabot.yml`: semanal, 5 PRs abiertos por ecosistema (`github-actions`, `npm`,
`cargo` en `/src-tauri`). Las ramas `origin/dependabot/...` cambian solo lockfiles,
versiones y SHAs de actions; no tocan lógica de la app.

---

## 11. Documentación existente (índice)

| Documento | Pregunta que responde |
| :--- | :--- |
| `README.md` / `README.es.md` | Qué es la app y cómo compilarla. |
| `docs/USAGE.md` / `docs/USAGE.en.md` | Cómo se usa (proyección, composición, actualizaciones). |
| `docs/METODOLOGIA.md` | Fórmulas y fuentes científicas. |
| `docs/VERSIONING.md` | Versión, manifiestos y publicación. |
| `docs/KEYSTORES.md` / `docs/RELEASE_SECRETS.md` | Claves y secretos. |
| `docs/MICROSOFT_STORE.md` | Identidad MSIX. |
| `DECISIONES.md` / `CONTRIBUTING.md` | Decisiones de diseño y reglas de contribución. |
| `docs/AVANCES.md`, `docs/releases/v*.md` | Estado e hitos. |
| `docs/CHECKLIST_SEGURIDAD.md` | Fases de endurecimiento (contiene evidencia congelada: verificar antes de citar). |
| `docs/CHECKLIST_*SCANER*.md`, `docs/REVISION_APPS_LIBRES_ESCANER.md` | Históricas: el escáner de cámara se retiró en 0.9.9. |

> **Documentos con datos atrasados detectados al indexar:** `docs/VERSIONING.md` aún describe
> `latest.json` con solo 2 claves (hoy son 5)
> y `THIRD_PARTY_LICENSES.md` es un snapshot de 0.9.18.

---

## 12. Índice funcionalidad → código (búsqueda rápida)

> Tabla de consulta: partiendo de lo que ves en la app, aquí está la pieza que lo hace funcionar.
> `[D]` dominio, `[F]` frontend/dominio, `[R]` Rust, `[I]` infra.

### 12.1 Bóveda y datos

| Funcionalidad | Dónde está |
| :--- | :--- |
| Elegir bóveda | `[F] vault.ts selectVault` (100) → `[R] vault.rs select_vault` (469) → diálogo/SAF (+ nombre opcional) |
| Cargar eventos al arrancar | `[F] App.tsx refresh` (129) → `vault.ts listEvents` (163) → `[R] commands.rs list_events` (771) |
| Guardar un evento | `[F] vault.ts appendEvent` (176) → `[R] commands.rs append_event` (778) → `vault.rs write_local_event` (730) |
| Detectar borrado externo de eventos | `[F] App.tsx:148` (`bt.event-count:<vault>`) |
| Copias diarias y restauración | `[F] App.tsx createBackup (350)/restoreCopy (431)` → `[R] vault.rs:1758-2050` |
| Bóveda en navegador | `[F] vault.ts:9-36` (`bt.mock.*`), `clearMockData` 366 |
| Versión/esquema mostrado en Ajustes | `[R] version.rs app_info` (20) → `[F] vault.ts getAppInfo` (187) |

### 12.2 Entrenamiento y cuerpo

| Funcionalidad | Dónde está |
| :--- | :--- |
| Biblioteca de ejercicios y zonas | `[F] TrainingView LibraryTab` (160), `zones.ts zoneForExercise` (240) |
| Rutinas, plan y mesociclos | `[F] TrainingView RoutinesTab/PlanTab` (440/806), `metrics.ts reduceRoutines/Plans/Mesocycles` |
| Sesión y temporizador | `[F] TrainingView SessionTab` (1016), `components/RestTimer.tsx:65` |
| Carga semanal, PR y alertas | `[D] metrics.ts trainingSummary` (526), `estimateTraining` (669), `trainingAlerts` (733) |
| Grasa corporal (13 ecuaciones) | `[D] metrics.ts bodyComposition` (1759) |
| FFMI / military (DoDI 1308.03) | `[D] metrics.ts:2050-2082`, `docs/METODOLOGIA.md` |
| Intervalo de proyección | `[D] bodyRange.ts` (`weightLow/High` = p5–p95, `unreachedScenarios`); la TDEE del balance usa `dailyBreakdown.tdee`, no `macros.tdee`. |
| Edad y sexo | `[D] energy.ts` (`bmrAgeAdjusted`), `metrics.ts` (`ageFamilyFactor`), `bodyRange.ts` (`ageLeanFactor`, `ageGainFactor`). |
| Curva de proyección e intervalo 90 % | `[D] bodyRange.ts projectBody` (805) + `integrateOnce` (497) + Monte Carlo (716) → `[F] ProjectionCurve/ProjectionWeights` |
| Silueta ilustrativa | `[F] BodyFigure.tsx` (`limb`, `limitsFor`): solo refleja las medidas; se editan en el formulario en centímetros |

### 12.3 Nutrición y hábitos

| Funcionalidad | Dónde está |
| :--- | :--- |
| Diario de comidas | `[F] PanelView` → `components/FoodLog.tsx:46` → `foodDb.ts calcFood/mealTotals` |
| Borrador diario | `[F] meals.ts loadMealDraft` (49) (`bt.meal.draft.v1`) |
| Código de barras | `[F] findFoodByBarcode` → `lookupBarcodeCatalog` → `vault.ts lookupBarcode` → `[R] barcode.rs lookup_barcode` |
| Búsqueda remota por palabras clave | `[F] FoodLog` → `vault.ts searchFoodsRemote` → `[R] barcode.rs search_foods_remote`; Search-a-licious de 1 petición con `nutriments` + 2 hosts de respaldo y límite de 8 búsquedas/minuto **solo en Windows**, 3 hosts originales en Linux/Android |
| Sin salto de scroll al llegar resultados | `[F] FoodLog applyRemoteResults` (191) + `useLayoutEffect` (199) y `.food-results.is-searching` (`styles.css:3077`), `overflow-anchor: none` |
| Macros y agua | `[D] metrics.ts computeMacros` (974), `computeWaterGuidance` (1096) |
| Digest semanal y racha | `[D] nutrition.ts nutritionDigest` (163), `nutritionStreak` (328) |
| Recetas recomendadas | `[D] recipes.ts recommendRecipes` (414) |
| Hábitos, ánimo y rachas | `[D] wellness.ts wellnessDigest` (182), `habitStreaks` (263), `[F] WellnessView.tsx:56` |

### 12.4 Plataforma y build

| Funcionalidad | Dónde está |
| :--- | :--- |
| Sin marco de ventana y redimensionado | `[F] components/WindowChrome.tsx:194/274` |
| Tema claro/oscuro y 9 acentos | `[F] theme.tsx applyTheme` (56), `styles.css:1-493`, `public/theme-init.js` |
| Idioma ES/EN | `[F] i18n.tsx t/tx` (40/48), `bt.lang` |
| Actualizaciones | `[F] updater.ts:161/207` → `[R] commands.rs:165/421/547` → `latest.json` |
| Build Store sin updater | `[I] package.json build:store`, `tauri.store.conf.json`, `store-msix.yml` |
| Sincronización de versión | `[I] scripts/sync-version.mjs`, `VERSION` |
| Publicación | `[I] release.yml` jobs `draft/build/build-android/publish` |

---

## 13. Glosario de formatos y convenciones

| Término | Significado y dónde se define |
| :--- | :--- |
| **Bóveda** | Carpeta elegida por el usuario. Raíz de datos en `omega/`; configuración en `<app_data_dir>/config.json`. |
| **Evento (append-only)** | `{id, device_id, timestamp, kind, payload}` (`types.ts:258`, `vault.rs:74`). Un archivo `.json` por evento; las bajas son lápidas (`training.deleted`) y los cortes `history.cleared`. |
| **`kind`** | Nombre del evento: `exercise.upsert`, `session.saved`, `weight.logged`, `nutrition.logged`, `food.saved`, `goal.mode`, `activity.level`, `steps.average`, `training.frequency`, `intake.average`, `habit.*`, `mood.logged`, `profile.saved`… |
| **`longlife`** | Copia diaria por dispositivo con `snapshot.json` + `.backup-complete`; retención de 7 copias **en total** (todos los dispositivos), borrando las más antiguas. Heredado `Longlife`. |
| **SAF** | Storage Access Framework de Android; `vault.rs` guarda un `FsUri` en `config.json` (`saf_uri_from_root`, 309). |
| **TDEE / NEAT / EAT / TEF** | Gasto total / no ejercicio / ejercicio / termogénesis de la comida (`metrics.ts computeEnergyExpenditure`, 948). Los pasos son suelo de NEAT, no suma. |
| **FFMI** | Índice de masa libre de grasa = `magra / altura_m²` (`metrics.ts:2050`), normalizado por altura. |
| **RHO_FAT / RHO_LEAN** | 9400 / 1800 kcal por kg de tejido en la proyección (`bodyRange.ts:316`). |
| **Intervalo del 90 %** | Banda percentil 5–95 de 81 escenarios Monte Carlo en `projectBody` (`bodyRange.ts:716`). |
| **GTIN/UPC/EAN** | Códigos de 8/12/13/14 dígitos; checksum mod 10 (`foodDb.ts:803`) y variantes con ceros (`813`). |
| **`bt.*`** | Prefijo de las claves de `localStorage`: tema, acento, idioma, escala de fuente, pestaña, borrador y contador de eventos. |
| **`data-theme` / `data-accent`** | Atributos en `<html>` que gobiernan la paleta (`theme.tsx:56`). |
| **`--primary*`, `--surface*`** | Variables CSS de la hoja base (`styles.css:1`); los componentes deben usarlas en vez de hex. |
| **`publisher` / `authors`** | `wulflo` en `tauri.conf.json` y `Cargo.toml`; determina el autor mostrado por los instaladores. |

---

### Cierre

Este índice es un mapa, no una guía de cambio: para entender **por qué** se tomó una decisión
consulta `DECISIONES.md` y `docs/METODOLOGIA.md`; para entender **cómo se usa** la app,
`docs/USAGE.md`; y para el estado de releases, `docs/VERSIONING.md` y `docs/AVANCES.md`.
Tras modificar código, actualiza este documento con la skill `Estructure` o el comando
`/estructure-sync`.
