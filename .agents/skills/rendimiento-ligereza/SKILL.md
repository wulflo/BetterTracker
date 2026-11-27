---
name: Rendimiento y ligereza
description: Auditar Better Tracker para detectar y proponer mejoras de rendimiento y ligereza de comportamiento (render React, paint CSS, IPC Tauri, bóveda, bundle, red, arranque y memoria); usar al revisar diffs que afecten a vistas, listas, búsquedas, cálculos o al puente TS↔Rust.
---

# Rendimiento y ligereza — auditoría de comportamiento

Propósito: que la app se sienta **fluida y ligera** en escritorio, Android y WebKitGTK,
sin sacrificar corrección. **Revisa y reporta** con evidencia y propuestas; no cambies
código de aplicación salvo que te lo pidan explícitamente.

> Complementaria de `Búsqueda incremental` (listas y búsquedas concretas) y de
> `vault-performance-guard` (reglas estrictas de bóveda en SinNotas). Si el hallazgo
> es solo de búsqueda/listas, remite a la primera.

---

## 1. Principios

1. **Mide antes de optimizar**: describe el síntoma (qué pantalla, qué acción, qué
   dispositivo) y una métrica antes/proponiéndola después. No propongas microoptimizaciones
   sin impacto observable.
2. **Lo caro cruza el puente IPC o el DOM**: minimiza `invoke()` y nodos, no líneas de código.
3. **El coste se paga en el render**: cualquier cálculo dentro de `render` se repite en
   cada actualización de estado.
4. **Ligereza = menos bytes y menos trabajo**: bundle, arranque, memoria y red.

---

## 2. Checklist por capa

### 2.1 React / render

- [ ] ¿Hay cálculos costosos en el cuerpo del componente sin `useMemo`? Patrón sano:
      `TrainingView.tsx` memoiza `routines`, `plans`, `prs` y `summary`; `PanelView.tsx`
      memoiza `macros`, `comp` y `projection`.
- [ ] ¿Se pasan objetos/arrays literales como props a componentes memorizados? Rompen
      `React.memo`; extrae constantes o estabiliza con `useMemo`.
- [ ] ¿Los `useEffect` limpian timers/listeners/`AbortController`? Revisa `RestTimer.tsx`
      y cualquier suscripción a `EVENT_APPENDED`.
- [ ] ¿Las listas tienen ventana (`visibleCount` en `HistoryView.tsx`) o paginación?
      Nunca montar miles de filas.
- [ ] ¿El estado se actualiza en cada pulsación de tecla y dispara reducciones de la
      bóveda completa? Usa valor local + `onBlur`/debounce (~100–150 ms).
- [ ] ¿Hay `setState` en bucle o guardias ausentes que provoquen renders infinitos?
- [ ] ¿Las vistas se desmontan al cambiar de sección? `App.tsx` las mantiene montadas en
      `.view-slot` con `hidden` para conservar `useMemo` (BodyView: 81×1095 días). Medir
      el cambio de sección en Android con bóveda grande; en navegador con datos de ejemplo
      dio 27–33 ms.

### 2.2 CSS / paint (compositor)

- [ ] **Cero `box-shadow` con desenfoque, `filter: blur()` ni `backdrop-filter` en áreas
      grandes**: fuerzan repintado y son caros en WebView móvil. Usa `border`/`outline`.
- [ ] ¿Las animaciones solo usan `transform` y `opacity`? Evita animar `width`, `height`,
      `top`, `left`, `box-shadow` o `filter`.
- [ ] ¿`transition`/`animation` respetan `prefers-reduced-motion: reduce`?
- [ ] ¿Listas largas usan `content-visibility: auto` / `contain: layout paint` cuando
      aplica (sin sustituir virtualización real)?
- [ ] ¿Se evita `layout thrash` (leer `offsetHeight` y escribir estilos en el mismo bucle)?

### 2.3 Bóveda y Rust (Tauri)

- [ ] ¿Se lee la bóveda completa en el hilo principal o al arrancar? `App.tsx` carga una
      vez con `listEvents` y evita releer durante ~1,2 s tras un append local
      (`lastLocalAppendRef`): mantener ese patrón.
- [ ] ¿El trabajo de archivos va en `spawn_blocking`? Ver `vault.rs` (`read_events`,
      `write_local_event`) y `commands.rs`.
