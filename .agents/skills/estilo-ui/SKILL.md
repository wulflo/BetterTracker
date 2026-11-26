---
name: Estilo UI
description: Criticar la interfaz de Better Tracker y proponer mejoras frente a las tecnologías de UI actuales, además de verificar que controles, paneles y gráficos conserven la estética de la app (temas claro/oscuro, acentos, tipografía, padding y foco); usar al diseñar, revisar diffs de UI o auditar la experiencia visual.
---

# Estilo UI — crítica visual y revisión de controles (React + CSS)

Propósito **dual**:

1. **Conservar** la identidad visual: que no aparezcan controles con el estilo del SO
   ni desalineados con el resto de la app.
2. **Criticar** la interfaz con criterios de diseño actuales y proponer mejoras
   concretas, priorizadas y aplicables a esta app.

**Revisa y reporta; no cambies código de aplicación salvo que te lo pidan
explícitamente.** Cuando propongas, separa «listo para aplicar» de «idea a valorar».

---

## 1. Checklist de consistencia (no negociable)

1. **Selectores desplegables**
   - Todo selector nuevo debe usar `Select` de `src/components/Select.tsx`. Nunca un
     `<select>` nativo visible: su menú depende del SO.
   - `Select` gestiona `value`, `onChange`, teclado (Flechas, Enter, Escape), búsqueda
     opcional (`searchable`) y cierre al pulsar fuera; comprueba que el valor siga
     controlado por React y que `onChange` actualice ese estado.
   - `src/views/custom-select.ts` (`migrateSelect`) es referencia **no enlazada**; no
     lo uses en componentes nuevos.

2. **Temas y acentos**
   - 2 modos (`dark` por defecto, `light`) y 9 acentos (`violet`, `blue`, `teal`,
     `green`, `amber`, `orange`, `red`, `pink`, `indigo`) vía `data-theme` /
     `data-accent` en `<html>` desde `src/theme.tsx`.
   - Usa solo tokens de `src/styles.css`: `--bg`, `--bg-2`, `--surface*`,
     `--primary*`, `--on-surface*`, `--outline*`, `--box-border`, `--success`,
     `--warning`, `--error`, `--radius-*`. Prohibidos hex fijos en componentes nuevos
     (salvo `theme.tsx` y las definiciones de tema).
   - Verifica con `data-theme="light"` y sin atributo (oscuro) y con dos acentos muy
     distintos (`violet` y `amber`): los acentos tiñen fondos y superficies.
   - `applyTheme()` ya actualiza `<meta name="theme-color">`; no lo dupliques.
   - **Sin `box-shadow` con desenfoque**: la app es plana; el foco usa `outline` y los
     bordes usan `--box-border` derivado del acento (no reintroduzcas glows).

3. **Tipografía, padding y foco**
   - `font: inherit`; escala con `rem`/`em` o variables, nunca `px` sueltos para texto.
   - `box-sizing: border-box`; padding coherente con `.field`, `.card` y Ajustes
     (8–12 px); objetivos táctiles ≥ 44 px en la barra inferior móvil.
   - `:focus-visible` siempre visible con `outline` en `var(--primary)`;
     `:hover` con `var(--surface-2)` o `var(--primary-container)`.

4. **Gráficos y tablas**
   - Reutiliza `src/components/Charts.tsx` (`FatTrend`, `ProjectionCurve`, …) antes
     de crear SVG nuevo: ya leen tokens de tema y acento.
   - Colores de serie desde variables CSS o `useTheme()`, nunca literales.
   - En tablas: números a la derecha, unidades en la cabecera,
     `font-variant-numeric: tabular-nums`.

---

## 2. Modo crítica — dimensiones a evaluar

