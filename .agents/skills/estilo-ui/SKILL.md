---
name: Estilo UI
description: Criticar la interfaz de Better Tracker y proponer mejoras frente a las tecnologías de UI actuales, además de verificar que controles, paneles y gráficos conserven la estética de la app (temas claro/oscuro, acentos, tipografía, padding y foco). Incluye crítica visual basada en capturas reales (jerarquía, ritmo, monotonía, lavados de acento, degradados y ligereza de paint); usar al diseñar, revisar diffs de UI o auditar la experiencia visual.
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
     distintos (`violet` y `amber`): los acentos tiñen fondos y superficies. En claro, `--surface*` y `--card-*-rgb` están definidos por acento; si solo están en `:root[data-theme='light']`, las tarjetas quedan violeta con `amber`.
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

## 2b. Crítica visual basada en capturas (anti-monotonía)

Cuando el usuario diga que la app se ve «plana», «monótona» o que «el acento tiñe todo», no basta con la tabla anterior: **mirar capturas reales**. La skill `Critica visual` (`critica-visual`) es el ejecutor dedicado; esta sección queda integrada para que `estilo-ui` siempre la tenga presente.

**Proceso mínimo**

1. Abrir `http://localhost:1420` (o el Tauri desktop) y capturar Alimentación, Entrenamiento, Cuerpo y Ajustes → Apariencia.
2. Repetir con `data-theme="dark"` + `violet` y `data-theme="light"` + `amber`.
3. Si hay una captura de Android (390×844), incluirla.
4. Preguntar por cada vista: ¿qué se ve primero?, ¿qué parece importante?, ¿hay ritmo o todo está al mismo nivel?, ¿dónde descansa la mirada?
5. Leer `src/styles.css` y explicar cada problema con un token, nunca con un hex suelto.
6. Entregar máximo 8 hallazgos separando **bloqueantes** (jerarquía/contraste) de **mejoras**.

**Dimensiones añadidas**

| Dimensión | Señal de problema |
| :--- | :--- |
| Superficies | Un único gris/violeta plano en sidebar, cabecera, tarjetas y paneles. |
| Lavado de acento | Fondos vaporosos del color del acento en todas partes, o ninguna variación de hue entre zonas. |
| Degradados | Solo fondos sólidos, o degradados radiales grandes y caros de pintar. |
| Énfasis de datos | Cifras del mismo tamaño/color que la explicación, sin `tabular-nums`. |
| Respiración | Todo igual de apretado o todo con la misma separación; ninguna zona de descanso. |
| Microinteracciones | Feedback que rompe el `border-radius` (resaltado cuadrado de Android) o inexistente. |

**Catálogo listo para aplicar (sin sombras)**

1. **Par de hue compartido + complemento (implementado)**: `--accent-hue` para `.btn-primary` y `--wash-side` con dos tonos: `linear-gradient(155deg, rgba(var(--primary-rgb), 0.18), rgba(var(--side-hue-rgb), 0.12) 48%, rgba(var(--primary-rgb), 0) 86%)`. `--side-hue-rgb` es un hue complementario **por acento** (en `:root` y cada `[data-accent]`, con valor más profundo en `[data-theme='light']`): violeta→azul, azul→ámbar, teal/rosa/rojo→cian, verde→violeta, ámbar→azul, índigo→ámbar. No convertir el lavado en fondo sólido; verificar contraste con `--on-surface-variant`.
2. Tokens `--wash-main`, `--wash-card`: `linear-gradient` de `rgba(var(--primary-rgb), 0.05–0.08)` a transparente, con ángulos distintos por zona.
3. `.stat-value`: `font-size: var(--fs-3xl)`, `font-variant-numeric: tabular-nums`, color `--on-surface`; unidades en `--on-surface-variant` y `--fs-sm`.
4. Cabeceras de sección: `letter-spacing: 0.02em`, `font-weight: 700` y barra de acento de 3 px en `::before`.
5. **Elemento activo (implementado)**: sin franja `::before` tipo `border-left`. `.nav-item.active` usa `--nav-active-bg`, `--nav-active-border` y `--nav-icon-active`: lavado 0.16/0.10 en oscuro y 0.22/0.14 en claro, borde 0.20/0.38, etiqueta `font-weight: 700`. El lavado 0.11 anterior era casi invisible en claro; revisar siempre `light+amber`.
6. **Iconos de sección (implementados)**: `.nav-icon` es un chip redondeado de 34 px (`--radius-md`) con `rgba(var(--primary-rgb), 0.075)`; `:nth-child(2n)` alterna `rgba(var(--side-hue-rgb), 0.09)` para dar ritmo de hue y el activo usa `--nav-icon-active` con `color: var(--primary)`. Filas con `padding: 9px` (≈52 px) y `gap: 12px`; no basta con agrandar el glifo.
7. Alternancia de filas en listas largas: `rgba(var(--surface-2), 0.5)` en pares (coste de paint nulo).
8. `--tertiary`/`--info`/`--success` con moderación en chips; nunca en fondos grandes.
9. **Sidebar tipográfica (jerarquía implementada)**: `--fs-side: calc(12px * var(--font-scale))` como base de la barra; marca `--fs-base` (15 px, una línea), subtítulo `--fs-sm` (11 px), `nav-item`/`nav-label`/`vault-chip`/`settings-btn` a `--fs-label` (13 px). `.brand` con `gap: 8px` y `padding: 6px 6px 22px` para que «Better Tracker» no se parta en dos líneas. Nunca fijar px sueltos: rompe Ajustes → Apariencia.
10. Movimiento solo `transform`/`opacity`, 120–200 ms, con `prefers-reduced-motion: reduce`.

