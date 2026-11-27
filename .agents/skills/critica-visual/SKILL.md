---
name: Crítica visual
description: Criticar la interfaz de Better Tracker a partir de capturas reales (escritorio y Android) y proponer mejoras visuales concretas y jerarquizadas sin sombras externas ni box-shadow, conservando ligereza y los tokens de tema. Usar cuando la app se percuda plana, monótona, saturada de acento o con poco ritmo visual, y antes de aplicar cambios de estilo.
---

# Crítica visual — Better Tracker

Propósito: **decir la verdad sobre cómo se ve la app** y proponer cambios que aumenten jerarquía, ritmo y carácter sin romper la identidad ni el rendimiento. Complementa `estilo-ui` (consistencia de controles y accesibilidad) y `rendimiento-ligereza` (coste de paint).

> Regla de oro: **el acento es un adorno, no un fondo**. Los fondos son neutros con variaciones de hue muy leves; el acento aparece en acciones, foco, activos y una capa de lavado. Nunca `box-shadow` con desenfoque ni sombras externas: se prohíben.

---

## 1. Proceso

1. Abrir la app en el navegador de la sesión (`http://localhost:1420`) o en el Tauri desktop.
2. Capturar **al menos** cuatro vistas: Alimentación, Entrenamiento, Cuerpo y Ajustes → Apariencia. Repetir con `data-theme="dark"+violet` y `data-theme="light"+amber`.
3. Mirar también una captura de Android (390×844) si hay una disponible en la conversación.
4. Para cada captura responder: ¿qué se ve primero?, ¿qué parece importante?, ¿hay ritmo o todo está al mismo nivel?, ¿dónde descansa la vista?
5. Leer `src/styles.css` y anotar qué token explica cada problema (no proponer colores hex sueltos).
6. Entregar máximo **8 hallazgos** ordenados por impacto visual, separando **bloqueantes** (jerarquía/contraste) de **mejoras**.

---

## 2. Dimensiones a criticar

| Dimensión | Pregunta | Señal de monotonía |
| :--- | :--- | :--- |
| Jerarquía | ¿El título, la métrica y la acción principal se distinguen sin leer? | Todo del mismo peso; botones primarios compitiendo. |
| Ritmo | ¿Hay pares claros de densidad/alto entre tarjetas, filas y secciones? | Todas las tarjetas con el mismo padding y borde. |
| Color | ¿El acento tiñe fondos o solo señala? | Fondos vaporosos del color del acento en todas partes. |
| Superficies | ¿Hay variación de hue sutil entre zonas (barra lateral, cabecera, tarjetas, panel)? | Un único gris/violeta plano en toda la pantalla. |
| Degradados | ¿Hay degradados lineales suaves que den profundidad sin sombra? | Solo `background` sólido; o degradados radiales grandes y caros. |
| Datos | ¿Números y unidades se leen de un vistazo (`tabular-nums`, tamaño, color)? | Cifras pequeñas y del mismo color que la explicación. |
| Microinteracciones | ¿Hay estados hover/active/focus discretos y redondeados? | Sin feedback o feedback que rompe el radio. |
| Respiración | ¿Hay zonas vacías intencionadas? | Todo apretado o todo con la misma separación. |

---

## 3. Catálogo de mejoras permitidas (listo para aplicar)

1. **Token de lavado por sección**: `--wash-side` ya usa dos tonos — `rgba(var(--primary-rgb), 0.18)` → `rgba(var(--side-hue-rgb), 0.12)` → transparente. `--side-hue-rgb` es el complemento por acento; `--wash-main`/`--wash-card` siguen en 0.05–0.08 con ángulos distintos.
2. **Borde superior de tarjeta**: `background-image: linear-gradient(90deg, rgba(var(--primary-rgb),0.5), rgba(var(--primary-rgb),0.05) 40%, transparent)` en una franja de 2 px con `background-size: 100% 2px; background-repeat: no-repeat` — da identidad sin sombra.
3. **Énfasis de cifra**: clase `.stat-value` con `font-size: var(--fs-3xl)`, `font-variant-numeric: tabular-nums`, color `--on-surface`; la unidad en `--on-surface-variant` y `--fs-sm`.
4. **Cabeceras de sección**: `letter-spacing: 0.02em; font-weight: 700` y una pequeña barra de acento de 3 px en `::before`, sin borde completo.
5. **Elemento activo**: usar `--nav-active-bg`/`--nav-active-border`/`--nav-icon-active` (más fuertes en claro). **No hay franja `::before` tipo `border-left`** ni borde inferior; el label activo va en `font-weight: 700`.
6. **Iconos de sección**: chips de 34 px con `rgba(var(--primary-rgb), 0.075)`, `:nth-child(2n)` con `rgba(var(--side-hue-rgb), 0.09)` y activo con `--nav-icon-active`; sin sombra.
7. **Alternancia de filas**: en listas largas, `background: rgba(var(--surface-2), 0.5)` en pares; coste de paint nulo.
8. **Acento secundario para datos**: usar `--tertiary`/`--info`/`--success` con moderación en chips de estado, nunca en fondos grandes.
9. **Movimiento**: solo `transform`/`opacity`, 120–200 ms y `prefers-reduced-motion: reduce`; sin animar `box-shadow`, `width` ni `height`.

**Base neutra + acento puntual**: fondos y superficies casi neutros en claro y oscuro; jerarquía por luminosidad. El hue del acento solo en acciones, activo, foco y bordes sutiles; lavados al 0,035–0,06. Prohibido teñir toda la UI con el acento, franjas superiores en tarjetas y `box-shadow`. Sidebar 220 px, topbar integrada con `--bg`, nav en forma de botón, título «Better Tracker» en una línea. Solo se tocan colores de fondo y borde.

**Valores exactos (tokens, gradientes y contrastes medidos)**: ver `.agents/skills/estilo-ui/SKILL.md` → «Configuración exacta (bloque final de `styles.css`)». No reescribir la paleta desde cero: partir de ese bloque. En claro, sidebar es neutra un paso más oscura que el contenido y `--on-chrome-muted` mantiene ≥5,5:1; en oscuro ≥8:1. Los «+» de alimentos son cuadrados de 32 px sin padding; tipo y origen llevan `margin-left: 6px`. En móvil, la fila de alérgenos va en 2 columnas y las pestañas largas envuelven: verificar siempre `scrollWidth <= clientWidth` en 390×844.

**Prohibido**: `box-shadow` con desenfoque, `filter: blur()`, `backdrop-filter`, degradados radiales grandes que cubran toda la pantalla, hex fijos en componentes, fuentes menores de 11 px y estados que dependan solo del color.

---

## 4. Formato del informe

| # | Hallazgo | Evidencia (captura / `styles.css:línea`) | Tipo | Propuesta (token + regla) | Coste |
| :-- | :-- | :-- | :-- | :-- | :-- |

Terminar con una **propuesta de antes/después en una sola frase** por hallazgo y una lista de lo que NO se cambiará. Si el usuario pide aplicar, editar solo `src/styles.css` (y `src/theme.tsx` si hace falta un token), verificar con `npm run build`, `npx tsc --noEmit`, `npm test` y una nueva captura en los dos temas y los dos acentos.
