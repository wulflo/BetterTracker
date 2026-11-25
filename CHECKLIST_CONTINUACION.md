# Checklist de continuación (si se corta el internet)

> Estado: mejoras del motor de composición militar, la proyección dinámica de dos
> compartimentos y la interfaz siempre desplegada implementadas (2026-11-21).
> Ejecuta los comandos de verificación tras cualquier cambio y antes de
> continuar. Este documento es la fuente de verdad del estado del trabajo.

## Verificación inmediata

```
npx tsc --noEmit      # tipos estrictos — no debe dar errores
npm test              # 90 pruebas (metrics.test.ts + bodyRange.test.ts + resto)
npm run build         # build de producción (tsc + vite build)
```

Si algo falla, revisa primero `src/metrics.test.ts` y `src/bodyRange.test.ts`.

## Lo implementado

1. [x] `src/metrics.ts`
   - [x] Ecuaciones militares modernas: Fuchs (hombres, bíceps flexionado), Brennen (mujeres, antebrazo), Boer (1984).
   - [x] Indicadores FFMI, FFMI normalizado, `ffmiStatus` (USARIEM), `militaryStandard` (DoDI 1308.03), `muscularOverride`.
   - [x] `bodyComposition` conserva `methods`, `avg`, `min`, `max`, `bmi`, `fatMass`, `leanMass`, `whr`, `whtr`, `bmrMifflin`, `bmrKatch`, `bmrCunningham`, `tdee`, `missing`, `used`, `confidence`, `coverage` y añade los nuevos campos.
   - [x] Ponderación por varianza inversa (`w_base = (1/SEE²)·(1 + 0,05·max(0, inputs − 2))`) con mediana ponderada inicial, desviación estándar robusta (MAD × 1,4826, suelo 1,5 % de la mediana) y amortiguación Huber (`h_i = min(1, 1,5σ/|v_i − mediana|)`); normalización por familia conservada.
   - [x] `computeEnergyExpenditure(m, summary, declaredPerWeek, avgSteps, activityLevel, intakeKlcDelta, lang)` → `EnergyBreakdown { bmr, tef, neat, eat, tdee, activityFactor }`.
   - [x] `activityBaseFactor` y `trainingEatKlcPerDay` exportados; `stepActivityMultiplier` conservada.
   - [x] `computeMacros` con `ComputeMacrosOptions` (`summary`, `declaredPerWeek`, `declaredIntake`); `MacroResult` añade `tef`, `neat`, `eat`; conserva la API pública anterior.
2. [x] `src/bodyRange.ts`
   - [x] Integrador fisiológico diario (dt = 1 día) de dos compartimentos (Hall/Forbes + termogénesis adaptativa, α ≈ 0,11, τ = 18 días).
   - [x] Partición grasa/magra por Forbes (10,4/F) modulada por fuerza: déficit con fuerza ≥12 → pérdida magra ≈5–10 %; superávit → ganancia de magra ≈20–25 % sin fuerza / ≈45–55 % con fuerza.
   - [x] Transitorio de glucógeno/agua (±1,8 kg).
   - [x] Banda de incertidumbre: trayectorias límite (±8 % metabólico y adherencia); `weightLow`, `weightHigh`; hitos con `weightLow`/`weightHigh`/`dateLow`/`dateHigh`.
   - [x] `BodyProjection` añade: `dailyBreakdown`, `weightLow`, `weightHigh`, `trajectory`, `adaptiveThermogenesis`; conserva todos los campos existentes.
   - [x] `projectBody` usa el integrador; conserva la firma pública.
3. [x] `src/metrics.test.ts`, `src/bodyRange.test.ts` — 90 pruebas pasando (militares, Huber, TDEE continuo, fuerza, bandas, etc.).
4. [x] `src/BodyView.tsx`
   - [x] Proyección siempre desplegada (sin `<details>`); siempre visible: nivel de actividad, pasos, ingesta, frecuencia.
   - [x] Tarjeta de proyección: desglose del gasto (BMR, NEAT pasos, EAT entreno, TEF, AT), banda de confianza (hitos), evolución de composición corporal (grasa, magra, FFMI).
   - [x] Tarjeta **Indicadores militares modernos** (FFMI, estándar DoDI 1308.03, aviso de masa muscular).
5. [x] `src/components/ProjectionInputs.tsx` — hints actualizados (NEAT continuo, EAT, TEF).
6. [x] `src/components/ProjectionCurve.tsx` — nuevo: curva de evolución proyectada (fatMass, leanMass, ffmi).
7. [x] `src/i18n.tsx` — idioma por defecto inglés al instalar; español según preferencia guardada.
8. [x] `src/views/custom-select.ts` — `CustomSelect` (botón + menú desplegado con estilos del tema) + `migrateSelect(select)`.
9. [x] `src/styles.css` — contraste de la sidebar en modo claro; borde más visible en `.vault-chip`.
10. [x] `docs/METODOLOGIA.md`, `DECISIONES.md`, `docs/USAGE.md` (español), `docs/USAGE.en.md` (inglés).

