/**
 * Núcleo energético compartido por `metrics.ts` (gasto diario y macros) y
 * `bodyRange.ts` (integración día a día de la proyección). Antes estas tres
 * funciones estaban duplicadas en ambos módulos; cualquier cambio de fórmula
 * debe hacerse aquí para que el panel y la proyección no divergan.
 */
import type { BodyMeasures, Sex } from './types';

/** Gasto basal con Mifflin-St Jeor. */
export function bmrMifflin(weight: number, height: number, age: number, sex: Sex): number {
  const sexConst = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return 10 * weight + 6.25 * height - 5 * age + sexConst;
}

/**
 * BMR dinámico: con masa magra estimada promedia Katch-McArdle y
 * Cunningham; sin ella usa Mifflin-St Jeor con los valores por defecto.
 */
export function bmrDynamic(m: BodyMeasures, lean: number): number {
  const weight = m.weight > 0 ? m.weight : 70;
  if (lean > 0) {
    return (370 + 21.6 * lean + 500 + 22 * lean) / 2;
  }
  return bmrMifflin(weight, m.height > 0 ? m.height : 170, m.age > 0 ? m.age : 30, m.sex);
}

/**
 * BMR según franja de edad. Las ecuaciones de Katch/Cunningham se derivaron
 * en adultos y no incluyen edad: la app las mantiene entre 18 y 64 años, pero
 * usa ecuaciones específicas en extremos de la vida.
 *
 * - 10–17 años: Schofield 1985 (peso y sexo), válida en adolescentes.
 * - ≥65 años: Porter et al. 2023 (AJCN), modelo 6 con peso, altura, edad y
 *   sexo, original en kJ/d → kcal/d ÷ 4,184.
 *
 * Fuera de esas franjas (o con sexo/edad ausentes) se usa `bmrDynamic`.
 */
export function bmrAgeAdjusted(m: BodyMeasures, lean: number): number {
  const weight = m.weight > 0 ? m.weight : 70;
  const height = m.height > 0 ? m.height : 170;
  const age = m.age > 0 ? m.age : 30;
  if (age >= 65) {
    const kj =
      31.5239 * weight +
      25.8514 * height -
      24.4321 * age +
      486.2679 * (m.sex === 'male' ? 1 : 0) +
      530.5571;
    return kj / 4.184;
  }
  if (age < 18 && (m.sex === 'male' || m.sex === 'female')) {
    return m.sex === 'male'
      ? 17.686 * weight + 658.2
      : 13.384 * weight + 692.6;
  }
  return bmrDynamic(m, lean);
}

/** Etiqueta de la ecuación usada, para explicarla en la interfaz. */
export function bmrEquationLabel(m: BodyMeasures, lang: 'es' | 'en'): string {
  const age = m.age > 0 ? m.age : 30;
  if (age >= 65) return lang === 'es' ? 'Porter 2023 (≥65 años)' : 'Porter 2023 (65+ y)';
  if (age < 18) return lang === 'es' ? 'Schofield 1985 (10–17 años)' : 'Schofield 1985 (10–17 y)';
  return lang === 'es' ? 'Katch-McArdle / Cunningham' : 'Katch-McArdle / Cunningham';
}

/**
 * Gasto neto de caminar: ≈0,45 kcal × kg × (pasos/1000)/día
 * (≈0,5 kcal/kg/km con 1000 pasos ≈ 0,75 km). Se calcula con el peso
 * simulado de cada día en la proyección.
 */
export function walkingKcalPerDay(avgSteps: number, weight: number): number {
  return avgSteps > 0 ? (avgSteps / 1000) * 0.45 * (weight > 0 ? weight : 70) : 0;
}
