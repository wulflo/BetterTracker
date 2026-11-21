import { describe, expect, it } from 'vitest';
import type { BodyComposition } from './metrics';
import { computeMacros } from './metrics';
import type { BodyMeasures } from './types';
import { classifyValue, formatProjectionDuration, projectBody, safeBmiRange, safeBodyFatRange } from './bodyRange';

const BODY: BodyMeasures = {
  sex: 'male',
  age: 30,
  weight: 90,
  height: 180,
  neck: 39,
  chest: 104,
  waist: 92,
  abdomen: 95,
  hip: 100,
  arm: 34,
  forearm: 27,
  thigh: 58,
  calf: 39,
  wrist: 17,
};

const MUSCULAR: BodyComposition = {
  methods: [],
  avg: 16,
  min: 16,
  max: 16,
  bmi: 27.78,
  fatMass: 14.4,
  leanMass: 75.6,
  whr: null,
  whtr: null,
  bmrMifflin: null,
  bmrKatch: null,
  bmrCunningham: null,
  tdee: null,
  missing: [],
  used: [],
  confidence: 80,
  coverage: 80,
  ffmi: 75.6 / 1.8 ** 2,
  normalizedFfmi: 75.6 / 1.8 ** 2,
  ffmiStatus: 'operational',
  militaryStandard: { whtr: null, whtrBand: null, ageGroup: '28–39', fatLimit: 26, fatLow: 18, fatOk: null, pass: false },
  muscularOverride: false,
} as never as BodyComposition;

