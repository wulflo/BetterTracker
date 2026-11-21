/**
 * Rangos corporales seguros y proyección de progreso.
 *
 * Los rangos no se piden al usuario: se deducen del sexo y la edad de la última
 * medida. Sirven como referencia orientativa, no como diagnóstico. La
 * proyección usa el déficit/superávit calculado con `computeMacros` y el gasto
 * estimado, y se limita a ritmos respaldados por la literatura (≈0,5–1 % del
 * peso por semana al perder grasa y ≈0,25–0,5 % al ganar).
 */
import type { Lang } from './i18n';
import { tx } from './i18n';
import type { ActivityLevel, BodyMeasures, GoalMode, Sex } from './types';
import {
  addDays,
  activityBaseFactor,
  bmrMifflin,
  bodyComposition,
  clamp,
  computeEnergyExpenditure,
  computeMacros,
  trainingEatKcalPerDay,
  trainingSummary,
  todayISO,
  type BodyComposition,
  type EnergyBreakdown,
  type TrainingSummary,
} from './metrics';

export interface SafeRange {
  min: number;
  max: number;
  label: string;
  note: string;
}

export interface RangeStatus {
  value: number | null;
  status: 'low' | 'safe' | 'high' | 'unknown';
  label: string;
  color: 'info' | 'success' | 'warn' | 'error' | 'muted';
}

export interface ProjectionTrajectoryPoint {
  date: string;
  fatMass: number;
  leanMass: number;
  ffmi: number | null;
  /** Peso en báscula: tejido + agua intracelular transitoria. */
  scaleWeight: number;
  /** Peso de tejido (grasa + masa magra). */
  tissueWeight: number;
  /** Peso de agua intracelular transitoria. */
  waterWeight: number;
}

export interface ProjectionMilestone {
  date: string;
  weight: number;
  bodyFat: number | null;
  fatMass: number | null;
  leanMass: number | null;
  /** Percentil 5 del peso en báscula (intervalo de predicción del 90 %). */
  weightLow: number;
  /** Percentil 95 del peso en báscula. */
  weightHigh: number;
  /** Percentil 5 de la fecha de llegada. */
  dateLow: string;
  /** Percentil 95 de la fecha de llegada. */
  dateHigh: string;
}

export type ProjectionTargetSource = 'composition' | 'bmi' | 'maintain' | 'none';

export type IntakeSource = 'manual' | 'logged' | 'target';

export interface ProjectionOptions {
  /**
   * Ingesta media real. Si falta o es 0, la proyección usa el objetivo de
   * calorías calculado con `computeMacros`.
   */
  avgIntakeKcal?: number;
  /** Origen del dato para explicarlo en la interfaz. */
  intakeSource?: Exclude<IntakeSource, 'target'>;
  /** Resumen de entrenamiento reciente (proyección energética y fuerza). */
  summary?: TrainingSummary;
  /** Frecuencia de entrenamiento declarada (por semana). */
  declaredPerWeek?: number | null;
}

export interface BodyProjection {
  available: boolean;
  direction: 'lose' | 'gain' | 'maintain';
  targetWeight: number | null;
  targetBodyFat: number | null;
  targetBmi: number | null;
  /** Masa grasa que corresponde al peso objetivo. */
  targetFatMass: number | null;
  /** Masa magra que se espera conservar o ganar hasta el objetivo. */
  targetLeanMass: number | null;
  /** De dónde sale el peso objetivo: composición, IMC o mantenimiento. */
  targetSource: ProjectionTargetSource;
  /** Sesiones de fuerza al mes usadas en el cálculo. */
  strengthPerMonth: number;
  weeklyRateKg: number;
  /** Ritmo al final de la simulación: baja si el peso cambia el gasto. */
  finalWeeklyRateKg: number;
  dailyKcalDelta: number;
  /** Déficit/superávit como porcentaje del gasto (negativo = déficit). */
  deficitPct: number | null;
  /** Ingesta media usada en el balance. */
  avgIntakeKcal: number | null;
  intakeSource: IntakeSource;
  /** El balance se recortó al máximo semanal seguro para el peso. */
  rateCapped: boolean;
  weeks: number | null;
  etaDate: string | null;
  targetReached: boolean;
  safe: boolean;
  message: string;
  /** Explica el objetivo por composición y el efecto de la fuerza. */
  note: string;
  /** Avisos de seguridad del balance, además del rango de IMC. */
  warnings: string[];
  milestones: ProjectionMilestone[];
  /** Desglose del gasto del primer día (BMR, TEF, NEAT, EAT). */
  dailyBreakdown: EnergyBreakdown;
  /** Extremo bajo realista del peso final (peso en báscula). */
  weightLow: number | null;
  /** Extremo alto realista del peso final (peso en báscula). */
  weightHigh: number | null;
  /** Evolución proyectada de grasa, masa magra, FFMI y peso en báscula. */
  trajectory: ProjectionTrajectoryPoint[];
  /** Termogénesis adaptativa final de la simulación (kcal/día). */
  adaptiveThermogenesis: number;
}
/** ≈3 sesiones de fuerza por semana: estímulo completo para conservar masa magra. */
export const STRENGTH_SESSIONS_PER_MONTH_FULL = 12;

/** 0 sin fuerza registrada, 1 con ≥12 sesiones al mes. */
export function strengthFactor(perMonth: number): number {
  if (!Number.isFinite(perMonth) || perMonth <= 0) return 0;
  return clamp(perMonth / STRENGTH_SESSIONS_PER_MONTH_FULL, 0, 1);
}

/**
 * Duración legible para la proyección. Las proyecciones largas se muestran en
 * meses o años: "130 semanas" no dice nada, "2,5 años" sí.
 */
export function formatProjectionDuration(weeks: number, lang: Lang = 'es'): string {
  const total = Math.max(1, Math.round(weeks));
  if (total >= 52) {
    const rounded = Math.round((total / 52) * 10) / 10;
    const text = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(1).replace('.', lang === 'en' ? '.' : ',');
    return tx(lang, `${text} años`, `${text} years`);
  }
  if (total >= 12) {
    const months = Math.max(1, Math.round(total / (52 / 12)));
    return tx(lang, `${months} meses`, `${months} months`);
  }
  return tx(lang, `${total} semana(s)`, `${total} week(s)`);
}

/** IMC saludable. En mayores de 65 se acepta un margen algo mayor (22–27). */
export function safeBmiRange(age: number, lang: Lang = 'es'): SafeRange {
  if (age >= 65) {
    return {
      min: 22,
      max: 27,
      label: tx(lang, 'IMC orientativo 22,0–27,0', 'Reference BMI 22.0–27.0'),
      note: tx(
        lang,
        'En personas mayores, un IMC ligeramente superior se asocia a menor pérdida de masa muscular.',
        'In older people, a slightly higher BMI is associated with less muscle mass loss.',
      ),
    };
  }
  if (age > 0 && age < 18) {
    return {
      min: 18.5,
      max: 24.9,
      label: tx(lang, 'IMC orientativo 18,5–24,9', 'Reference BMI 18.5–24.9'),
      note: tx(
        lang,
        'En menores de edad el IMC debe interpretarse con percentiles pediátricos.',
        'In minors, BMI should be interpreted using pediatric percentiles.',
      ),
    };
  }
  return {
    min: 18.5,
    max: 24.9,
    label: tx(lang, 'IMC saludable 18,5–24,9', 'Healthy BMI 18.5–24.9'),
    note: tx(
      lang,
      'Rango de la OMS para adultos; no distingue grasa de músculo.',
      'WHO range for adults; it does not distinguish fat from muscle.',
    ),
  };
}

