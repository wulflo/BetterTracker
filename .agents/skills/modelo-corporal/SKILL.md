---
name: Modelo corporal
description: Revisar el algoritmo de porcentaje de grasa y masa magra (bodyComposition) y el predictor integrativo de descenso de peso (projectBody, integración diaria y Monte Carlo) de Better Tracker, contrastándolo con evidencia científica actual; usar al tocar metrics.ts, bodyRange.ts, energy.ts, sus tests o docs/METODOLOGIA.md.
---

# Modelo corporal — auditoría de predicción de grasa, magra y peso

Propósito: que los cálculos de **% grasa / masa magra** y la **proyección integrativa
de peso** sigan siendo defensibles, coherentes entre sí y honestos sobre su precisión.
**Revisa y reporta**; no cambies ecuaciones ni constantes salvo petición explícita.

> Esta skill complementa a `Rendimiento y ligereza` (coste) y a `Estructure`
> (documentación). Aquí el criterio es **validez fisiológica y trazabilidad**.

---

## 1. Alcance

| Pieza | Dónde | Qué revisar |
| :--- | :--- | :--- |
| Composición puntual | `src/metrics.ts` → `bodyComposition()` | Ecuaciones, ponderación, saneado de medidas, sexo desconocido. |
| Energía | `src/energy.ts`, `src/metrics.ts` → `computeEnergyExpenditure`, `computeMacros` | BMR, PAL/NEAT, TEF, EAT, AT, TDEE. |
| Proyección | `src/bodyRange.ts` → `projectBody`, integración diaria, Monte Carlo | Partición grasa/magra, adaptación, transitorio de agua, percentiles. |
| Rangos | `src/bodyRange.ts` → `safeBmiRange`, `safeBodyFatRange`, `classifyValue` | Límites, avisos y textos bilingües. |
|Tests | `src/metrics.test.ts`, `src/bodyRange.test.ts` | Cobertura de casos límite y de coherencia panel ↔ proyección. |
| Teoría | `docs/METODOLOGIA.md`, `docs/USAGE*.md` | Que las fórmulas y citas documentadas coincidan con el código. |

---

## 2. Checklist obligatorio

### 2.1 Composición corporal

- [ ] ¿Cada ecuación (Navy/Air Force, RFM, Deurenberg, CUN-BAE, Vogel, Wright,
      Friedl, Fuchs, Brennen, Boer, DA 2023…) tiene **rango de validez** declarado
      (sexo, edad, IMC, población)? Aplicarlas fuera de ese rango es el error más común.
- [ ] ¿Se sanea cada medida antes de calcular (0/NaN/negativos → dato ausente, no cero)?
- [ ] ¿El sexo desconocido usa una constante neutra documentada en vez de «hombre» por defecto?
- [ ] ¿La agregación (pesos por varianza inversa, mediana ponderada, MAD, Huber)
      es **monótona** y no deja que una ecuación atípica domine? Comprobar con entradas extremas.
- [ ] ¿El resultado se muestra como **estimación** con aviso de incertidumbre, no como
      medición de precisión? Las ecuaciones antropométricas suelen tener error de varios
      puntos porcentuales frente a DXA.
- [ ] ¿Los textos de avisos coinciden con lo que realmente calcula el código?

### 2.2 Gasto energético

- [ ] BMR: ¿Katch-McArdle/Cunningham solo con masa magra válida y Mifflin como fallback?
- [ ] PAL/NEAT: ¿los pasos son **suelo** del NEAT, no un sumando (el PAL ya incluye caminar)?
- [ ] TEF: ¿se usa `0.10 × ingesta`? Es una simplificación: el modelo de Hall usa
      efectos específicos por macronutriente (grasa ≈ 2,5 %, proteína ≈ 25 %, carbohidrato ≈ 7,5 %).
      Señalar la divergencia si se documenta como «modelo de Hall».
- [ ] EAT: ¿MET netos y sesiones/semana coherentes con `trainingSummary`?
- [ ] AT: ¿alpha/tau y la forma exponencial están **citados**? Valores típicos de la
      literatura: τ ≈ 7 días para el inicio de la termogénesis adaptativa (Hall 2010);
      la magnitud atribuible a adaptación más allá del cambio de composición es discutida.

### 2.3 Partición y proyección

- [ ] ¿La fracción magra de la pérdida depende de la **masa grasa inicial** (Forbes),
      no de un 25 % fijo? La regla del 25 % es una simplificación criticada (Heymsfield 2014).