**Prohibido**: `box-shadow` con desenfoque o sombras externas, `filter: blur()`, `backdrop-filter`, degradados radiales que cubran toda la pantalla, hex fijos en componentes, texto < 11 px y estados que dependan solo del color.

**Formato de informe**: `| # | Hallazgo | Evidencia (captura / styles.css:línea) | Tipo | Propuesta (token + regla) | Coste |`, máximo 8, con un «antes → después» de una frase por hallazgo y una lista explícita de lo que NO se cambiará.

### Chrome y acciones compactas (implementado)

- Sidebar de **220 px** ( punto medio entre los 258 originales y los 180 que se probaron y resultaron demasiado angostos) y topbar de **48 px**. Marca en una línea a `--fs-base`, logo de 36 px, `.brand` con `gap: 8px` y `padding: 6px 6px 22px`; `.sidebar` con padding lateral 10 px. Los 180 px y los 55 px probados antes se descartaron: demasiado angosta / demasiado alta.
- `.nav-item` se ve como **botón**: fondo `rgba(var(--overlay-rgb), 0.05)` y `border: 1px solid var(--box-border)`; el activo conserva `--nav-active-bg`. La topbar usa `--bg` para integrarse con el contenido y no parecer una franja alta. Las tarjetas contrastan por **luminosidad** (`--card-*-rgb` más claro en claro), **sin franjas superiores**: se probó y se rechazó. Solo se tocan fondos y colores de borde derivados del acento; nunca medidas, sombras ni decoración añadida.
- En claro, sidebar y topbar usan fondo propio **más oscuro y teñido por acento** (`--sidebar-bg` por acento claro). El texto secundario de ambas zonas usa `--on-chrome-muted` para cumplir AA: 5,5–6,3:1 en claro y ≥8:1 en oscuro. Medir siempre con `getComputedStyle` + contraste, no a ojo.
- Los «+» de resultados de alimento (`.food-result-add`) son cuadrados de **32 × 32**, `border-radius: var(--radius-sm)`, `padding: 0`; antes eran píldoras circulares con mucho padding. No confundir con `.food-add-button` ni `.btn-sm`, que se dejaron intactos.
- En cada resultado, el tipo (`.food-category`) y el origen (`.badge`) llevan `margin-left: 6px`: sin ello aparecían pegados al nombre y entre sí.
- `.card-header > .row` es `flex: 0 0 auto`: cualquier fila larga ahí desborda en vertical. La fila de alérgenos (`.allergens-row`) se fuerza a `flex: 1 1 100%` y a **rejilla de 2 columnas** por debajo de 560 px. Revisar siempre `scrollWidth` frente a `clientWidth` en 390×844; la auditoría encontró también las pestañas de Hábitos, resueltas con `.tabs:not(.tabs-training)` envolviéndose en móvil.
- Las cinco vistas se mantienen montadas en `.view-slot` con `hidden`, no se desmontan al cambiar de sección: así se conservan los `useMemo` (BodyView proyecta 81×1095 días). Tiempo medido en navegador con datos de ejemplo: 27–33 ms por cambio; **pendiente de medir en Android con bóveda grande**.

### Estado de fondos por tema (implementado)

- **Base neutra + acento puntual**: los bloques finales de `styles.css` (`Base neutra + acento puntual`) sobrescriben fondos, superficies y bordes con escalas casi neutras en ambos temas. La jerarquía se construye con **luminosidad**, no con hue.
- El hue del acento aparece solo en acciones (`.btn-primary`, `--accent-hue`), elemento activo (`--nav-active-*`), foco, y lavados muy sutiles (`--wash-side/main/card` al 0,035–0,06). `--box-border` es neutro con una pizca de acento en el activo.
- **Evitar regresiones**: no teñir todas las superficies con el acento (lavado), no subir los lavados hasta fondo sólido, no reintroducir `::before` en `.nav-item.active`, no añadir franjas superiores a las tarjetas y no usar `box-shadow`.
- **Nombre visible**: la app se llama «Better Tracker» en sidebar, pantalla inicial y Acerca de. El display name de tienda sigue siendo «Better Fitness Tracker» y no se toca aquí.

### Configuración exacta (bloque final de `styles.css`, «Base neutra + acento puntual»)