/**
 * Porcentaje de grasa orientativo por sexo y edad. Los mínimos son valores
 * esenciales/atletas y los máximos, el límite saludable aproximado.
 */
export function safeBodyFatRange(sex: Sex, age: number, lang: Lang = 'es'): SafeRange | null {
  if (sex === 'unspecified') return null;
  if (sex === 'male') {
    if (age >= 60) {
      return {
        min: 13,
        max: 24,
        label: tx(lang, '% grasa 13–24', 'Body fat 13–24%'),
        note: tx(lang, 'Referencia para hombres de 60 años o más.', 'Reference for men aged 60 and over.'),
      };
    }
    if (age >= 40) {
      return {
        min: 11,
        max: 22,
        label: tx(lang, '% grasa 11–22', 'Body fat 11–22%'),
        note: tx(lang, 'Referencia para hombres de 40–59 años.', 'Reference for men aged 40–59.'),
      };
    }
    return {
      min: 8,
      max: 19,
      label: tx(lang, '% grasa 8–19', 'Body fat 8–19%'),
      note: tx(lang, 'Referencia para hombres de 20–39 años.', 'Reference for men aged 20–39.'),
    };
  }
  if (age >= 60) {
    return {
      min: 24,
      max: 35,
      label: tx(lang, '% grasa 24–35', 'Body fat 24–35%'),
      note: tx(lang, 'Referencia para mujeres de 60 años o más.', 'Reference for women aged 60 and over.'),
    };
  }
  if (age >= 40) {
    return {
      min: 23,
      max: 34,
      label: tx(lang, '% grasa 23–34', 'Body fat 23–34%'),
      note: tx(lang, 'Referencia para mujeres de 40–59 años.', 'Reference for women aged 40–59.'),
    };
  }
  return {
    min: 21,
    max: 32,
    label: tx(lang, '% grasa 21–32', 'Body fat 21–32%'),
    note: tx(lang, 'Referencia para mujeres de 20–39 años.', 'Reference for women aged 20–39.'),
  };
}

export function classifyValue(
  value: number | null,
  range: SafeRange | null,
  lang: Lang = 'es',
): RangeStatus {
  if (value === null || !Number.isFinite(value) || !range) {
    return {
      value,
      status: 'unknown',
      label: tx(lang, 'Sin datos suficientes', 'Not enough data'),
      color: 'muted',
    };
  }
  if (value < range.min) {
    return {
      value,
      status: 'low',
      label: tx(lang, 'Por debajo del rango', 'Below range'),
      color: 'info',
    };
  }
  if (value > range.max) {
    return {
      value,
      status: 'high',
      label: tx(lang, 'Por encima del rango', 'Above range'),
      color: 'warn',
    };
  }
  return {
    value,
    status: 'safe',
    label: tx(lang, 'Dentro del rango', 'Within range'),
    color: 'success',
  };
}

function targetBodyFat(goal: GoalMode, sex: Sex, range: SafeRange | null): number | null {
  if (!range) return null;
  if (goal === 'cut') {
    // Zona media-baja del rango saludable, sin llegar a valores de competición.
    return sex === 'male' ? Math.max(range.min + 2, 12) : Math.max(range.min + 3, 22);
  }
  if (goal === 'bulk') {
    // Zona media-alta: margen para ganar músculo sin acumular grasa en exceso.
    return sex === 'male' ? Math.min(range.max - 1, 18) : Math.min(range.max - 1, 28);
  }
  return range.min + (range.max - range.min) / 2;
}

function shiftDate(days: number): string {
  return todayISO(addDays(new Date(), Math.max(0, Math.round(days))));
}

/* ------------------------------------------------------------------ */
/* Integrador fisiológico diario de dos compartimentos                */
/* (Kevin Hall / NIDDK + curva de Forbes)                              */
/* ------------------------------------------------------------------ */

/** Energía kcal/kg de grasa libra: ≈9400 kcal/kg. */
const RHO_FAT_KCAL_KG = 9400;
/** Energía kcal/kg de masa libre de grasa: ≈1800 kcal/kg. */
const RHO_LEAN_KCAL_KG = 1800;
/** Cap de transitorio de glucógeno/agua (kg). */
const WATER_MAX_KG = 1.8;
/** Escala del transitorio de glucógeno/agua por kcal de ingesta frente al mantenimiento inicial. */
const WATER_SCALE_PER_KG = 0.010;
/** α: 11 % del desbalance energético que se refleja en la termogénesis adaptativa. */
const ADAPT_ALPHA = 0.11;
/** τ: 18 días de constante de la termogénesis adaptativa. */
const ADAPT_TAU_DAYS = 18;
/** Longitud máxima de la simulación del balance energético. */
const MAX_PROJECTION_DAYS = 1095;
/**
 * Horizonte plano cuando no hay cambio de tejido (mantenimiento o balance que
 * no empuja al objetivo). Mantiene visibles la tabla y la curva en la UI.
 */
const FLAT_PROJECTION_DAYS = 84;
/** Mínimo de pérdida de masa magra con fuerza frecuente en déficit (≈5–10 %). */
const STRENGTH_MIN_LEAN = 0.075;

interface IntegrationInputs {
  m: BodyMeasures;
  comp: BodyComposition;
  goal: GoalMode;
  strengthPerMonth: number;
  avgSteps: number;
  intakeKcal: number;
  activityLevel: ActivityLevel | null;
  lang: Lang;
  now: Date;
  targetWeight: number | null;
  summary?: TrainingSummary;
  declaredPerWeek?: number | null;
  /** Desviación de la ingesta (fracción): manual/objetivo ≈10 %, registrada ≈6 %. */
  intakeSd: number;
  /** Transitorio máximo de glucógeno/agua (kg, con signo). */
  waterMax: number;
}

/**
 * Parámetros de una simulación de incertidumbre. El escenario central es todo
 * 1 (y agua 0); los demás se muestrean con la incertidumbre publicada de cada
 * componente (BMR, PAL/NEAT, ingesta, adaptación y partición Forbes).
 */
interface ProjectionVariant {
  bmrScale: number;
  neatScale: number;
  intakeScale: number;
  atScale: number;
  partitionScale: number;
  waterOffset: number;
}

interface ScenarioTrajectory {
  points: ProjectionTrajectoryPoint[];
  pointDays: number[];
}

const CENTRAL_VARIANT: ProjectionVariant = {
  bmrScale: 1,
  neatScale: 1,
  intakeScale: 1,
  atScale: 1,
  partitionScale: 1,
  waterOffset: 0,
};