## Tarea en curso (revisión visual del usuario, 2026-11-21)

- [x] **Pesos proyectados hasta el peso ideal**: añadida tabla semana a semana
  (`src/components/ProjectionWeights.tsx`) con peso de tejido, grasa, magra y
  % grasa, encabezado con objetivo/fecha y fila final resaltada. Se renderiza
  siempre que haya trayectoria, antes de la curva. La curva
  (`ProjectionCurve.tsx`) ahora incluye también el peso en una escala común en
  kg. Los hitos antiguos se conservan como resumen.
- [x] **Barra superior con el color de la sidebar**: `.topbar` usa
  `var(--sidebar-bg)` en todos los temas (la variable `--topbar-bg` queda sin
  uso directo).
- [x] **Ritmo semanal corregido**: `weeklyRateKg`/`finalWeeklyRateKg` se
  calculaban con deltas diarios (0,13 kg/sem) en vez de semanales (≈0,9). Ahora
  se multiplican por 7; añadida prueba de regresión en `bodyRange.test.ts`.
- [x] Se pasa `summary` y `declaredPerWeek` a `projectBody` desde `BodyView`
  para que el EAT de la proyección no quede en 0 cuando hay frecuencia declarada.
- [x] **Curva responsiva**: `ProjectionCurve` mide el ancho real de su contenedor
  con `ResizeObserver`, adapta el alto (180–260 px) y el `viewBox`, y distribuye
  rejilla/eje Y, fechas en X y valores finales en la leyenda. Verificado en
  navegador: 723 px → `viewBox 723×260`; 320 px → `320×180`.
- [x] **La tabla y la curva ya no desaparecen sin déficit**: cuando el objetivo
  es mantenimiento o el balance no empuja al objetivo, el integrador genera una
  trayectoria plana de 12 semanas (`FLAT_PROJECTION_DAYS`). `weeks` sigue siendo
  0 y no se inventa fecha de llegada; la UI explica que no habrá cambio.
- [x] Verificación: `npx tsc --noEmit`, `npm test` (91 pruebas) y `npm run build`.
- [ ] Revisión visual final en la app nativa (`npm run dev`/Tauri).
- [x] Commit con todo el trabajo pendiente.

## Próximos pasos (si se reanuda)

1. [x] Ejecutar `npx tsc --noEmit && npm test && npm run build`.
2. [x] Revisar en navegador: curva responsiva, tabla semanal y caso mantenimiento.
3. [x] Verificar el build de producción completa.
4. [ ] Revisión visual final del usuario en la app nativa.
5. [x] Hacer commit de los cambios pendientes.

## Notas para continuar

- La bóveda (append-only) no se modifica por estos cambios: los eventos existentes (`activity.level`, `steps.average`, `training.frequency`, `intake.average`, `measurement.saved`, `weight.logged`) son compatibles.
- Si internet se corta y vuelve: solo hace falta `npx tsc --noEmit && npm test && npm run build` para confirmar que nada roto.

---

# Cambios solicitados (2026-11-21) — checklist de continuación

> Si se corta el internet, retoma desde aquí. Ejecuta siempre
> `npx tsc --noEmit && npm test && npm run build` antes de seguir.

## Tareas

1. [x] **Color de acento coincide con la interfaz**: `BodyFigure.tsx` usaba
   colores hex fijos (`#8f6fe8`, `#d0bcff`, …) independientes del acento
   elegido. Sustituidos por variables CSS (`--primary-deep`, `--primary`,
   `--primary-strong`, `--primary-container`, `--on-primary-container`,
   `--warning`) para que sigan el acento activo.
2. [x] **Proyección en 5 puntos**: tabla y gráfico usan una trayectoria
   muestreada a 5 puntos (inicial, 3 intermedios, peso objetivo) en vez de
   las ~12 semanas. El integrador diario se conserva; solo se muestrea la
   salida (`sampleTrajectory` en `src/bodyRange.ts`).
3. [x] **Algoritmo de predicción conservado**: integración diaria de dos
   compartimentos (Hall/Forbes + termogénesis adaptativa) intacta; comparado
   con la versión subida en GitHub (commit inicial) sin regresiones; 91
   pruebas pasan.
4. [x] **Checklist de continuación**: este documento.
5. [x] **README con 3 screenshots**: añadir 3 capturas en `README.md` y
   `README.es.md` desde `docs/screenshots/`.
6. [x] **Actualizar release**: bump `VERSION` a `0.9.20`, sync, notas en
   `docs/releases/v0.9.20.md`.
7. [x] **Push + workflows**: commit(s), push a `main`, lanzar workflows
   manuales (`package-linux`, `store-msix`, `release` con tag `v0.9.20`).

## Corrección 2 (2026-11-21): proyección y acento

- [x] **Sidebar y topbar**: en modo claro usan `var(--bg-2)` en vez del tinte
   violeta fijo, así siguen el acento activo.
