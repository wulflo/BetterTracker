---
name: Alimentos locales
description: Verificar que los alimentos guardados en la base local de Better Tracker cumplan el formato de Food y tengan macros reales y coherentes (no marcadores de relleno); usar al revisar foodDb.ts, food.saved, la búsqueda de alimentos o los datos del catálogo de códigos.
---

# Alimentos locales — formato y macros reales

Propósito: que un alimento de la base local sirva para **contabilizar macros de
verdad**, no solo para rellenar la interfaz. **Revisa y reporta**; no cambies
datos ni código salvo petición explícita.

> Complementa a `Buscador seguro` (origen de los datos) y a `Saneado de texto`.

---

## 1. Alcance

| Pieza | Dónde | Qué revisar |
| :--- | :--- | :--- |
| Tipo | `src/types.ts` (`Food`, `FoodPer100`, `BarcodeProduct`) | Campos obligatorios y opcionales. |
| Base fija | `src/foodDb.ts` (`FOODS`, `ROWS`, `foodUnits`, `calcFood`) | Forma de las filas, unidades y cálculo. |
| Guardados | `src/vault.ts` (`food.saved`), `PanelView.createFood` | Evento escrito y leído igual. |
| Catálogo offline | `src/barcodeCatalog.ts`, `src/data/barcodeCatalog.json` | Tuplas `[código, nombre, categoría, país]`. |
| Remotos cacheados | `src-tauri/src/barcode.rs` (`product_for_barcode`) | Conversión de Open Food Facts a `Food`. |

---

## 2. Formato

- [ ] `id` presente, no vacío y estable: `custom-<uuid>` para manuales,
      `off-<código>` para los venidos de Open Food Facts.
- [ ] `name` no vacío tras `trim()`; sin etiquetas HTML ni saltos de línea
      en alimentos creados desde un campo de una sola línea.
- [ ] `category` pertenece a `FoodCategory` (no un string arbitrario).
- [ ] `per100` tiene los cinco campos numéricos: `kcal`, `protein`, `carbs`,
      `fat`, `fiber`; finitos y ≥ 0.
- [ ] `units` es un mapa de gramos/ml por unidad; `unitGrams > 0` cuando se use
      una unidad distinta de `g`/`ml`.
- [ ] Opcionales coherentes: `barcode` solo dígitos (6–14), `source` conocido
      (`openfoodfacts`, `manual`), `quantityLabel`/`servingLabel` texto o `null`.
- [ ] El evento `food.saved` guarda el mismo objeto que luego lee `reduceCustomFoods`.

---

## 3. Macros reales (no relleno)

- [ ] **Coherencia energética**: `4·proteína + 4·carbohidratos + 9·grasa`
      debe acercarse a `kcal` (tolerancia ≈ ±25 %; la fibra y el alcohol pueden
      explicar desviaciones). Si `kcal` es 0 pero los macros no, o al revés,
      se marca como dato sospechoso.
- [ ] **No marcadores**: descartar alimentos con los cinco macros a 0 y un
      `kcal` inventado, o con valores exactamente repetidos en muchos alimentos
      (sospecha de plantilla genérica por categoría).
- [ ] **Límites plausibles** por 100 g: kcal ≤ ~900, proteína/carbos/grasa ≤ 100,
      fibra ≤ carbohidratos, todo ≥ 0.
- [ ] **Procedencia verificable**: los productos `source=openfoodfacts` deben
      traer código y haber convertido energía de kJ cuando hacía falta
      (`energy_100g / 4,184`).
- [ ] **Macros por categoría**: el catálogo offline de barras usa estimaciones
      por categoría; está bien como orientación, pero debe avisarse en la UI
      y no mezclarse con datos de etiqueta sin distinción.
- [ ] **Duplicados**: mismo código de barras con nombres distintos, o mismo
      nombre y macros distintos, se reportan antes de fiarse de uno.

---

## 4. Verificación

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npm test    # foodDb.test.ts cubre filas, unidades, GTIN y búsqueda
```

Revisión manual: abrir Ajustes → Bóveda, localizar un `food.saved` y comparar
su `per100` con la etiqueta del envase. Probar `calcFood` con 100 g y con una
unidad para ver que el factor es correcto.

---

## 5. Formato del informe

| Alimento | Problema | Evidencia (`archivo:línea` o id) | Riesgo | Propuesta |
| :--- | :--- | :--- | :--- | :--- |

Clasifica cada hallazgo como **bloqueante** (formato inválido, macros imposibles),
**sospechoso** (plantilla genérica, energía incoherente) o **informativo**. Si
no hay hallazgos, dilo explícitamente.

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Tipo `Food` | `src/types.ts` |
| Base fija y cálculo | `src/foodDb.ts` (`FOODS`, `calcFood`, `foodUnits`) |
| Eventos guardados | `src/vault.ts`, `src/PanelView.tsx` (`createFood`) |
| Conversión OFF | `src-tauri/src/barcode.rs` (`product_for_barcode`) |
| Catálogo offline | `src/barcodeCatalog.ts` |