- [ ] ¿Los `invoke()` se agrupan o al menos no se hacen por tecla/fila? Cada llamada
      cruza serialización.
- [ ] ¿Los archivos de evento tienen límite de tamaño (`MAX_LOCAL_EVENT_BYTES`) y
      profundidad (`MAX_LOCAL_DEPTH`/`MAX_SAF_DEPTH`)? No relajar sin justificación.
- [ ] ¿Las escrituras siguen siendo atómicas (temporal `.tmp` + `rename`)? Nunca escribas
      directamente el destino.
- [ ] ¿Las copias `longlife` mantienen retención acotada (`BACKUP_RETENTION = 7`) y no
      crecen sin límite? coordination con la skill `Higiene de archivos`.

### 2.4 Bundle y arranque

- [ ] ¿El catálogo de códigos de barras (~614 KB) se importa solo donde se necesita?
      `barcodeCatalog.ts` lo cachea; no dupliques la caché ni lo importes en módulos fríos.
- [ ] ¿Se pueden mover vistas poco usadas a `import()` dinámico? Revisa el tamaño de los
      chunks con `npm run build` (`dist/assets/`).
- [ ] ¿El splash y `frontend_ready` (700 ms en `main.tsx`) siguen ocultando el arranque
      sin bloquear el primer pintado?
- [ ] ¿Hay dependencias npm/Cargo sin usar? (`cargo clippy -- -D warnings` y, si la
      herramienta está disponible, `npx knip`; no instalar dependencias solo para auditar).

### 2.5 Red

- [ ] La CSP tiene `connect-src 'none'`: **ningún `fetch` desde React**. Toda red pasa
      por Rust (`barcode.rs` → Open Food Facts, `commands.rs` → GitHub).
- [ ] ¿Las peticiones Rust tienen timeout, límite de bytes y manejo de errores? Ver
      `MAX_APK_BYTES`/`MAX_PACKAGE_BYTES` en `commands.rs`.
- [ ] ¿Los resultados de red se guardan como evento (`food.saved`) para no repetirlos?

### 2.6 Memoria

- [ ] ¿Las cachés tienen límite o caducidad? (borrador de comidas `bt.meal.draft.v1`
      se descarta si no es de hoy; catálogo se carga una sola vez).
- [ ] ¿No se retienen eventos antiguos en closures ni mapas que crezcan sin límite?

---

## 3. Formato del informe

| Hallazgo | Evidencia (`archivo:línea`) | Impacto | Esfuerzo | Propuesta |
| :--- | :--- | :--- | :--- | :--- |

- **Impacto**: alto / medio / bajo, con una métrica esperada cuando sea posible
  (p. ej. «evita N repintados por scroll», «reduce X KB del bundle inicial»).
- Máximo 10 hallazgos; marca los **rapid fixes** (una línea) frente a los refactors.
- Si un hallazgo es estético con coste de render, cruza el informe con `Estilo UI`.

## 4. Verificación

```bash
npx tsc --noEmit
npm test
npm run build                 # comparar tamaños de dist/assets/
du -h dist/assets/* | sort -h
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Si el cambio toca la bóveda, añade `cargo test --manifest-path src-tauri/Cargo.toml`
y revisa `src-tauri/examples/bench_vault.rs` como referencia de coste.

## Referencias rápidas

| Tema | Dónde |
| :--- | :--- |
| Carga de eventos y append optimista | `src/App.tsx` (`refresh`, `EVENT_APPENDED`, `lastLocalAppendRef`) |
| Reducciones memoizadas | `src/TrainingView.tsx`, `src/PanelView.tsx` |
| Ventana de filas | `src/HistoryView.tsx` (`visibleCount`) |
| Búsqueda con límite | `src/foodDb.ts` (`searchFoods`), `src/components/FoodLog.tsx` |
| Caché del catálogo | `src/barcodeCatalog.ts`, `src/data/barcodeCatalog.json` |
| Bóveda y escrituras atómicas | `src-tauri/src/vault.rs`, `src/vault.ts` |
| Descargas y bytes máximos | `src-tauri/src/commands.rs` (`MAX_APK_BYTES`, `MAX_PACKAGE_BYTES`) |
| Red desde Rust | `src-tauri/src/barcode.rs`, `src/updater.ts` |
