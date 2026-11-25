---
name: Estilo UI
description: Revisar que los controles, paneles y gráficos nuevos o modificados de Better Tracker conserven la estética de la app (temas claro/oscuro, acentos, tipografía, padding y foco); usar al añadir controles o al revisar diffs de UI en React/CSS.
---

# Estilo UI — revisión de controles (React + CSS)

Propósito: evitar que aparezcan controles con el estilo del sistema operativo o desalineados con el resto de la app. **Revisa y reporta**; no cambies código de aplicación salvo que te lo pidan explícitamente.

## Checklist obligatorio

1. **Selectores desplegables**
   - Todo selector nuevo debe usar `Select` de `src/components/Select.tsx`. Nunca dejar un `<select>` nativo visible: su menú depende del SO.
   - `Select` ya gestiona `value`, `onChange`, teclado (Flechas, Enter, Escape), búsqueda opcional (`searchable`) y cierre al pulsar fuera; comprobar que el valor sigue siendo controlado por el estado de React y que `onChange` actualiza ese estado.
   - `src/views/custom-select.ts` contiene una implementación equivalente con `React.createElement` y `migrateSelect()` que **no está importada por la app**: sirve solo de referencia, no para componentes nuevos.

2. **Temas y acentos**
   - La app tiene 2 modos (`dark` por defecto, `light`) y 9 acentos (`violet`, `blue`, `teal`, `green`, `amber`, `orange`, `red`, `pink`, `indigo`), gobernados por `data-theme` / `data-accent` en `<html>` desde `src/theme.tsx`.
   - Usar solo tokens CSS definidos en `src/styles.css`: `--bg`, `--bg-2`, `--surface*`, `--primary*`, `--on-surface*`, `--outline*`, `--success`, `--warning`, `--error`, `--radius-*`, `--shadow-*`. Prohibidos colores hexadecimales fijos en componentes nuevos (salvo la paleta en `src/theme.tsx` y las definiciones de tema en `styles.css`).
   - Verificar cada cambio con `data-theme="light"` y sin atributo (oscuro), y con al menos dos acentos muy distintos (p. ej. `violet` y `amber`): los acentos tiñen también fondos y superficies.
   - `applyTheme()` también actualiza `<meta name="theme-color">` leyendo `--bg`; no duplicar esa lógica en el componente.

3. **Tipografía, padding y foco**
   - `font: inherit` / `font-family: inherit`; tamaños con `rem`/`em` o variables, nunca `px` fijos para texto cuando el resto usa escala.
   - `box-sizing: border-box` cuando haya `width`/`height` fijos; padding coherente con `.field`, `.card` y los controles de Ajustes (aprox. 8–12 px).
   - `:focus-visible` con `outline` o `box-shadow` en `var(--primary)`; `:hover` con `var(--surface-2)` o `var(--primary-container)`.
   - Objetivos táctiles de al menos 44 px en la barra inferior móvil.

4. **Gráficos y tablas**
   - Reutilizar los componentes de `src/components/Charts.tsx` (`FatTrend`, `ProjectionCurve`, etc.) antes de crear SVG nuevo: ya leen los tokens de tema y acento.
   - Los colores de series deben venir de variables CSS o de `useTheme()`, no de literales, para que sigan al acento activo.
   - En tablas, alinear números a la derecha y unidades en la cabecera; mantener el mismo formato que el resto de la app.

5. **Verificación final**
   - `npx tsc --noEmit` y `npm test` (y `npm run build` si el cambio afecta al bundle).
   - Si el cambio afecta a símbolos documentados, actualizar `docs/Estructure.md` (skill `Estructure`).

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Proveedor de tema, acentos, `applyTheme()` | `src/theme.tsx` |
| Tokens CSS y reglas de componentes | `src/styles.css` |
| Selector personalizado (en uso) | `src/components/Select.tsx` (`Select`) |
| Referencia no enlazada / migrador DOM | `src/views/custom-select.ts` (`migrateSelect`) |
| Componentes de gráficos | `src/components/Charts.tsx`, `src/components/FatTrend.tsx`, `src/components/ProjectionCurve.tsx` |
| Mapa de estilos | `docs/Estructure.md` (sección de interfaz) |