- [x] **Proyección útil en modo mantener**: si el objetivo es «Mantener» pero
   la composición está fuera del rango saludable, la proyección muestra la
   referencia hacia ese rango (con aviso) en vez de 5 filas idénticas.
- [x] **Sin filas repetidas**: si el balance no cambia el tejido, la tabla
   muestra solo el punto actual y «sin cambio de peso proyectado».
- [x] **Banda de confianza**: el tope de ritmo seguro se escala con la
   variabilidad (±8 %), así la banda no colapsa cuando el déficit es agresivo.
- [x] **Etiqueta**: «5 puntos proyectados» en lugar de «4 semanas proyectadas».
- [x] **Commit marcado**: la corrección de proyección está en `04b1aaf`
  (`fix: useful projection when goal is maintain; scale confidence band`).
- [ ] **Verificación del usuario** en la app nativa.
- [x] **Re-lanzar workflows** con la release `v0.9.21` (tag + manuales).

## Release 0.9.21

- [x] `VERSION` = `0.9.21` y sincronizado en todos los manifiestos.
- [x] Notas en `docs/releases/v0.9.21.md`.
- [x] README/README.es con la versión nueva.
- [x] Push a `main` y tag `v0.9.21` (dispara Release).
- [x] Workflows manuales: `package-linux` y `store-msix`.

## Presentación del README y CI (2026-11-21)

- [x] Cabecera centrada con badges `flat-square`, enlaces rápidos y versión.
- [x] Capturas en tablas de 2/3 columnas (estilo SinNotas) en vez de imágenes
  sueltas comprimidas por el ancho de línea.
- [x] Captura destacada del panel a ancho completo.
- [x] `RUSTSEC-2026-0543` (chrono sin mantenimiento) ignorado con justificación
  en `src-tauri/deny.toml` para que `cargo-deny` no tumbe el CI.

## Rendimiento en máquinas virtuales / sin aceleración gráfica

- [x] **Detección de VM**: `src-tauri/src/main.rs` detecta QEMU/KVM, VirtualBox,
  VMware, Hyper-V, Xen, Parallels, OpenStack, cloud, etc. por DMI,
  `/proc/xen`, `/sys/hypervisor/type` y el flag `hypervisor` de `/proc/cpuinfo`.
- [x] **Sin nodo de render**: si no hay `/dev/dri/renderD*`, se asume render por
  software.
- [x] **Modo compatibilidad**: en esos casos se activa
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`; sin nodo de render se añaden
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` y `LIBGL_ALWAYS_SOFTWARE=1`.
- [x] **Overrides del usuario**: las variables de WebKit siguen teniendo
  prioridad y desactivan la detección automática.
- [x] Pruebas Rust de detección de hipervisores (`cargo test --bin better-tracker`).

## Release 0.10.1 — predictor e intervalo científico

- [x] Revisión con datos reales de la bóveda (`/home/alonso/Descargas/Salud`).
- [x] NEAT sin doble conteo: `(PAL − 1) × BMR` y pasos como suelo.
- [x] Coste de caminar corregido a 0,45 kcal/kg/1000 pasos.
- [x] Curva de Forbes corregida a `10,4/(F + 10,4)`.
- [x] Intervalo de predicción del 90 % (Monte Carlo, 81 escenarios).
- [x] Hitos coherentes con la trayectoria simulada.
- [x] `VERSION` = `0.10.1` y manifiestos sincronizados.
- [x] README/README.es con la versión nueva.
- [x] Notas en `docs/releases/v0.10.1.md`.
- [x] Push a `main` y tag `v0.10.1` (dispara CI y Release).
- [x] No lanzar `store-msix` (manual) ni usar `gh run watch`.

## Release 0.10.2 — Estructure, skills y autor del instalador

- [x] `docs/Estructure.md` creado con el mapa técnico de la app.
- [x] Skills `.opencode/` adaptadas de SinNotas (Estructure, Estilo UI, Guía de uso,
  Traducciones UI, Búsqueda incremental) y comando `/estructure-sync`.
- [x] `bundle.publisher` = `wulflo` en `tauri.conf.json` y `authors` = `wulflo` en Cargo.toml.
- [x] `VERSION` = `0.10.2` y `node scripts/sync-version.mjs` ejecutado.
- [x] README/README.es con la versión nueva.
- [x] `docs/releases/v0.10.2.md`: notas de release.
- [x] `docs/VERSIONING.md`: Android, cinco claves de `latest.json` y ejemplo actualizado.
- [x] `npx tsc --noEmit`, `npm test` (92), `npm run build`, `cargo check --locked`.
- [x] `npm run tauri dev` comprobado por el mantenedor.
- [x] Push a `main`, tag `v0.10.2` y workflows lanzados (URLs en `CHECKLIST_v0.10.2.md`).
- [x] PR de Dependabot **no incluidos** en esta versión (evaluados por separado).
