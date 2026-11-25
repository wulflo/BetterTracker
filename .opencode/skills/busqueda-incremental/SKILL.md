---
name: Búsqueda incremental
description: Diseñar o revisar búsquedas, listas y agregaciones de Better Tracker (alimentos, códigos de barras, historial y gráficos) para que no congelen la UI; usar ventanas, límites, cachés acotadas y cálculos memoizados; usar al añadir un buscador, lista grande o al revisar diffs que renderizan resultados.
---

# Búsqueda incremental y listas grandes — patrón de Better Tracker

Propósito: que la búsqueda de alimentos, el historial y las agregaciones de métricas no
congelen la UI ni recalculen de golpe bóvedas grandes. **Revisa y reporta**; no cambies
código de aplicación salvo que te lo pidan explícitamente.

## Reglas

1. **Nunca montar filas sin límite.** El historial usa `visibleCount` (`HistoryView.tsx`)
   con «Mostrar más»: mantener esa ventana o paginación en cualquier lista nueva.
2. **Filtrar con límite y hacer debounce.** La búsqueda de alimentos (`searchFoods` en
   `src/foodDb.ts`, usada por `src/components/FoodLog.tsx`) debe esperar ~100–150 ms
   tras el `input` y devolver como máximo los primeros N resultados; no iterar todo
   `FOODS` para crear nodos DOM.
3. **Catálogo de barras: una sola carga, búsqueda por clave.**
   `src/barcodeCatalog.ts` cachea el JSON embebido (`loadBarcodeCatalog`,
   `resetBarcodeCatalogCache`) y `lookupBarcodeCatalog` busca por código, sin escanear
   el catálogo en cada pulsación. El chunk generado es grande (~614 KB): no importarlo
   en módulos que no lo necesiten y no duplicar la caché.
4. **Agregar antes de dibujar.** `metrics.ts` (reducción de eventos, `weeklySeries`,
   `trainingSummary`, `bodyComposition`) y `nutrition.ts`/`wellness.ts` producen series
   pequeñas derivadas de `events`; pasar esas series a los componentes de
   `src/components/Charts.tsx`, no los eventos crudos ni un punto SVG por evento.
5. **Memoizar cálculos y resultados.** Los views ya usan `useMemo` (`TrainingView.tsx`
   para `routines`, `plans`, `prs`, `summary`; `PanelView.tsx` para `macros`, `comp`,
   `projection`). Mantener el cálculo fuera del render cuando dependa solo de `events`.
6. **Cache acotada y bajo demanda.** El borrador de comidas (`src/meals.ts`,
   `bt.meal.draft.v1`) se descarta si no es de hoy; la bóveda se relee con `listEvents`
   y se evita releer durante 1,2 s tras un append local (`lastLocalAppendRef` en
   `App.tsx`). No introducir mapas que crezcan sin límite.
7. **Red en Rust, no en el webview.** La CSP tiene `connect-src 'none'`; Open Food Facts
   se consulta con `lookup_barcode` (`src-tauri/src/barcode.rs`) y el resultado se
   guarda como evento `food.saved` para usarlo sin red. No añadir `fetch` desde React.
8. **Métricas simples.** Si el cambio puede afectar rendimiento, comprobar el número de
   nodos renderizados y el tiempo de respuesta antes y después con `npm test` y, si
   aplica, el smoke de Playwright (`tests/visual/smoke.spec.ts`).

## Checklist de revisión

- [ ] ¿El buscador/lista tiene `limit` o ventana explícita?
- [ ] ¿Hay debounce en el evento `input`?
- [ ] ¿La lista usa «Mostrar más»/paginación en vez de montar todo?
- [ ] ¿El catálogo se carga una sola vez y se busca por clave?
- [ ] ¿Las agregaciones se memoizan y pasan series reducidas a los gráficos?
- [ ] ¿La caché tiene límite o caducidad (p. ej. borrador de hoy)?
- [ ] ¿No se añaden peticiones de red en el frontend (CSP `connect-src 'none'`)?
- [ ] ¿`npx tsc --noEmit` y `npm test` pasan?

## Referencias rápidas

| Patrón | Dónde |
| :--- | :--- |
| Búsqueda de alimentos y unidades | `src/foodDb.ts` (`searchFoods`, `calcFood`) |
| Diario y selección de alimentos/códigos | `src/components/FoodLog.tsx` |
| Catálogo offline y caché | `src/barcodeCatalog.ts`, `src/data/barcodeCatalog.json` |
| Ventana de filas del historial | `src/HistoryView.tsx` (`visibleCount`) |
| Reducción de eventos y series | `src/metrics.ts`, `src/nutrition.ts`, `src/wellness.ts` |
| Gráficos SVG | `src/components/Charts.tsx` |
| Mapa general | `docs/Estructure.md` §4, §5, §7 |
