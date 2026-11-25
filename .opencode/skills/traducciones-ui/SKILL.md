---
name: Traducciones UI
description: Asegurar que las opciones de interfaz y configuración de Better Tracker tengan traducción al inglés y al español (idiomas soportados); usar al añadir textos nuevos, al revisar Ajustes o al cambiar controles y diffs de UI.
---

# Traducciones UI — ES ↔ EN

Propósito: que **ningún** texto visible de la interfaz o de los ajustes quede solo en un idioma.
Los idiomas soportados son `es` y `en` (el inglés es el predeterminado al instalar),
gestionados en `src/i18n.tsx`.

## Checklist obligatorio

1. **Texto que usa el diccionario**
   - Todo texto visible lleva una clave en `DICT.es` y `DICT.en` de `src/i18n.tsx`,
     y se lee con `t(key, lang)` desde `useLanguage()`.
   - No dejar claves solo en español: `t()` cae al español por defecto, así que una
     clave ausente en `en` se verá en español con el idioma cambiado.

2. **Texto generado en TSX**
   - Usar `tx(lang, "Español", "English")` para frases cortas y literales en
     componentes (`App.tsx`, `*View.tsx`, `components/*.tsx`) en lugar de literales fijos.
   - Para contadores y formatos usar `plural(lang, n, one, many)`,
     `formatNumber(value, lang, decimals)` y `locale(lang)` (fechas y números).
   - Las unidades (`kg`, `kcal`, `min`, `%`) se mantienen, pero las etiquetas y los
     tooltips/`title`/`aria-label` también se traducen.

3. **Auditoría de una vista/panel**
   - Buscar literales sin envolver en los `.tsx` de la zona:
     `grep -nE '"[^"]*[áéíóúñÁÉÍÓÚÑ][^"]*"' src/`.
   - Comprobar que cada clave usada con `t()` existe en **los dos** diccionarios.
   - Probar la app con `localStorage.setItem("bt.lang","en")` y `"es"` y recorrer la
     pantalla: no debe quedar texto del otro idioma (salvo nombres propios o datos del usuario).

4. **Si se cambia el mecanismo o se añade un idioma**
   - Actualizar el tipo `Lang`, `DICT`, `t()`, `tx()`, `locale()`, `plural()` y
     `LanguageProvider` en `src/i18n.tsx`.
   - Actualizar esta skill y la guía de uso (skill `Guía de uso`).

## Verificación final

- `npx tsc --noEmit` y `npm test`.
- Recorrer con el idioma cambiado la vista afectada y, como mínimo, Ajustes.
- Si el cambio afecta a símbolos documentados, actualizar `docs/Estructure.md` (skill `Estructure`).

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Diccionarios, `t()`, `tx()`, `plural()`, `formatNumber()` | `src/i18n.tsx` |
| Preferencia guardada | `localStorage["bt.lang"]` (`es|en`, defecto `en`) |
| Guías de usuario | `docs/USAGE.md`, `docs/USAGE.en.md` |
