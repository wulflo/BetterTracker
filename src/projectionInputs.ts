import { useEffect, useMemo, useState } from 'react';
import type { Lang } from './i18n';
import { tx } from './i18n';
import type { VaultEvent } from './types';
import {
  averageIntakeFromEvents,
  averageStepsFromEvents,
  estimateTraining,
  loggedIntakeAverage,
  stepActivityMultiplier,
  trainingFrequencyFromEvents,
  type FrequencyUnit,
  type TrainingEstimate,
  type TrainingSummary,
} from './metrics';
import { appendEvent, newEvent } from './vault';
import { todayISO } from './metrics';

export type ProjectionIntakeSource = 'manual' | 'auto' | 'logged' | 'target';
export type IntakePriority = 'manual' | 'auto' | 'logged';
const INTAKE_PRIORITY_KEY = 'bt.intake.priority';

export interface ProjectionInputsController {
  frequencyPerWeek: number;
  frequencyUnit: FrequencyUnit;
  hasFrequency: boolean;
  setFrequencyPerWeek: (value: number) => void;
  setFrequencyUnit: (unit: FrequencyUnit) => void;
  saveFrequency: () => Promise<void>;
  steps: number;
  setSteps: (value: number) => void;
  saveSteps: () => Promise<void>;
  intakeKcal: number;
  setIntakeKcal: (value: number) => void;
  saveIntake: () => Promise<void>;
  useLoggedIntake: () => void;
  loggedIntake: { avg: number; days: number };
  effectiveIntake: number;
  intakeSource: ProjectionIntakeSource;
  intakePriority: IntakePriority;
  setIntakePriority: (value: IntakePriority) => void;
  autoIntake: AutoIntake;
  saveAutoIntake: (entry: { kcal: number; protein: number; carbs: number; fat: number; fiber: number }, forceEnabled?: boolean, date?: string) => Promise<void>;
  training: TrainingEstimate;
  stepActivity: number | null;
}

export interface AutoIntakeEntry {
  date: string;
  enabled: boolean;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface AutoIntake {
  days: number;
  avg: number;
  enabledToday: boolean;
}

/** Días con registro automático en los últimos 30 y media de kcal. */
/** Últimos registros `intake.auto` (un evento por día, el más reciente manda). */
export function autoIntakeEntries(events: VaultEvent[], today = new Date()): AutoIntakeEntry[] {
  const byDate = new Map<string, AutoIntakeEntry>();
  const chronological = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const event of chronological) {
    if (event.kind !== 'intake.auto') continue;
    const raw = event.payload as Partial<AutoIntakeEntry> | null;
    if (!raw?.date) continue;
    byDate.set(raw.date, {
      date: raw.date,
      enabled: raw.enabled !== false,
      kcal: Number.isFinite(raw.kcal) ? Math.max(0, Math.round(Number(raw.kcal))) : 0,
      protein: Number.isFinite(raw.protein) ? Math.max(0, Number(raw.protein)) : 0,
      carbs: Number.isFinite(raw.carbs) ? Math.max(0, Number(raw.carbs)) : 0,
      fat: Number.isFinite(raw.fat) ? Math.max(0, Number(raw.fat)) : 0,
      fiber: Number.isFinite(raw.fiber) ? Math.max(0, Number(raw.fiber)) : 0,
    });
  }
  const cutoff = new Date(today.getTime() - 29 * 86_400_000);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  return [...byDate.values()].filter((entry) => entry.date >= cutoffKey).sort((a, b) => b.date.localeCompare(a.date));
}