describe('rangos corporales seguros', () => {
  it('usa el rango de IMC de la OMS en adultos', () => {
    expect(safeBmiRange(30)).toMatchObject({ min: 18.5, max: 24.9 });
    expect(safeBmiRange(70)).toMatchObject({ min: 22, max: 27 });
  });

  it('adapta el porcentaje de grasa por sexo y edad', () => {
    expect(safeBodyFatRange('male', 30)).toMatchObject({ min: 8, max: 19 });
    expect(safeBodyFatRange('female', 45)).toMatchObject({ min: 23, max: 34 });
    expect(safeBodyFatRange('unspecified', 30)).toBeNull();
  });

  it('clasifica valores por debajo, dentro y por encima', () => {
    const range = safeBmiRange(30);
    expect(classifyValue(17, range).status).toBe('low');
    expect(classifyValue(22, range).status).toBe('safe');
    expect(classifyValue(31, range).status).toBe('high');
    expect(classifyValue(null, range).status).toBe('unknown');
  });

  it('recalcula el objetivo desde la composición y no lo limita al IMC', () => {
    const projection = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12);
    expect(projection.available).toBe(true);
    expect(projection.targetSource).toBe('composition');
    expect(projection.targetWeight).not.toBeNull();
    expect(projection.targetFatMass).not.toBeNull();
    expect(projection.targetLeanMass).not.toBeNull();
    expect(projection.targetLeanMass!).toBeCloseTo(75.6, 1);
    expect(projection.targetFatMass!).toBeCloseTo(10.3, 1);
    expect(projection.targetWeight!).toBeCloseTo(85.91, 1);
    expect(projection.targetBmi!).toBeGreaterThan(24.9);
    expect(projection.note).toContain('masa magra');
    expect(projection.milestones).toHaveLength(4);
    expect(projection.targetReached).toBe(true);
    expect(projection.trajectory.at(-1)!.tissueWeight).toBeLessThanOrEqual(projection.targetWeight! + 0.01);
  });

  it('usa la fuerza mensual para conservar masa magra y ajustar el ritmo', () => {
    const trained = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12);
    const untrained = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 0);
    expect(trained.targetLeanMass!).toBeGreaterThan(untrained.targetLeanMass!);
    expect(trained.targetWeight!).toBeGreaterThan(untrained.targetWeight!);
    expect(trained.weeks!).toBeLessThan(untrained.weeks!);
    expect(trained.strengthPerMonth).toBe(12);
    expect(untrained.note).toContain('pérdida de masa magra');
  });

  it('usa los pasos medios para ajustar el gasto y las fechas futuras', () => {
    const low = projectBody(BODY, 'cut', 0, 'sedentary', MUSCULAR, 'es', 12, 3000);
    const high = projectBody(BODY, 'cut', 0, 'sedentary', MUSCULAR, 'es', 12, 12000);
    expect(high.note).toContain('12000 pasos/día');
    expect(high.milestones).toHaveLength(4);
    expect(high.targetWeight!).not.toBeNull();
  });

  it('sin composición usa el IMC como respaldo y lo limita al rango', () => {
    const projection = projectBody(
      { ...BODY, sex: 'unspecified', neck: 0, waist: 0, abdomen: 0, hip: 0, arm: 0, forearm: 0, thigh: 0, wrist: 0 },
      'cut',
      180,
    );
    expect(projection.targetSource).toBe('bmi');
    expect(projection.targetBmi).not.toBeNull();
    expect(projection.targetBmi!).toBeGreaterThanOrEqual(18.5);
    expect(projection.targetBmi!).toBeLessThanOrEqual(24.9);
    expect(projection.note).toContain('solo con el IMC');
  });

  it('no proyecta una pérdida que en realidad suba de peso', () => {
    const projection = projectBody({ ...BODY, weight: 70, waist: 95, neck: 38 }, 'cut', 180);
    expect(projection.targetWeight).not.toBeNull();
    expect(projection.targetWeight!).toBeLessThanOrEqual(70);
  });

  it('marca como inseguro seguir perdiendo con IMC bajo', () => {
    const projection = projectBody({ ...BODY, weight: 58 }, 'cut', 180);
    expect(projection.safe).toBe(false);
    expect(projection.message).toContain('límite bajo');
  });

  it('mantiene avisos y mensajes cuando faltan datos', () => {
    const projection = projectBody({ ...BODY, weight: 0 }, 'maintain', 0);
    expect(projection.available).toBe(false);
    expect(projection.targetWeight).toBeNull();
    expect(projection.milestones).toEqual([]);
  });

  it('en mantenimiento no inventa una fecha de llegada', () => {
    const projection = projectBody(BODY, 'maintain', 180, 'moderate');
    expect(projection.available).toBe(true);
    expect(projection.weeks).toBe(0);
    expect(projection.etaDate).toBeNull();
    expect(projection.message).toContain('mantienes el peso');
  });

  it('en mantenimiento mantiene visible una trayectoria plana', () => {
    const projection = projectBody(BODY, 'maintain', 180, 'moderate');
    expect(projection.trajectory.length).toBeGreaterThan(1);
    expect(projection.targetReached).toBe(true);
    const tissue = projection.trajectory.map((point) => point.tissueWeight);
    expect(Math.max(...tissue) - Math.min(...tissue)).toBeLessThan(0.01);
    expect(projection.trajectory.at(-1)!.tissueWeight).toBeCloseTo(BODY.weight, 1);
  });

  it('usa la ingesta media real y refleja el tamaño del déficit', () => {
    const moderate = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12, 0, {
      avgIntakeKcal: 2400,
      intakeSource: 'manual',
    });
    const aggressive = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12, 0, {
      avgIntakeKcal: 1900,
      intakeSource: 'manual',
    });

    expect(moderate.intakeSource).toBe('manual');
    expect(aggressive.deficitPct!).toBeLessThan(moderate.deficitPct!);
    expect(aggressive.note).toContain('1900 kcal');
    expect(moderate.note).toContain('2400 kcal');
  });

  it('distingue la ingesta registrada de la manual', () => {
    const logged = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12, 0, {
      avgIntakeKcal: 2200,
      intakeSource: 'logged',
    });
    expect(logged.intakeSource).toBe('logged');
    expect(logged.avgIntakeKcal).toBe(2200);
    expect(logged.note).toContain('registros recientes');
  });

  it('no avanza si el balance no empuja hacia el objetivo', () => {
    let intake = 5400;
    let projection = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12, 0, {
      avgIntakeKcal: intake,
      intakeSource: 'manual',
    });
    while ((projection.weeks ?? 0) > 0 && intake < 8000) {
      intake += 50;
      projection = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12, 0, {
        avgIntakeKcal: intake,
        intakeSource: 'manual',
      });
    }

    expect(projection.weeks).toBe(0);
    expect(projection.targetReached).toBe(false);
    expect(projection.etaDate).toBeNull();
    expect(projection.message).toContain('no hay déficit');
    // Sin déficit la proyección no avanza, pero la trayectoria plana se
    // conserva para que la tabla y la curva sigan visibles.
    expect(projection.trajectory.length).toBeGreaterThan(1);
    expect(projection.trajectory.at(-1)!.tissueWeight).toBeCloseTo(BODY.weight, 1);
  });
  it('avisa y limita el ritmo cuando el déficit es agresivo', () => {
    const projection = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12, 0, {
      avgIntakeKcal: 1200,
      intakeSource: 'manual',
    });

    expect(projection.rateCapped).toBe(true);
    // Tope con fuerza completa: 0,75 % + 0,25 % del peso por semana. El ritmo
    // debe ser semanal (no diario): con 90 kg, ≈0,9 kg/semana.
    expect(projection.weeklyRateKg).toBeLessThanOrEqual(BODY.weight * 0.01 + 1e-6);
    expect(projection.weeklyRateKg).toBeGreaterThan(BODY.weight * 0.005);
    expect(projection.warnings.length).toBeGreaterThanOrEqual(3);
    const warnings = projection.warnings.join(' ');
    expect(warnings).toMatch(/gasto basal/);
    expect(warnings).toMatch(/30 %|30%/);
    expect(warnings).toMatch(/ritmo seguro/);
  });

  it('no avisa de ingesta bajo la TMB si está por encima', () => {
    const macros = computeMacros(BODY, 180, 'cut', 'moderate', 'es')!;
    const projection = projectBody(BODY, 'cut', 180, 'moderate', MUSCULAR, 'es', 12, 0, {
      avgIntakeKcal: macros.bmr + 100,
      intakeSource: 'manual',
    });

    expect(projection.warnings.join(' ')).not.toMatch(/gasto basal/);
  });

  it('expresa proyecciones largas en años', () => {
    expect(formatProjectionDuration(5, 'es')).toBe('5 semana(s)');
    expect(formatProjectionDuration(20, 'es')).toBe('5 meses');
    expect(formatProjectionDuration(130, 'es')).toBe('2,5 años');
    expect(formatProjectionDuration(130, 'en')).toBe('2.5 years');
  });

  it('baja el ritmo al final porque el gasto cae con el peso', () => {
    const heavy: BodyMeasures = {
      ...BODY,
      weight: 120,
      neck: 0,
      chest: 0,
      waist: 0,
      abdomen: 0,
      hip: 0,
      arm: 0,
      forearm: 0,
      thigh: 0,
      calf: 0,
      wrist: 0,
    };
    const projection = projectBody(heavy, 'cut', 180, 'moderate', undefined, 'es', 12, 0, {
      avgIntakeKcal: 2600,
      intakeSource: 'manual',
    });

    expect(projection.targetReached).toBe(true);
    expect(projection.weeks!).toBeGreaterThan(20);
    // La tasa de pérdida no es constante: al bajar el peso el gasto disminuye
    // y los últimos cambios de peso son más pequeños que los primeros.
    const weights = projection.trajectory.map((t) => t.scaleWeight);
    const first = Math.abs(weights[1] - weights[0]);
    const last = Math.abs(weights.at(-1)! - weights.at(-2)!);
    expect(last).toBeLessThan(first);
    expect(projection.finalWeeklyRateKg).toBeLessThanOrEqual(projection.weeklyRateKg + 0.05);
  });
});