Este bloque va **al final** de la hoja para sobrescribir los 9 bloques de acento con selectores `:root[data-accent]` y `:root[data-theme='light'][data-accent]`. No se tocan `--primary*` ni `--accent-hue`: el acento sigue vivo solo en acciones, activo, foco y bordes sutiles.

```css
/* Oscuro */
:root, :root[data-accent] {
  --bg: #101014;            --bg-2: #17171c;
  --surface: #1c1c22;       --surface-1: #222228;
  --surface-2: #292930;     --surface-3: #32323a;
  --surface-4: #3b3b44;     --sidebar-bg: #121216;
  --card-top-rgb: 34, 34, 40;
  --card-bottom-rgb: 26, 26, 31;
  --on-surface: #ececf0;    --on-surface-variant: #a8a8b3;
  --overlay-rgb: 255, 255, 255;
  --box-border: rgba(255, 255, 255, 0.10);
  --box-border-strong: rgba(255, 255, 255, 0.18);
  --wash-side: linear-gradient(155deg, rgba(var(--primary-rgb), 0.06), rgba(var(--side-hue-rgb), 0.03) 55%, transparent 82%);
  --wash-main: linear-gradient(115deg, rgba(var(--primary-rgb), 0.04), transparent 50%);
  --wash-card: linear-gradient(155deg, rgba(var(--primary-rgb), 0.04), transparent 55%);
  --nav-active-border: rgba(var(--primary-rgb), 0.28);
}

/* Claro */
:root[data-theme='light'], :root[data-theme='light'][data-accent] {
  --bg: #f7f7f9;            --bg-2: #f0f0f4;
  --surface: #ffffff;       --surface-1: #fbfbfd;
  --surface-2: #f3f3f7;     --surface-3: #e9e9ef;
  --surface-4: #dedee6;     --sidebar-bg: #e9e9ef;
  --card-top-rgb: 255, 255, 255;
  --card-bottom-rgb: 250, 250, 253;
  --on-surface: #1c1c24;    --on-surface-variant: #5c5c68;
  --on-chrome-muted: #3f3f4a;
  --overlay-rgb: 20, 20, 30;
  --box-border: rgba(20, 20, 30, 0.10);
  --box-border-strong: rgba(20, 20, 30, 0.18);
  --wash-side: linear-gradient(155deg, rgba(var(--primary-rgb), 0.05), rgba(var(--side-hue-rgb), 0.025) 55%, transparent 82%);
  --wash-main: linear-gradient(115deg, rgba(var(--primary-rgb), 0.035), transparent 50%);
  --wash-card: linear-gradient(155deg, rgba(var(--primary-rgb), 0.035), transparent 55%);
  --nav-active-border: rgba(var(--primary-rgb), 0.32);
}
```

Complementos de layout **ya decididos y validados** (no volver a cambiarlos sin pedirlo): sidebar 220 px, topbar 48 px con `background: var(--bg)` y `border-bottom: var(--box-border)`, `.nav-item` con `rgba(var(--overlay-rgb), 0.05)` y borde, `.food-result-add` de 32 × 32 con `padding: 0`, sin franja superior en `.card`.

Contraste medido con esta configuración: sidebar **7,9–8,6:1**, topbar **8,0–9,7:1** (WCAG AA cumplido). Si se vuelve a medir, usar `getComputedStyle` + cálculo de luminancia; no fiarse de la apariencia.

---

## 3. Propuestas frente a la tecnología de interfaces actuales

Úsalas como **catálogo de mejoras**, no como obligación. Todas deben respetar la
identidad de la app y tener fallback: Tauri usa WebView2 (Windows), WebKitGTK
(Linux) y Android WebView, que pueden ir por detrás de Chrome.

| Área | Propuesta moderna | Aplicación aquí / cautela |
| :--- | :--- | :--- |
| Tokens | Capa semántica única (`--surface-*`, `--box-border`, `--side-hue-rgb`, `--nav-active-*`) derivada del acento; `color-mix()` para estados | `color-mix()` tiene soporte desigual en WebKitGTK antiguo: los tonos complementarios se guardan como tripletas `--side-hue-rgb` por acento y se consumen con `rgba(var(--side-hue-rgb), …)`. |
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

- Revisar el diff con `data-theme="light"` / oscuro y dos acentos (`violet`, `amber`): comprobar que `--side-hue-rgb` y `--nav-active-*` cambian con el acento, que no hay `::before` en el activo y que en `light+amber` las tarjetas son ámbar (no violeta).
- Si es un cambio visual, capturar de nuevo Alimentación, Entrenamiento, Cuerpo y
  Ajustes y repetir la crítica de §2b; comprobar que no hay `box-shadow` nuevo
  (`grep -n 'box-shadow' src/styles.css`) y que el paint no empeora (sin radiales
  grandes ni `backdrop-filter`). Para la ejecución centrada en capturas usar la
  skill `Critica visual`.
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