export function autoIntakeSummary(events: VaultEvent[], today = new Date()): AutoIntake {
  const byDate = new Map<string, { enabled: boolean; kcal: number }>();
  const chronological = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const event of chronological) {
    if (event.kind !== 'intake.auto') continue;
    const raw = event.payload as { date?: string; enabled?: boolean; kcal?: number } | null;
    if (!raw?.date) continue;
    byDate.set(raw.date, {
      enabled: raw.enabled !== false,
      kcal: Number.isFinite(raw.kcal) ? Math.max(0, Number(raw.kcal)) : 0,
    });
  }
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const cutoff = new Date(today.getTime() - 29 * 86_400_000);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const active = [...byDate.entries()].filter(([date, value]) => value.enabled && value.kcal > 0 && date >= cutoffKey && date <= todayKey);
  const avg = active.length ? active.reduce((sum, [, value]) => sum + value.kcal, 0) / active.length : 0;
  return { days: active.length, avg: round1(avg), enabledToday: byDate.get(todayKey)?.enabled === true };
}

interface Options {
  events: VaultEvent[];
  deviceId: string;
  onRefresh: () => Promise<void>;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  summary: TrainingSummary;
  lang: Lang;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Estado y persistencia de los datos manuales que alimentan la proyección:
 * frecuencia de entrenamiento, pasos medios e ingesta media. La proyección usa
 * los valores en borrador para previsualizar antes de guardar.
 */
export function useProjectionInputs({
  events,
  deviceId,
  onRefresh,
  notify,
  summary,
  lang,
}: Options): ProjectionInputsController {
  const storedFrequency = useMemo(() => trainingFrequencyFromEvents(events), [events]);
  const lastFrequencyEventId = useMemo(
    () => [...events].reverse().find((event) => event.kind === 'training.frequency')?.id,
    [events],
  );
  const [frequencyPerWeek, setFrequencyPerWeekState] = useState(
    storedFrequency?.perWeek ?? 0,
  );
  const [frequencyUnit, setFrequencyUnitState] = useState<FrequencyUnit>(
    storedFrequency?.unit ?? 'week',
  );
  const [hasFrequency, setHasFrequency] = useState(storedFrequency !== null);

  useEffect(() => {
    const stored = trainingFrequencyFromEvents(events);
    if (!stored) return;
    setFrequencyPerWeekState(stored.perWeek);
    setFrequencyUnitState(stored.unit);
    setHasFrequency(true);
  }, [lastFrequencyEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastStepsEventId = useMemo(
    () => [...events].reverse().find((event) => event.kind === 'steps.average')?.id,
    [events],
  );
  const [steps, setStepsState] = useState(() => averageStepsFromEvents(events));
  useEffect(() => {
    setStepsState(averageStepsFromEvents(events));
  }, [lastStepsEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastIntakeEventId = useMemo(
    () => [...events].reverse().find((event) => event.kind === 'intake.average')?.id,
    [events],
  );
  const [intakePriority, setIntakePriorityState] = useState<IntakePriority>(() => {
    const raw = localStorage.getItem(INTAKE_PRIORITY_KEY);
    return raw === 'auto' || raw === 'logged' ? raw : 'manual';
  });
  const setIntakePriority = (value: IntakePriority) => {
    setIntakePriorityState(value);
    localStorage.setItem(INTAKE_PRIORITY_KEY, value);
  };
  const [intakeKcal, setIntakeKcalState] = useState(() => averageIntakeFromEvents(events));
  useEffect(() => {
    setIntakeKcalState(averageIntakeFromEvents(events));
  }, [lastIntakeEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loggedIntake = useMemo(() => loggedIntakeAverage(events), [events]);
  const training = useMemo(
    () => estimateTraining(summary, hasFrequency ? frequencyPerWeek : null),
    [summary, hasFrequency, frequencyPerWeek],
  );
  const stepActivity = stepActivityMultiplier(steps);

  const autoIntake = useMemo(() => autoIntakeSummary(events), [events]);
  const available: Array<{ source: ProjectionIntakeSource; kcal: number }> = [
    ...(intakeKcal > 0 ? [{ source: 'manual' as const, kcal: intakeKcal }] : []),
    ...(autoIntake.days >= 5 ? [{ source: 'auto' as const, kcal: autoIntake.avg }] : []),
    ...(loggedIntake.days >= 3 ? [{ source: 'logged' as const, kcal: loggedIntake.avg }] : []),
  ];
  const ordered = [...available].sort((a, b) => {
    const rank = (source: ProjectionIntakeSource) =>
      source === intakePriority ? 0 : source === 'manual' ? 1 : source === 'auto' ? 2 : 3;
    return rank(a.source) - rank(b.source);
  });
  const effectiveIntake = ordered.length ? ordered[0].kcal : 0;
  const intakeSource: ProjectionIntakeSource = ordered.length ? ordered[0].source : 'target';

  const saveAutoIntake = async (
    entry: { kcal: number; protein: number; carbs: number; fat: number; fiber: number },
    forceEnabled?: boolean,
    date?: string,
  ) => {
    const enabled = forceEnabled ?? !autoIntake.enabledToday;
    await appendEvent(newEvent(deviceId, 'intake.auto', {
      date: date ?? todayISO(),
      enabled,
      kcal: Math.max(0, Math.round(entry.kcal)),
      protein: Math.max(0, round1(entry.protein)),
      carbs: Math.max(0, round1(entry.carbs)),
      fat: Math.max(0, round1(entry.fat)),
      fiber: Math.max(0, round1(entry.fiber)),
    }));
    await onRefresh();
    notify(
      enabled
        ? tx(lang, 'Ingesta de hoy guardada automáticamente.', "Today's intake saved automatically.")
        : tx(lang, 'Registro automático desactivado.', 'Automatic logging disabled.'),
      'info',
    );
  };

  const setFrequencyPerWeek = (value: number) => {
    setFrequencyPerWeekState(Math.max(0, value));
    setHasFrequency(true);
  };

  const setFrequencyUnit = (unit: FrequencyUnit) => {
    setFrequencyUnitState(unit);
  };

  const saveFrequency = async () => {
    const perWeek = round1(Math.max(0, frequencyPerWeek));
    setFrequencyPerWeekState(perWeek);
    setHasFrequency(true);
    await appendEvent(
      newEvent(deviceId, 'training.frequency', { perWeek, unit: frequencyUnit }),
    );
    await onRefresh();
    notify(
      tx(lang, 'Frecuencia de entrenamiento guardada.', 'Training frequency saved.'),
      'success',
    );
  };

  const setSteps = (value: number) => setStepsState(Math.max(0, value));

  const saveSteps = async () => {
    const value = Math.max(0, Math.round(Number(steps) || 0));
    setStepsState(value);
    await appendEvent(newEvent(deviceId, 'steps.average', { steps: value }));
    await onRefresh();
    notify(tx(lang, 'Pasos promedio guardados.', 'Average steps saved.'), 'success');
  };

  const setIntakeKcal = (value: number) => setIntakeKcalState(Math.max(0, value));

  const saveIntake = async () => {
    const value = Math.max(0, Math.round(Number(intakeKcal) || 0));
    setIntakeKcalState(value);
    await appendEvent(newEvent(deviceId, 'intake.average', { kcal: value }));
    await onRefresh();
    notify(
      tx(lang, 'Calorías medias guardadas.', 'Average calories saved.'),
      'success',
    );
  };

  const useLoggedIntake = () => {
    if (loggedIntake.avg > 0) setIntakeKcalState(loggedIntake.avg);
  };

  return {
    autoIntake,
    intakePriority,
    setIntakePriority,
    saveAutoIntake,
    frequencyPerWeek,
    frequencyUnit,
    hasFrequency,
    setFrequencyPerWeek,
    setFrequencyUnit,
    saveFrequency,
    steps,
    setSteps,
    saveSteps,
    intakeKcal,
    setIntakeKcal,
    saveIntake,
    useLoggedIntake,
    loggedIntake,
    effectiveIntake,
    intakeSource,
    training,
    stepActivity,
  };
}