interface IntegrationResult {
  points: ProjectionTrajectoryPoint[];
  /** Día (0 = hoy) de cada punto de `points`. */
  pointDays: number[];
  /** Trayectoria del percentil 5 (extremo de pérdida rápida). */
  bandLowPoints: ProjectionTrajectoryPoint[];
  /** Trayectoria del percentil 95 (extremo de pérdida lenta). */
  bandHighPoints: ProjectionTrajectoryPoint[];
  /** Trayectorias Monte Carlo completas, para percentiles de fechas. */
  scenarios: ScenarioTrajectory[];
  final: { scaleWeight: number; tissueWeight: number; fatMass: number; leanMass: number };
  weeklyRateKg: number;
  finalWeeklyRateKg: number;
  days: number;
  reached: boolean;
  rateCapped: boolean;
  /** AT final de la simulación (termogénesis adaptativa, kcal/día). */
  finalAt: number;
}

function strengthEffect(strengthPerMonth: number): number {
  return clamp(strengthPerMonth / 12, 0, 1);
}

/** BMR dinámico: promedio entre Katch-McArdle/Cunningham y Mifflin-St Jeor. */
function dynamicBmr(m: BodyMeasures, lean: number): number {
  if (lean > 0) {
    return (370 + 21.6 * lean + 500 + 22 * lean) / 2;
  }
  return bmrMifflin(m.weight > 0 ? m.weight : 70, m.height > 0 ? m.height : 170, m.age > 0 ? m.age : 30, m.sex);
}

/**
 * Gasto neto de caminar: ≈0,45 kcal por kg y por 1000 pasos. Equivale a
 * ≈0,5 kcal/kg/km con 1000 pasos ≈ 0,75 km, el valor habitual en la
 * literatura. Se calcula con el peso simulado de cada día.
 */
function walkingKcalPerDay(avgSteps: number, weight: number): number {
  return avgSteps > 0 ? (avgSteps / 1000) * 0.45 * (weight > 0 ? weight : 70) : 0;
}

/** Transitorio de glucógeno/agua tras un cambio de ingesta vs mantenimiento inicial (bounded ±1,8 kg). */
function waterTransient(waterMax: number, day: number): number {
  return waterMax * (1 - Math.exp(-Math.max(0, day) / 4));
}