| Dimensión | Qué mirar | Señal de problema |
| :--- | :--- | :--- |
| Jerarquía | ¿Se distingue de un vistazo la acción principal? | Varios botones primarios competindo; títulos del mismo tamaño que valores. |
| Densidad y ritmo | Escala de espaciado coherente (4/8 px), alturas de fila regulares | Márgenes «a ojo», filas que cambian de altura al cambiar de pestaña. |
| Tipografía | Escala modular, `line-height` legible, pesos con significado, `tabular-nums` en cifras | Texto de 11 px en datos, números que «bailan» al actualizarse. |
| Color y contraste | WCAG 2.2 AA: 4.5:1 en texto, 3:1 en controles; el estado **no** depende solo del color | Acento claro sobre superficie clara; rojo/verde sin icono ni etiqueta. |
| Estados | `hover`, `focus-visible`, `active`, `disabled`, `loading`, `empty`, `error`, `success` | Botón desactivado igual que activo; lista vacía sin explicación. |
| Movimiento | 120–250 ms, solo `transform`/`opacity`, `prefers-reduced-motion` | Animaciones que desplazan layout; efectos que se repiten en cada render. |
| Responsive | Rejilla fluida, `overflow-x` controlado, 44 px táctiles, sin scroll horizontal del cuerpo | Tablas que desbordan; modal que se corta en móvil. |
| Consistencia | Un solo patrón por función (pestañas, botones, campos) | Dos estilos de pestañas en vistas distintas. |
| Accesibilidad | `role`/`aria-*` correctos, orden de foco, foco nunca `none` sin alternativa | `role="tablist"` sin `aria-selected`; foco invisible. |
| Carga percibida | Esqueleto o estado de carga antes de datos, sin saltos de layout (CLS) | Pantalla en blanco al abrir; gráficos que «salta» al cargar. |

**Regla de salida:** máximo 10 hallazgos, ordenados por severidad (alta / media /
baja), cada uno con evidencia `archivo:línea` y una propuesta accionable. Separa los
**bloqueantes** (accesibilidad, contraste, foco, desbordes) de los **nice to have**.
Si no encuentras problemas, dilo explícitamente en lugar de inventarlos.

---

## 3. Propuestas frente a la tecnología de interfaces actuales

Úsalas como **catálogo de mejoras**, no como obligación. Todas deben respetar la
identidad de la app y tener fallback: Tauri usa WebView2 (Windows), WebKitGTK
(Linux) y Android WebView, que pueden ir por detrás de Chrome.

| Área | Propuesta moderna | Aplicación aquí / cautela |
| :--- | :--- | :--- |
| Tokens | Capa semántica única (`--surface-*`, `--box-border`) derivada del acento; `color-mix()` para estados | `color-mix()` tiene soporte desigual en WebKitGTK antiguo: mantener `rgba(var(--primary-rgb), …)` como fallback. |
| Color | `oklch()` para escalas perceptuales y `light-dark()` para temas | Solo si se verifica en los 3 WebViews; hoy los temas están en `styles.css` + `theme.tsx`. |
| Cascada | `@layer` y CSS nesting para aislar base/componentes/utilidades | Reduce especificidad; introducir gradualmente sin reescribir la hoja de 4000 líneas. |
| Layout | Container queries + `grid-template-columns: repeat(auto-fit, minmax(…))` en lugar de media queries globales | Ideal para `.grid-*` y tarjetas; fallback con media queries. |
| Formularios | `:user-invalid`, `field-sizing: content`, `appearance: base` | Mejora feedback sin JS; comprobar soporte y no perder `Select`. |
| Interacción | `:has()` para estados de contenedor yView Transitions para cambios de vista | Sin router: las vistas son estado en `App.tsx`; value limitado. |
| Movimiento | `transform`/`opacity` (compositor) + `prefers-reduced-motion: reduce` | Coordinar con la skill `Rendimiento y ligereza`. |
| Render de listas | `content-visibility: auto` y `contain: layout paint` en filas off-screen | Solo con listas largas; no sustituye la virtualización real. |
| Datos | `font-variant-numeric: tabular-nums`, formatos `Intl` vía `locale(lang)` | Ya existe `formatNumber`/`locale` en `i18n.tsx`. |
| Iconografía | SVG con `currentColor` y `aria-hidden="true"` | Ya aplicado en `components/Icons.tsx`; mantenerlo. |

---

## 4. Verificación final

- Revisar el diff con `data-theme="light"` / oscuro y dos acentos (`violet`, `amber`).
- `npx tsc --noEmit` y `npm test` (y `npm run build` si afecta al bundle).
- Si el cambio afecta a símbolos documentados, actualizar `docs/Estructure.md`
  (skill `Estructure`) y, si es visible para el usuario, las guías (skill `Guía de uso`).
- Si la mejora propuesta tiene coste de render, pasa el informe a la skill
  `Rendimiento y ligereza` antes de recomendarla.

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Proveedor de tema, acentos, `applyTheme()` | `src/theme.tsx` |
| Tokens CSS, componentes y media queries | `src/styles.css` |
| Selector personalizado (en uso) | `src/components/Select.tsx` (`Select`) |
| Referencia no enlazada | `src/views/custom-select.ts` (`migrateSelect`) |
| Componentes de gráficos | `src/components/Charts.tsx`, `components/FatTrend.tsx`, `components/ProjectionCurve.tsx` |
| Mapa de estilos | `docs/Estructure.md` (sección de interfaz) |