- [ ] ¿Se usa la forma **infinitesimal** de Forbes (`10.4/(10.4 + FM)`) para cambios
      grandes? Es la ecuación original: Hall (2007) demostró que **subestima la pérdida
      de magra** en pérdidas grandes; para déficits extremos considerar la extensión
      con Lambert W o el modelo NHANES de Thomas.
- [ ] ¿El clamp de la fracción magra (p. ej. 5–40 %, reducido con entrenamiento de
      fuerza) tiene justificación o está explícitamente marcado como heurística?
      La evidencia cualitativa va en la dirección correcta (el ejercicio ahorra magra),
      pero los números concretos son una decisión de producto, no un dato universal.
- [ ] ¿El transitorio de glucógeno/agua está acotado y no se confunde con grasa/magra real?
- [ ] ¿El integrador avanza **día a día** con el peso simulado (no con el inicial) para
      BMR, NEAT y partición?
- [ ] ¿Si el balance no empuja hacia el objetivo se evita avanzar (no se «fuerza» la pérdida)?
- [ ] Monte Carlo: ¿número de escenarios, percentiles (5–95 para intervalo 90 %) y
      perturbaciones documentados? ¿Se aplican al integrador, no solo al resultado final?
- [ ] ¿La proyección y el panel muestran la **misma** energía y composición inicial?
      Un desajuste aquí es el bug más frecuente tras un refactor.

### 2.4 Tests y verificación

- [ ] Casos límite: peso/altura/edad faltantes, sexo `other`, FM muy baja y muy alta,
      proyecciones de 4–52 semanas, déficit nulo o positivo en modo `cut`.
- [ ] Coherencia: `computeEnergyExpenditure` del panel vs. primer día del integrador.
- [ ] Sensibilidad: una pequeña variación de la ingesta debe cambiar la fecha de llegada
      de forma suave (sin saltos bruscos por clamping).
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` y, si toca Rust, `cargo test`.

---

## 3. Fuentes de referencia (contraste externo)

| Fuente | Hallazgo relevante |
| :--- | :--- |
| Forbes 1987, *Nutr Rev*; Forbes 2000 | Curva FFM = 10.4·ln(FM) + 14.2; fracción magra de un cambio infinitesimal = 10.4/(10.4 + FM). |
| Hall 2007, *Br J Nutr* (PMC2376748) | Extensión a cambios macroscópicos (Lambert W); la ecuación original subestima la magra perdida en pérdidas grandes. |
| Hall 2010, *Am J Physiol Endocrinol Metab* (PMC2838532) | Modelo integrativo de 8 EDO; τ de adaptación ≈ 7 días; TEF por macronutriente; sin ajuste de parámetros salvo condiciones iniciales. |
| Heymsfield et al. 2014, *Obes Rev* (PMC3970209) | Crítica a la regla «25 % FFM»; el ejercicio reduce la fracción magra perdida (0.27 → 0.13–0.17). |
| Thomas et al. 2014, *AJCN* (PMC4135489) | La adaptación metabólica sube el peso final pero no explica el momento del plateau; la adherencia intermitente importa más. |
| Falkenhain et al. 2025, *Eur J Clin Nutr* (PMC12041307) | Gran parte de la caída de gasto tras perder peso se explica por cambios de composición, no por adaptación «misteriosa». |
| Estudio Navy/DXA 2025 y revisiones 2024–2026 | El método de cintas antropométricas tiene sesgo individual importante; sirve para tendencias, no para diagnóstico preciso. |

**Regla:** cualquier cambio de constantes (α, τ, C de Forbes, MET, clamps) debe citar
fuente y actualizar `docs/METODOLOGIA.md` en el mismo diff.

---

## 4. Formato del informe

| Hallazgo | Evidencia (`archivo:línea`) | Fuente / supuesto | Impacto | Propuesta |
| :--- | :--- | :--- | :--- | :--- |

Clasifica cada hallazgo como **sólido**, **heurística documentada** o **riesgo**.
No propongas cambiar una ecuación solo porque «sea más moderna»: exige que el cambio
mejore la coherencia panel ↔ proyección o esté respaldado por datos humanos.

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Composición y ecuaciones | `src/metrics.ts` (`bodyComposition`) |
| Energía compartida | `src/energy.ts` |
| Proyección e integrador | `src/bodyRange.ts` (`projectBody`, integración, Monte Carlo) |
| Tests | `src/metrics.test.ts`, `src/bodyRange.test.ts` |
| Teoría y fuentes | `docs/METODOLOGIA.md`, `docs/USAGE.md`, `docs/USAGE.en.md` |
| Índice técnico | `docs/Estructure.md` (§3, §4, §9) |