function interpPoint(points: ProjectionTrajectoryPoint[], day: number): ProjectionTrajectoryPoint {
  if (!points.length) {
    return { date: '', fatMass: 0, leanMass: 0, ffmi: null, scaleWeight: 0, tissueWeight: 0, waterWeight: 0 };
  }
  const idx = clamp(day / 7, 0, points.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(points.length - 1, lo + 1);
  const f = idx - lo;
  const a = points[lo];
  const b = points[hi];
  return {
    date: a.date,
    fatMass: a.fatMass + (b.fatMass - a.fatMass) * f,
    leanMass: a.leanMass + (b.leanMass - a.leanMass) * f,
    ffmi: a.ffmi !== null && b.ffmi !== null ? a.ffmi + (b.ffmi - a.ffmi) * f : null,
    scaleWeight: a.scaleWeight + (b.scaleWeight - a.scaleWeight) * f,
    tissueWeight: a.tissueWeight + (b.tissueWeight - a.tissueWeight) * f,
    waterWeight: a.waterWeight + (b.waterWeight - a.waterWeight) * f,
  };
}

type IntegrationCoreResult = Omit<
  IntegrationResult,
  'bandLowPoints' | 'bandHighPoints' | 'scenarios'
>;

/** PRNG determinista (mulberry32): los mismos escenarios en cada render. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Incertidumbre de cada componente (≈intervalo del 90 %):
 * - BMR: ±10 % (SEE de Mifflin/Cunningham ≈ 5–10 %).
 * - PAL/NEAT: ±12 % (variabilidad de las categorías FAO/OMS).
 * - Ingesta: ±10 % manual/objetivo y ±6 % registrada.
 * - Termogénesis adaptativa: α con ±50 %.
 * - Partición Forbes: ±20 %.
 * - Agua: ±1,5 kg.
 */
function sampleVariant(rand: () => number, intakeSd: number): ProjectionVariant {
  return {
    bmrScale: clamp(1 + randomNormal(rand) * 0.06, 0.85, 1.15),
    neatScale: clamp(1 + randomNormal(rand) * 0.075, 0.8, 1.2),
    intakeScale: clamp(1 + randomNormal(rand) * intakeSd, 0.7, 1.3),
    atScale: clamp(1 + randomNormal(rand) * 0.3, 0.2, 1.8),
    partitionScale: clamp(1 + randomNormal(rand) * 0.1, 0.7, 1.3),
    waterOffset: clamp(randomNormal(rand) * 0.75, -2, 2),
  };
}

function integrateOnce(
  inputs: IntegrationInputs,
  variant: ProjectionVariant,
  options: { maxDays: number; stopAtTarget: boolean },
): IntegrationCoreResult {
  const m = inputs.m;
  const weight0 = m.weight > 0 ? m.weight : 0;
  const heightM = m.height > 0 ? m.height / 100 : 1.7;
  const summary = inputs.summary ?? trainingSummary([], []);
  const intake = inputs.intakeKcal * variant.intakeScale;
  const fat0 = inputs.comp.fatMass ?? (weight0 > 0 ? 0.2 * weight0 : 0);
  const lean0 = inputs.comp.leanMass ?? Math.max(0, weight0 - fat0);
  const maxDays = Math.max(0, options.maxDays);
  // El EAT es lineal en el peso: se precalcula una vez por trayectoria.
  const eatPerKg = trainingEatKcalPerDay(summary, inputs.declaredPerWeek ?? null, 1);

  const points: ProjectionTrajectoryPoint[] = [];
  const pointDays: number[] = [];
  const push = (F: number, L: number, day: number) => {
    const water = clamp(
      waterTransient(inputs.waterMax, day) + variant.waterOffset,
      -WATER_MAX_KG * 1.25,
      WATER_MAX_KG * 1.25,
    );
    points.push({
      date: todayISO(addDays(inputs.now, day)),
      fatMass: Math.max(0, F),
      leanMass: Math.max(0, L),
      ffmi: L > 0 && heightM > 0 ? L / (heightM ** 2) : null,
      scaleWeight: Math.max(0, F + L + water),
      tissueWeight: Math.max(0, F + L),
      waterWeight: water,
    });
    pointDays.push(day);
  };

  let F = Math.max(0, fat0);
  let L = Math.max(0, lean0);
  let at = 0;
  push(F, L, 0);

  const deltas: number[] = [];
  let weeklyRateKg = 0;
  let finalWeeklyRateKg = 0;
  // En mantenimiento el objetivo ya es el peso actual: se considera alcanzado.
  let reached = inputs.goal === 'maintain';
  let rateCapped = false;
  let days = 0;
  let prevTissue = F + L;

  if (maxDays > 0) {
    const effect = strengthEffect(inputs.strengthPerMonth);
    // Tope de ritmo seguro según peso y fuerza. Es una regla de seguridad, no
    // una fuente de incertidumbre: se mantiene fija en todos los escenarios.
    const rateCap =
      inputs.goal === 'cut'
        ? weight0 * (0.0075 + 0.0025 * effect)
        : weight0 * (0.0025 + 0.0025 * effect);

    for (let day = 1; day <= maxDays; day += 1) {
      const W = F + L;
      const baseBmr = dynamicBmr(m, L);
      const B = baseBmr * variant.bmrScale;
      // NEAT = max(PAL sin ejercicio, pasos). No se suman: el PAL ya incluye
      // caminar, así que los pasos actúan como suelo cuando implican más
      // actividad que el nivel declarado.
      const activityNeat =
        (activityBaseFactor(inputs.activityLevel) - 1) * baseBmr * variant.neatScale;
      const stepNeat = walkingKcalPerDay(inputs.avgSteps, W) * variant.neatScale;
      const neat = Math.max(activityNeat, stepNeat);
      const tef = 0.10 * intake;
      const eat = eatPerKg * W;
      const deltaE = intake - (B + tef + neat + eat - at);
      // Si el balance no empuja hacia el objetivo (sin superávit en déficit o
      // sin déficit en volumen), la proyección no avanza.
      if (
        (inputs.goal === 'cut' && deltaE >= 0) ||
        (inputs.goal === 'bulk' && deltaE <= 0)
      ) {
        break;
      }
      // Termogénesis adaptativa: ΔE → AT exponencialmente (α ≈ 11 %, τ = 18 días).
      at = at + (ADAPT_ALPHA * variant.atScale * deltaE - at) / ADAPT_TAU_DAYS;

      // Partición grasa/magra: curva de Forbes. La fracción magra es
      // 10,4/(F+10,4), no 10,4/F; el tope evita perder masa magra en exceso
      // cuando la grasa disponible es baja.
      const pForbes = 10.4 / (Math.max(F, 1) + 10.4);
      const surplus = Math.max(0, deltaE);
      const deficit = Math.min(0, deltaE);
      let dL = 0;
      let dF = 0;
      if (surplus > 0) {
        // Superávit: la ganancia de masa magra escala con el estímulo de fuerza
        // (hasta ~45–55 % del excedente entrenado; ~20–25 % sin fuerza).
        const pLeanGain = clamp(
          (inputs.strengthPerMonth > 0 ? 0.5 : 0.25) * variant.partitionScale,
          0.1,
          0.7,
        );
        const denominator = pLeanGain * RHO_LEAN_KCAL_KG + (1 - pLeanGain) * RHO_FAT_KCAL_KG;
        const weightChange = surplus / denominator;
        dL = pLeanGain * weightChange;
        dF = (1 - pLeanGain) * weightChange;
      } else if (deficit < 0) {
        // Déficit: la fracción de pérdida que es magra se reduce con la fuerza
        // frecuente hasta un mínimo fisiológico (≈5–10 %), dirigiendo el
        // 90–95 % del déficit a la grasa libra.
        const pLean =
          inputs.strengthPerMonth >= 12
            ? STRENGTH_MIN_LEAN
            : clamp(pForbes * variant.partitionScale, 0.05, 0.4);
        const denominator = (1 - pLean) * RHO_FAT_KCAL_KG + pLean * RHO_LEAN_KCAL_KG;
        const weightChange = -deficit / denominator;
        dF = -(1 - pLean) * weightChange;
        dL = -pLean * weightChange;
      }
      // Tope de ritmo: limitamos el cambio semanal de peso a la ventana
      // segura del peso y la fuerza (definición: 0,75 % + 0,25 % por semana
      // con fuerza completa; volumen: 0,25 % + 0,25 %).
      const movement = Math.abs(dF + dL);
      const dailyCap = rateCap / 7;
      if (movement > dailyCap) {
        const factor = dailyCap / movement;
        dF *= factor;
        dL *= factor;
        rateCapped = true;
      }
      F = Math.max(0, F + dF);
      L = Math.max(0, L + dL);
      if (F + L <= 0.5) break;

      const delta = F + L - prevTissue;
      prevTissue = F + L;
      deltas.push(delta);
      if (deltas.length > 7) deltas.shift();
      // Los deltas son diarios; el ritmo que se muestra y se compara con el
      // tope seguro es semanal (×7).
      const dailyRate = Math.abs(deltas.reduce((a, b) => a + b, 0) / deltas.length);
      if (day === 7) weeklyRateKg = dailyRate * 7;
      finalWeeklyRateKg = dailyRate * 7;

      if (options.stopAtTarget && inputs.targetWeight !== null) {
        const want = inputs.goal === 'cut' ? inputs.targetWeight + 0.001 : inputs.targetWeight - 0.001;
        if ((inputs.goal === 'cut' && F + L <= want) || (inputs.goal === 'bulk' && F + L >= want)) {
          reached = true;
          // El último punto de la trayectoria es el día de llegada.
          push(F, L, day);
          days = day;
          break;
        }
      }
      if (day % 7 === 0 || day === maxDays) push(F, L, day);
      days = day;
    }
  }

  // Sin progreso (mantenimiento o balance que no empuja al objetivo): se
  // proyecta el peso actual en plano para que la tabla y la curva sigan
  // visibles y expliquen que no habrá cambio de tejido. `days` se mantiene en
  // 0 para no convertir un mantenimiento en una proyección con fecha de llegada.
  if (points.length < 2) {
    const fillTo = maxDays > 0 ? maxDays : FLAT_PROJECTION_DAYS;
    for (let day = 7; day <= fillTo; day += 7) push(F, L, day);
    if (pointDays[pointDays.length - 1] < fillTo) push(F, L, fillTo);
  } else if (!options.stopAtTarget && pointDays[pointDays.length - 1] < maxDays) {
    // Escenarios de incertidumbre: se completa el horizonte en plano para
    // poder comparar todos los percentiles en la misma fecha.
    const lastDay = pointDays[pointDays.length - 1];
    for (let day = lastDay + 7; day <= maxDays; day += 7) push(F, L, day);
    if (pointDays[pointDays.length - 1] < maxDays) push(F, L, maxDays);
  }

  const last = points[points.length - 1];
  return {
    points,
    pointDays,
    final: {
      scaleWeight: last ? last.scaleWeight : weight0,
      tissueWeight: last ? last.tissueWeight : F + L,
      fatMass: last ? last.fatMass : F,
      leanMass: last ? last.leanMass : L,
    },
    weeklyRateKg,
    finalWeeklyRateKg,
    days,
    reached,
    rateCapped,
    finalAt: at,
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Peso de una trayectoria en un día concreto (interpolación lineal). */
function weightAtDay(
  points: ProjectionTrajectoryPoint[],
  pointDays: number[],
  day: number,
): number {
  if (!points.length) return 0;
  if (day <= pointDays[0]) return points[0].scaleWeight;
  const last = points.length - 1;
  if (day >= pointDays[last]) return points[last].scaleWeight;
  let lo = 0;
  while (lo < last && pointDays[lo + 1] < day) lo += 1;
  const hi = Math.min(last, lo + 1);
  const span = pointDays[hi] - pointDays[lo];
  const f = span > 0 ? (day - pointDays[lo]) / span : 0;
  return points[lo].scaleWeight + (points[hi].scaleWeight - points[lo].scaleWeight) * f;
}

/**
 * Simulador fisiológico diario (dt = 1 día) de dos compartimentos
 * (Hall/Forbes + termogénesis adaptativa). La banda es un intervalo de
 * predicción del 90 % (percentiles 5–95) obtenido con Monte Carlo sobre las
 * incertidumbres publicadas de BMR, PAL/NEAT, ingesta, adaptación, partición
 * y agua. Los escenarios no se detienen en el objetivo: así el intervalo
 * describe el peso esperado en la fecha central y no colapsa a un punto.
 */
const UNCERTAINTY_SCENARIOS = 81;

function runProjectionIntegration(inputs: IntegrationInputs): IntegrationResult {
  const mainMaxDays = inputs.goal === 'maintain' ? 0 : MAX_PROJECTION_DAYS;
  const main = integrateOnce(inputs, CENTRAL_VARIANT, {
    maxDays: mainMaxDays,
    stopAtTarget: true,
  });
  // Los escenarios se simulan hasta el horizonte máximo para poder calcular
  // fechas de llegada lentas; los pesos se muestrean en la fecha central.
  const scenarioMaxDays =
    inputs.goal === 'maintain' ? FLAT_PROJECTION_DAYS : MAX_PROJECTION_DAYS;
  const scenarios: IntegrationCoreResult[] = [];
  const rand = mulberry32(0x9e3779b9);
  for (let index = 0; index < UNCERTAINTY_SCENARIOS; index += 1) {
    scenarios.push(
      integrateOnce(inputs, sampleVariant(rand, inputs.intakeSd), {
        maxDays: scenarioMaxDays,
        stopAtTarget: false,
      }),
    );
  }

  const bandPoints = (p: number): ProjectionTrajectoryPoint[] =>
    main.points.map((point, index) => {
      const day = main.pointDays[index];
      const values = scenarios.map((scenario) =>
        weightAtDay(scenario.points, scenario.pointDays, day),
      );
      return { ...point, scaleWeight: percentile(values, p) };
    });

  return {
    ...main,
    bandLowPoints: bandPoints(0.05),
    bandHighPoints: bandPoints(0.95),
    scenarios,
  };
}

/**
 * Proyecta el progreso hacia el objetivo. Si faltan datos devuelve
 * `available: false` con un mensaje explicativo en vez de inventar cifras.
 *
 * Cuando hay composición corporal, el peso objetivo se recalcula desde la masa
 * magra y la masa grasa, no solo desde el IMC. Las sesiones de fuerza al mes
 * ajustan cuánta masa magra se conserva (definición) o se gana (volumen) y el
 * ritmo seguro de cambio de peso.
 */

/**
 * Reduce la trayectoria diaria/semanal a un número fijo de puntos representativos
 * (inicial, intermedios y final/objetivo) para que la tabla y el gráfico no
 * muestren decenas de semanas casi idénticas. El integrador sigue trabajando
 * día a día; solo se muestrea la salida expuesta a la interfaz.
 */
function sampleTrajectory(
  points: ProjectionTrajectoryPoint[],
  count = 5,
): ProjectionTrajectoryPoint[] {
  if (points.length <= count) return points.slice();
  const last = points.length - 1;
  const indices = new Set<number>();
  for (let i = 0; i < count; i++) {
    indices.add(Math.round((i * last) / (count - 1)));
  }
  indices.add(0);
  indices.add(last);
  const sorted = Array.from(indices).sort((a, b) => a - b);
  const result: ProjectionTrajectoryPoint[] = [];
  const seen = new Set<number>();
  for (const idx of sorted) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    result.push(points[idx]);
  }
  if (result.length === 0) result.push(points[0], points[last]);
  if (result[0] !== points[0]) result.unshift(points[0]);
  if (result[result.length - 1] !== points[last]) result.push(points[last]);
  return result;
}
export function projectBody(
  measures: BodyMeasures,
  goal: GoalMode,
  weeklyMinutes: number,
  activityLevel?: ActivityLevel,
  comp?: BodyComposition,
  lang: Lang = 'es',
  strengthPerMonth = 0,
  avgSteps = 0,
  options: ProjectionOptions = {},
): BodyProjection {
  const composition = comp ?? bodyComposition(measures, lang);
  const bmi = composition.bmi;
  const bmiRange = safeBmiRange(measures.age, lang);
  const fatRange = safeBodyFatRange(measures.sex, measures.age, lang);
  const declaredIntakeRaw = Number(options.avgIntakeKcal);
  const hasIntake = Number.isFinite(declaredIntakeRaw) && declaredIntakeRaw > 0;
  const declaredIntake = hasIntake ? declaredIntakeRaw : 0;
  const summary = options.summary;
  const macros = computeMacros(measures, weeklyMinutes, goal, activityLevel, lang, avgSteps, {
    summary,
    declaredPerWeek: options.declaredPerWeek ?? null,
    declaredIntake,
  });
  const strength = Number.isFinite(strengthPerMonth) ? Math.max(0, strengthPerMonth) : 0;
  const effect = strengthFactor(strength);
  const empty: BodyProjection = {
    available: false,
    direction: goal === 'cut' ? 'lose' : goal === 'bulk' ? 'gain' : 'maintain',
    targetWeight: null,
    targetBodyFat: null,
    targetBmi: null,
    targetFatMass: null,
    targetLeanMass: null,
    targetSource: 'none',
    strengthPerMonth: Math.round(strength * 10) / 10,
    weeklyRateKg: 0,
    finalWeeklyRateKg: 0,
    dailyKcalDelta: 0,
    deficitPct: null,
    avgIntakeKcal: null,
    intakeSource: 'target',
    rateCapped: false,
    weeks: null,
    etaDate: null,
    targetReached: false,
    safe: true,
    message: tx(
      lang,
      'Añade peso, altura y, si puedes, cintura para calcular una proyección.',
      'Add weight, height and, if possible, waist to calculate a projection.',
    ),
    note: '',
    warnings: [],
    milestones: [],
    dailyBreakdown: computeEnergyExpenditure(
      measures, summary ?? trainingSummary([], []), options.declaredPerWeek ?? null,
      avgSteps, activityLevel ?? null, hasIntake ? declaredIntake : 0, lang,
    ),
    weightLow: null,
    weightHigh: null,
    trajectory: [],
    adaptiveThermogenesis: 0,
  };
  if (!macros || !measures.weight || measures.weight <= 0) return empty;

  const currentBmi = bmi ?? null;
  const currentFat = composition.avg;
  const currentFatMass = composition.fatMass;
  const leanMass = composition.leanMass;
  const baseTargetFat = targetBodyFat(goal, measures.sex, fatRange);
  const intakeKcal = hasIntake ? declaredIntake : macros.kcal;
  const intakeSource: IntakeSource = hasIntake ? (options.intakeSource ?? 'manual') : 'target';
  const delta = intakeKcal - macros.tdee;
  const deficitPct = macros.tdee > 0 ? (delta / macros.tdee) * 100 : null;
  const maxBmi = bmiRange.max;
  const minBmi = bmiRange.min;

  let targetWeight: number | null = null;
  let targetFat: number | null = null;
  let targetFatMass: number | null = null;
  let targetLeanMass: number | null = null;
  let targetSource: ProjectionTargetSource = 'none';

  if (goal === 'maintain') {
    targetWeight = measures.weight;
    targetFat = currentFat;
    targetFatMass = currentFatMass;
    targetLeanMass = leanMass;
    targetSource = 'maintain';
  } else if (leanMass !== null && currentFatMass !== null && baseTargetFat !== null) {
    // Objetivo por composición: se fija la masa magra que se espera conservar
    // o ganar y se calcula la grasa necesaria para llegar al % objetivo.
    targetSource = 'composition';
    if (goal === 'cut') {
      // Sin fuerza se asume una pérdida moderada de masa magra; con ≥12
      // sesiones al mes se asume retención completa.
      targetFat = currentFat !== null ? Math.min(baseTargetFat, currentFat) : baseTargetFat;
      targetLeanMass = leanMass * (0.95 + 0.05 * effect);
    } else {
      // En volumen no se fuerza una definición encubierta: si ya se está por
      // encima del objetivo, se mantiene la grasa actual.
      const upperFat = fatRange ? fatRange.max : baseTargetFat;
      targetFat = currentFat !== null
        ? Math.max(baseTargetFat, Math.min(upperFat, currentFat))
        : baseTargetFat;
      // Hasta ~1,5 % más de masa magra con fuerza frecuente; sin fuerza, el
      // superávit se reparte peor y no se proyecta ganancia magra extra.
      targetLeanMass = leanMass * (1 + 0.015 * effect);
    }
    targetFat = Math.min(99, Math.max(1, targetFat));
    targetFatMass = targetLeanMass * (targetFat / (100 - targetFat));
    targetWeight = targetLeanMass + targetFatMass;
  } else if (currentBmi !== null && measures.height > 0) {
    // Sin composición solo queda el IMC; se limita al rango orientativo.
    targetSource = 'bmi';
    const fallbackBmi =
      goal === 'cut'
        ? Math.max(minBmi, Math.min(maxBmi, currentBmi - 1.5))
        : Math.min(maxBmi, currentBmi + 1);
    targetWeight = fallbackBmi * (measures.height / 100) ** 2;
    targetFat = baseTargetFat;
    targetFatMass = baseTargetFat !== null ? (targetWeight * baseTargetFat) / 100 : null;
    targetLeanMass = targetFatMass !== null ? targetWeight - targetFatMass : null;
  }

  // El objetivo debe ir en la dirección del modo elegido: una proyección de
  // déficit no puede terminar pesando más que hoy (y viceversa). Si la
  // composición ya no admite más cambio, se mantiene la composición actual.
  if (targetWeight !== null) {
    const previousWeight = targetWeight;
    targetWeight =
      goal === 'cut'
        ? Math.min(targetWeight, measures.weight)
        : goal === 'bulk'
          ? Math.max(targetWeight, measures.weight)
          : measures.weight;
    if (Math.abs(targetWeight - previousWeight) > 0.01) {
      targetFat = currentFat;
      targetFatMass = currentFatMass;
      targetLeanMass = leanMass;
    }
  }

  // El IMC queda como referencia, no como límite del objetivo por composición:
  // una persona con mucha masa muscular puede tener un IMC alto y poca grasa.
  const targetBmi =
    targetWeight !== null && measures.height > 0
      ? targetWeight / (measures.height / 100) ** 2
      : null;

  const dailyBreakdown = computeEnergyExpenditure(
    measures,
    summary ?? trainingSummary([], []),
    options.declaredPerWeek ?? null,
    avgSteps,
    activityLevel ?? null,
    intakeKcal,
    lang,
  );
  // Transitorio de glucógeno/agua: cambio de ingesta frente al mantenimiento
  // inicial, acotado a ±1,8 kg.
  const waterMax = clamp(
    (intakeKcal - dailyBreakdown.tdee) * WATER_SCALE_PER_KG,
    -WATER_MAX_KG,
    WATER_MAX_KG,
  );
  // La ingesta registrada con báscula es más fiable que la declarada de memoria.
  const intakeSd = intakeSource === 'logged' ? 0.06 : intakeSource === 'manual' ? 0.10 : 0.08;

  // Simulador diario de dos compartimentos (Hall/Forbes + termogénesis
  // adaptativa): el BMR y el balance energético se recalculan con el peso
  // simulado, y la partición grasa/magra sigue la curva de Forbes
  // modulada por la fuerza registrada.
  const integration = runProjectionIntegration({
    m: measures,
    comp: composition,
    goal,
    strengthPerMonth: strength,
    avgSteps,
    intakeKcal,
    activityLevel: activityLevel ?? null,
    lang,
    now: new Date(),
    targetWeight: targetWeight ?? measures.weight,
    summary,
    declaredPerWeek: options.declaredPerWeek ?? null,
    intakeSd,
    waterMax,
  });
  const horizonDays = integration.days;
  const finalWeight = integration.final.scaleWeight;
  const bandLowWeight = integration.bandLowPoints.length
    ? integration.bandLowPoints[integration.bandLowPoints.length - 1].scaleWeight
    : finalWeight;
  const bandHighWeight = integration.bandHighPoints.length
    ? integration.bandHighPoints[integration.bandHighPoints.length - 1].scaleWeight
    : finalWeight;
  const weightLow = Math.min(finalWeight, bandLowWeight, bandHighWeight);
  const weightHigh = Math.max(finalWeight, bandLowWeight, bandHighWeight);
  const weeklyRateKg = goal === 'maintain' ? 0 : integration.weeklyRateKg;
  const finalWeeklyRateKg = goal === 'maintain' ? 0 : integration.finalWeeklyRateKg;
  const weeks = goal === 'maintain' ? 0 : Math.max(0, Math.round(horizonDays / 7));
  const targetReached = integration.reached;
  const rateCapped = integration.rateCapped;

  const safe =
    (goal !== 'cut' || currentBmi === null || currentBmi > minBmi) &&
    (goal !== 'bulk' || currentBmi === null || currentBmi < maxBmi);

  const warnings: string[] = [];
  if (hasIntake && intakeKcal < macros.bmr) {
    warnings.push(
      tx(
        lang,
        `Tu ingesta media (${Math.round(intakeKcal)} kcal) está por debajo de tu gasto basal (${macros.bmr} kcal). Un déficit así no es sostenible ni seguro: sube la ingesta o consulta con un profesional.`,
        `Your average intake (${Math.round(intakeKcal)} kcal) is below your basal expenditure (${macros.bmr} kcal). A deficit like this is not sustainable or safe: increase intake or consult a professional.`,
      ),
    );
  }
  if (goal === 'cut' && deficitPct !== null && deficitPct <= -30) {
    warnings.push(
      tx(
        lang,
        `El déficit equivale al ${Math.abs(Math.round(deficitPct))} % de tu gasto. Por encima del 25–30 % suele ser difícil mantener la masa magra y la adherencia; plantea un déficit más moderado.`,
        `The deficit is ${Math.abs(Math.round(deficitPct))}% of your expenditure. Above 25–30% it is usually hard to preserve lean mass and adherence; consider a more moderate deficit.`,
      ),
    );
  }
  if (goal === 'bulk' && deficitPct !== null && deficitPct >= 20) {
    warnings.push(
      tx(
        lang,
        `El superávit equivale al ${Math.round(deficitPct)} % de tu gasto. Un superávit tan alto suele acumular grasa más rápido de lo que se gana músculo; prueba con un excedente menor.`,
        `The surplus is ${Math.round(deficitPct)}% of your expenditure. Such a high surplus usually adds fat faster than muscle; try a smaller surplus.`,
      ),
    );
  }
  if (rateCapped && weeklyRateKg > 0) {
    warnings.push(
      tx(
        lang,
        `El balance planteado supera el ritmo seguro para tu peso; la proyección se limita a ${weeklyRateKg.toFixed(2)} kg/semana (${((weeklyRateKg / measures.weight) * 100).toFixed(2)} % del peso).`,
        `The planned balance exceeds the safe rate for your weight; the projection is capped at ${weeklyRateKg.toFixed(2)} kg/week (${((weeklyRateKg / measures.weight) * 100).toFixed(2)}% of body weight).`,
      ),
    );
  }

  // Hitos: 4 puntos sobre la trayectoria de la simulación. La composición sale
  // del propio integrador (Forbes), no de una interpolación al objetivo, y la
  // banda del 90 % aporta los rangos de peso y fechas de llegada.
  const milestones: ProjectionMilestone[] = [];
  if (targetWeight !== null && horizonDays > 0) {
    const direction: 'down' | 'up' = goal === 'cut' ? 'down' : 'up';
    const steps = 4;
    for (let index = 1; index <= steps; index += 1) {
      const fraction = index / steps;
      const projectedDay = horizonDays * fraction;
      const point = interpPoint(integration.points, projectedDay);
      const pointWeight = point.scaleWeight;
      const bandAt = (points: ProjectionTrajectoryPoint[]) =>
        interpPoint(points, projectedDay).scaleWeight;
      const crossingDay = (scenario: ScenarioTrajectory): number => {
        for (let i = 0; i < scenario.points.length; i += 1) {
          const p = scenario.points[i];
          if (
            (direction === 'down' && p.scaleWeight <= pointWeight) ||
            (direction === 'up' && p.scaleWeight >= pointWeight)
          ) {
            return scenario.pointDays[i];
          }
        }
        // Si el escenario no cruza el peso en el horizonte máximo, la fecha
        // superior queda en ese límite: la app no inventa una llegada.
        return scenario.pointDays[scenario.pointDays.length - 1] ?? MAX_PROJECTION_DAYS;
      };
      const crossingDays = integration.scenarios.map(crossingDay);
      // La fecha central siempre queda dentro del intervalo del 90 %.
      const dateLow = shiftDate(Math.min(projectedDay, percentile(crossingDays, 0.05)));
      const dateHigh = shiftDate(Math.max(projectedDay, percentile(crossingDays, 0.95)));
      const tissueWeight = point.tissueWeight;
      const projectedFatMass = tissueWeight > 0 ? point.fatMass : null;
      const projectedLeanMass = tissueWeight > 0 ? point.leanMass : null;
      const projectedFat =
        tissueWeight > 0 && projectedFatMass !== null
          ? (projectedFatMass / tissueWeight) * 100
          : null;

      const bandLowAt = bandAt(integration.bandLowPoints);
      const bandHighAt = bandAt(integration.bandHighPoints);
      milestones.push({
        date: shiftDate(projectedDay),
        weight: pointWeight,
        bodyFat:
          projectedFat !== null && Number.isFinite(projectedFat) ? projectedFat : null,
        fatMass:
          projectedFatMass !== null && Number.isFinite(projectedFatMass)
            ? projectedFatMass
            : null,
        leanMass:
          projectedLeanMass !== null && Number.isFinite(projectedLeanMass)
            ? projectedLeanMass
            : null,
        weightLow: Math.min(pointWeight, bandLowAt, bandHighAt),
        weightHigh: Math.max(pointWeight, bandLowAt, bandHighAt),
        dateLow,
        dateHigh,
      });
    }
  }

  const strengthText =
    strength > 0
      ? tx(
          lang,
          `${Math.round(strength)} sesión(es) de fuerza al mes`,
          `${Math.round(strength)} strength session(s) per month`,
        )
      : tx(
          lang,
          'sin sesiones de fuerza registradas en los últimos 30 días',
          'no strength sessions logged in the last 30 days',
        );
  const stepsText =
    avgSteps > 0
      ? tx(
          lang,
          ` y ${Math.round(avgSteps)} pasos/día de media`,
          ` and an average of ${Math.round(avgSteps)} steps/day`,
        )
      : '';
  const intakeText =
    intakeSource === 'manual'
      ? tx(
          lang,
          `Ingesta media indicada: ${Math.round(intakeKcal)} kcal/día.`,
          `Declared average intake: ${Math.round(intakeKcal)} kcal/day.`,
        )
      : intakeSource === 'logged'
        ? tx(
            lang,
            `Ingesta media de tus registros recientes: ${Math.round(intakeKcal)} kcal/día.`,
            `Average intake from your recent logs: ${Math.round(intakeKcal)} kcal/day.`,
          )
        : tx(
            lang,
            `Se usa el objetivo de ${Math.round(intakeKcal)} kcal/día como ingesta; si sueles comer distinto, indica tu media.`,
            `Your target of ${Math.round(intakeKcal)} kcal/day is used as intake; if you usually eat differently, enter your average.`,
          );
  const paceText =
    weeks > 1 && finalWeeklyRateKg > 0 && finalWeeklyRateKg < weeklyRateKg * 0.95
      ? tx(
          lang,
          ` El ritmo baja a ${finalWeeklyRateKg.toFixed(2)} kg/semana al final porque el gasto disminuye con el peso.`,
          ` The pace drops to ${finalWeeklyRateKg.toFixed(2)} kg/week by the end because expenditure falls with weight.`,
        )
      : '';

  let note = '';
  if (targetSource === 'composition' && targetLeanMass !== null && targetFatMass !== null) {
    note = tx(
      lang,
      `Peso objetivo recalculado con tu composición: ${targetLeanMass.toFixed(1)} kg de masa magra y ${targetFatMass.toFixed(1)} kg de masa grasa (${targetFat?.toFixed(0) ?? '—'}% grasa). ${Math.round(weeklyMinutes)} min/semana, ${strengthText}${stepsText}; ${
        goal === 'bulk'
          ? 'se proyecta una ganancia magra moderada'
          : effect > 0
            ? 'se asume retención de masa magra'
            : 'se asume cierta pérdida de masa magra'
      }. ${intakeText}${paceText}`,
      `Target weight recalculated from your composition: ${targetLeanMass.toFixed(1)} kg lean mass and ${targetFatMass.toFixed(1)} kg fat mass (${targetFat?.toFixed(0) ?? '—'}% fat). ${Math.round(weeklyMinutes)} min/week, ${strengthText}${stepsText}; ${
        goal === 'bulk'
          ? 'a moderate lean gain is projected'
          : effect > 0
            ? 'lean mass is assumed to be preserved'
            : 'some lean mass loss is assumed'
      }. ${intakeText}${paceText}`,
    );
    if (targetBmi !== null && (targetBmi < minBmi || targetBmi > maxBmi)) {
      note += ' ' + tx(
        lang,
        `El IMC objetivo (${targetBmi.toFixed(1)}) queda fuera del rango orientativo: en personas con más masa muscular el IMC pierde precisión, así que prioriza la composición corporal.`,
        `The target BMI (${targetBmi.toFixed(1)}) is outside the reference range: BMI is less accurate in people with more muscle mass, so prioritize body composition.`,
      );
    }
  } else if (targetSource === 'bmi') {
    note = tx(
      lang,
      `Faltan medidas de composición: el peso objetivo se estima solo con el IMC y puede ser menos preciso. Añade cuello, cintura o abdomen para recalcularlo con masa magra y grasa. ${intakeText}${paceText}`,
      `Composition measurements are missing: target weight is estimated from BMI alone and may be less accurate. Add neck, waist or abdomen measurements to recalculate it from lean and fat mass. ${intakeText}${paceText}`,
    );
  } else {
    note = `${intakeText}${paceText}`;
  }

  const percentageText =
    deficitPct !== null && Math.abs(deficitPct) >= 1
      ? tx(
          lang,
          ` (${Math.abs(Math.round(deficitPct))} % de tu gasto)`,
          ` (${Math.abs(Math.round(deficitPct))}% of your expenditure)`,
        )
      : '';
  const cappedText = rateCapped
    ? tx(
        lang,
        ' El ritmo está limitado al máximo seguro para tu peso.',
        ' The pace is capped at the safe maximum for your weight.',
      )
    : '';

  let message: string;
  if (!safe) {
    message =
      goal === 'cut'
        ? tx(
            lang,
            `No se proyecta más pérdida de peso: tu IMC (${currentBmi?.toFixed(1) ?? '—'}) ya está en el límite bajo. Mantén el peso y prioriza fuerza y proteína; consulta con un profesional antes de seguir bajando.`,
            `No further weight loss is projected: your BMI (${currentBmi?.toFixed(1) ?? '—'}) is already at the lower limit. Maintain your weight and prioritize strength and protein; consult a professional before going lower.`,
          )
        : tx(
            lang,
            `No se proyecta más ganancia: tu IMC (${currentBmi?.toFixed(1) ?? '—'}) ya está en el límite alto. Mantén el peso o busca una ganancia muy lenta con supervisión.`,
            `No further gain is projected: your BMI (${currentBmi?.toFixed(1) ?? '—'}) is already at the upper limit. Maintain your weight or aim for a very slow gain under supervision.`,
          );
  } else if (goal === 'maintain') {
    message = hasIntake
      ? tx(
          lang,
          `Con una ingesta media de ${Math.round(intakeKcal)} kcal y un gasto de ${Math.round(macros.tdee)} kcal, tu balance es ${delta > 0 ? '+' : ''}${Math.round(delta)} kcal/día. Para mantener el peso, ajusta la ingesta a unas ${Math.round(macros.tdee)} kcal/día.`,
          `With an average intake of ${Math.round(intakeKcal)} kcal and an expenditure of ${Math.round(macros.tdee)} kcal, your balance is ${delta > 0 ? '+' : ''}${Math.round(delta)} kcal/day. To maintain your weight, adjust intake to about ${Math.round(macros.tdee)} kcal/day.`,
        )
      : tx(
          lang,
          `Con ${Math.round(macros.kcal)} kcal/día mantienes el peso actual. Tu TDEE estimado es ${Math.round(macros.tdee)} kcal.`,
          `With ${Math.round(macros.kcal)} kcal/day you maintain your current weight. Your estimated TDEE is ${Math.round(macros.tdee)} kcal.`,
        );
  } else if (weeks === 0) {
    if (targetWeight === null) {
      message = tx(
        lang,
        'No hay datos suficientes para fijar un peso objetivo seguro.',
        'There is not enough data to set a safe target weight.',
      );
    } else if (Math.abs(targetWeight - measures.weight) < 0.2) {
      message = tx(
        lang,
        'Ya estás en el rango objetivo: mantén el rumbo y prioriza la adherencia.',
        'You are already in the target range: stay the course and prioritize adherence.',
      );
    } else if (goal === 'cut') {
      message = tx(
        lang,
        `Con tu ingesta media de ${Math.round(intakeKcal)} kcal y un gasto de ${Math.round(macros.tdee)} kcal no hay déficit: la proyección no avanza. Reduce la ingesta o aumenta la actividad; con el objetivo de ${Math.round(macros.kcal)} kcal sí habría déficit.`,
        `With your average intake of ${Math.round(intakeKcal)} kcal and an expenditure of ${Math.round(macros.tdee)} kcal there is no deficit: the projection does not progress. Reduce intake or increase activity; with the target of ${Math.round(macros.kcal)} kcal there would be a deficit.`,
      );
    } else {
      message = tx(
        lang,
        `Con tu ingesta media de ${Math.round(intakeKcal)} kcal y un gasto de ${Math.round(macros.tdee)} kcal no hay superávit: la proyección no avanza. Aumenta la ingesta o reduce la actividad; con el objetivo de ${Math.round(macros.kcal)} kcal sí habría superávit.`,
        `With your average intake of ${Math.round(intakeKcal)} kcal and an expenditure of ${Math.round(macros.tdee)} kcal there is no surplus: the projection does not progress. Increase intake or reduce activity; with the target of ${Math.round(macros.kcal)} kcal there would be a surplus.`,
      );
    }
  } else {
    const rateText =
      lang === 'en' ? weeklyRateKg.toFixed(2) : weeklyRateKg.toFixed(2).replace('.', ',');
    const arrivalText = targetReached
      ? tx(
          lang,
          `Objetivo: ${targetWeight!.toFixed(1)} kg en ~${formatProjectionDuration(weeks, lang)}, siempre que la actividad y la ingesta se mantengan.`,
          `Target: ${targetWeight!.toFixed(1)} kg in ~${formatProjectionDuration(weeks, lang)}, as long as activity and intake stay the same.`,
        )
      : tx(
          lang,
          `El objetivo de ${targetWeight!.toFixed(1)} kg no se alcanza en el horizonte simulado con este balance; revisa la ingesta o la actividad.`,
          `The ${targetWeight!.toFixed(1)} kg target is not reached within the simulated horizon at this balance; review intake or activity.`,
        );
    message = tx(
      lang,
      `${goal === 'cut' ? 'Déficit' : 'Superávit'} de ${Math.abs(Math.round(delta))} kcal/día${percentageText} ≈ ${rateText} kg/semana. ${arrivalText}${cappedText}`,
      `${goal === 'cut' ? 'Deficit' : 'Surplus'} of ${Math.abs(Math.round(delta))} kcal/day${percentageText} ≈ ${rateText} kg/week. ${arrivalText}${cappedText}`,
    );
  }

  return {
    available: true,
    direction: goal === 'cut' ? 'lose' : goal === 'bulk' ? 'gain' : 'maintain',
    targetWeight,
    targetBodyFat: targetFat,
    targetBmi,
    targetFatMass,
    targetLeanMass,
    targetSource,
    strengthPerMonth: Math.round(strength * 10) / 10,
    weeklyRateKg,
    finalWeeklyRateKg,
    dailyKcalDelta: Math.round(intakeKcal - macros.tdee),
    deficitPct: deficitPct !== null && Number.isFinite(deficitPct) ? deficitPct : null,
    avgIntakeKcal: hasIntake ? Math.round(intakeKcal) : null,
    intakeSource,
    rateCapped,
    weeks,
    etaDate: targetReached && horizonDays > 0 ? shiftDate(horizonDays) : null,
    targetReached,
    safe,
    message,
    note,
    warnings,
    milestones,
    dailyBreakdown,
    weightLow,
    weightHigh,
    trajectory: sampleTrajectory(integration.points),
    adaptiveThermogenesis: integration.finalAt,
  };
}
