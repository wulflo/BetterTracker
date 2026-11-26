---
name: Traducciones UI
description: Asegurar que todo el texto visible de Better Tracker (interfaz, ajustes y contenido de dominio como recetas recomendadas, alimentos, zonas o hábitos) tenga traducción al inglés y al español; usar al añadir textos nuevos, al revisar traducciones o diffs de UI/datos, y al tocar catálogos localizados.
---

# Traducciones UI — ES ↔ EN

Propósito: que **ningún** texto visible de la app quede solo en un idioma. Esto
incluye tanto la interfaz y los ajustes como el **contenido de dominio** que se
muestra en las vistas: recetas recomendadas (nombre, descripción, ciencia y
etiquetas), nombres de alimentos, zonas, actividad, hábitos, ánimo, etc.
Los idiomas soportados son `es` y `en` (el inglés es el predeterminado al
instalar), gestionados en `src/i18n.tsx`.

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

3. **Contenido de dominio y catálogos (no solo la UI)**
   - Los textos que viven en módulos de datos no se traducen con `tx()`: se
     localizan mediante mapas `*_EN` y funciones `localized*`. Revisar siempre
     que **cada registro** tenga su equivalente en inglés, no solo los primeros:
     `RECIPE_EN`/`localizedRecipe` (`src/recipes.ts`), `FOOD_NAMES_EN`/
     `localizedFoodName` (`src/data/foodNames.en.ts`), `ZONE_EN` (`src/zones.ts`),
     `ACTIVITY_EN` (`src/metrics.ts`), `DAY_LABELS_EN`/`MOOD_FACES_EN`
     (`src/wellness.ts`, `src/dates.ts`), `UNIT_LABELS_EN` y etiquetas de
     `foodDb.ts`, y `ALLERGEN_LABELS` (`src/recipes.ts`).
   - Probar que `recommendRecipes(..., 'en', ...)` y las funciones `localized*`
     devuelven texto en inglés para **todos** los registros, no un subconjunto.
   - Rechazar traducciones mecánicas o mixtas: no vale `Bowl de chicken`,
     `... fibra de verdura and grasa ...` ni dejar la descripción en español.
     La traducción debe ser inglés natural (nombre, descripción, `science` y
     `tags`), además de coherente con el original español (mismos ingredientes
     y la misma idea).
   - Si se añaden recetas/alimentos/zonas nuevos, añadir su entrada EN en el
     mismo cambio y una aserción de cobertura total en el test correspondiente
     (`src/recipes.test.ts`, etc.).

4. **Auditoría de una vista/panel**
   - Buscar literales sin envolver en los `.tsx` de la zona:
     `grep -nE '"[^"]*[áéíóúñÁÉÍÓÚÑ][^"]*"' src/` (y la variante con comillas
     simples para literales en módulos TS).
   - Comprobar que cada clave usada con `t()` existe en **los dos** diccionarios
     y que cada registro de los mapas `*_EN` existe en su catálogo ES.
   - Probar la app con `localStorage.setItem("bt.lang","en")` y `"es"` y recorrer
     la pantalla: no debe quedar texto del otro idioma (salvo nombres propios o
     datos del usuario).

5. **Si se cambia el mecanismo o se añade un idioma**
   - Actualizar el tipo `Lang`, `DICT`, `t()`, `tx()`, `locale()`, `plural()` y
     `LanguageProvider` en `src/i18n.tsx`, además de las funciones `localized*`.
   - Actualizar esta skill y la guía de uso (skill `Guía de uso`).

## Verificación final

- `npx tsc --noEmit` y `npm test` (incluidos los tests de cobertura de las
  traducciones de recetas y catálogos).
- Recorrer con el idioma cambiado la vista afectada y, como mínimo, Ajustes **y
  Panel → Recetas** (las tarjetas muestran nombre, descripción y "Por qué"/
  "Why" desde los datos localizados).
- Si el cambio afecta a símbolos documentados, actualizar `docs/Estructure.md`
  (skill `Estructure`).

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Diccionarios, `t()`, `tx()`, `plural()`, `formatNumber()` | `src/i18n.tsx` |
| Recetas y su traducción | `src/recipes.ts` (`RECIPE_EN`, `localizedRecipe`), `src/recipes.test.ts` |
| Nombres de alimentos | `src/data/foodNames.en.ts`, `src/foodDb.ts` |
| Zonas, actividad, hábitos, ánimo y fechas | `src/zones.ts`, `src/metrics.ts`, `src/wellness.ts`, `src/dates.ts` |
| Preferencia guardada | `localStorage["bt.lang"]` (`es|en`, defecto `en`) |
| Guías de usuario | `docs/USAGE.md`, `docs/USAGE.en.md` |
