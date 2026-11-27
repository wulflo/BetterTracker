import Select from './components/Select';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityLevel,
  BodyMeasures,
  Exercise,
  Food,
  FoodLogItem,
  GoalMode,
  NutritionEntry,
  VaultEvent,
} from './types';
import { EMPTY_MEASURES } from './types';
import { appendEvent, newEvent } from './vault';
import { errorText } from './errors';
import {
  activityLevelFromEvents,
  activityOption,
  bodyComposition,
  computeMacros,
  computeSatiety,
  computeWaterGuidance,
  fmtDuration,
  goalModeFromEvents,
  latestMeasurement,
  latestNutrition,
  reduceWeights,
  todayISO,
  trainingSummary,
} from './metrics';
import { useProjectionInputs } from './projectionInputs';
import { ALLERGEN_LABELS, allergensFor, goalLabel, recipeLogItems, recommendRecipes, type AllergenId } from './recipes';
import { FOODS, mealGrams, mealTotals, reduceCustomFoods } from './foodDb';
import { clearMealDraft, loadMealDraft, saveMealDraft } from './meals';
import { NumberInput, Field, EmptyState, Stat } from './components/Fields';
import { Icon } from './components/Icons';
import { ProgressBar } from './components/Charts';
import FoodLog from './components/FoodLog';
import { useLanguage, tx, locale } from './i18n';
import { mealSlotLabel } from './foodDb';

interface Props {
  deviceId: string;
  events: VaultEvent[];
  exercises: Exercise[];
  onRefresh: () => Promise<void>;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

type PanelTab = 'ingesta' | 'agua' | 'recetas';

const PANEL_TABS: Array<[PanelTab, string, string]> = [
  ['ingesta', 'Ingesta', 'Intake'],
  ['agua', 'Agua', 'Water'],
  ['recetas', 'Recetas', 'Recipes'],
];

function emptyNutrition(date: string): NutritionEntry {
  return { date, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, water: 0 };
}

function emptyMacros(date: string): Pick<NutritionEntry, 'date' | 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber'> {
  return { date, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
}

export default function PanelView({ deviceId, events, exercises, onRefresh, notify }: Props) {
  const { lang } = useLanguage();
  const [tab, setTab] = useState<PanelTab>('ingesta');
  const lastMeas = latestMeasurement(events);
  const [day, setDay] = useState(() => todayISO());
  const [mealItems, setMealItems] = useState<FoodLogItem[]>(() => loadMealDraft(todayISO()));
  const [nutri, setNutri] = useState<NutritionEntry>(() => emptyNutrition(todayISO()));
  const dirtyNutrition = useRef(false);
  const [goalMode, setGoalMode] = useState<GoalMode>(() => goalModeFromEvents(events));
  const pendingGoalRef = useRef<{ id: string; mode: GoalMode } | null>(null);
  const goalWatchdogRef = useRef<number | null>(null);
  const [activity, setActivity] = useState<ActivityLevel>(() => activityLevelFromEvents(events));
  const [waterBusy, setWaterBusy] = useState(false);
  const [recipeSeed, setRecipeSeed] = useState(0);
  const [userAllergens, setUserAllergens] = useState<AllergenId[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('bt.allergens') ?? '[]');
      return Array.isArray(raw) ? raw.filter((id): id is AllergenId => id in ALLERGEN_LABELS) : [];
    } catch { return []; }
  });
  const waterSaving = useRef(false);
  const waterGenRef = useRef(0);
  const autoWriteRef = useRef('');
  const autoWritePendingRef = useRef('');

  // La bóveda se carga de forma asíncrona al abrir la app. Sin este efecto,
  // el modo elegido se quedaba en "mantener" hasta el siguiente clic.
  useEffect(() => {
    const pending = pendingGoalRef.current;
    if (pending && events.some((event) => event.id === pending.id)) {
      setGoalMode(pending.mode);
      pendingGoalRef.current = null;
      if (goalWatchdogRef.current !== null) window.clearTimeout(goalWatchdogRef.current);
    } else if (!pending) {
      setGoalMode(goalModeFromEvents(events));
    }
    setActivity(activityLevelFromEvents(events));
  }, [events]);

  const weights = useMemo(() => reduceWeights(events), [events]);
  const exerciseSummary = useMemo(() => trainingSummary(events, exercises), [events, exercises]);
  const projectionInputs = useProjectionInputs({
    events,
    deviceId,
    onRefresh,
    notify,
    summary: exerciseSummary,
    lang,
  });
  const { autoIntake, saveAutoIntake, intakeSource, intakePriority, setIntakePriority } = projectionInputs;
  useEffect(() => {
    if (!autoIntake.enabledToday) return;
    const key = `${day}:${nutri.kcal}:${nutri.protein}:${nutri.carbs}:${nutri.fat}:${nutri.fiber}`;
    if (autoWriteRef.current === key || autoWritePendingRef.current === key) return;
    autoWritePendingRef.current = key;
    void saveAutoIntake(
      { kcal: nutri.kcal, protein: nutri.protein, carbs: nutri.carbs, fat: nutri.fat, fiber: nutri.fiber },
      true,
    )
      .then(() => {
        autoWriteRef.current = key;
        autoWritePendingRef.current = '';
      })
      .catch(() => {
        // Permitir reintentar con los mismos valores si el write falló.
        autoWritePendingRef.current = '';
      });
  }, [nutri, day, autoIntake.enabledToday]); // eslint-disable-line react-hooks/exhaustive-deps

  const training = projectionInputs.training;
  const steps = projectionInputs.steps;
  const customFoods = useMemo(() => reduceCustomFoods(events), [events]);
  const foods = useMemo(() => [...FOODS, ...customFoods], [customFoods]);
  const savedToday = useMemo(() => latestNutrition(events, day), [events, day]);

  const currentWeight =
    (weights.length ? weights[weights.length - 1].kg : 0) || lastMeas?.weight || 0;
  const baseMeasures: BodyMeasures = {
    ...EMPTY_MEASURES,
    ...(lastMeas ?? {}),
    weight: currentWeight || lastMeas?.weight || 0,
  };
  const macros = computeMacros(baseMeasures, training.weeklyMinutes, goalMode, activity, lang, steps, {
    summary: exerciseSummary,
    declaredPerWeek: training.effectivePerWeek,
  });
  const comp = bodyComposition(baseMeasures, lang);
  const fatAvg = comp.avg;
  const draftGrams = mealGrams(mealItems);
  const satiety = computeSatiety(nutri, macros, {
    grams: draftGrams || undefined,
    bodyFat: fatAvg,
    leanMass: comp.leanMass,
    weightKg: baseMeasures.weight,
    weeklyMinutes: training.weeklyMinutes,
  }, lang);
  const waterCurrent = Math.max(0, Math.round(Number(nutri.water) || 0));
  const waterGuidance = computeWaterGuidance(baseMeasures, training.weeklyMinutes, waterCurrent, lang);
  const waterTarget = waterGuidance.targetMl;
  const waterSafeMax = waterGuidance.safeMaxMl;
  const waterPct = waterTarget > 0 ? Math.round((waterCurrent / waterTarget) * 100) : 0;
  const waterOver = waterGuidance.status === 'excess' || waterGuidance.status === 'danger';

  const saveNutrition = async () => {
    if (nutri.kcal < 0 || nutri.protein < 0 || nutri.carbs < 0 || nutri.fat < 0 || nutri.fiber < 0 || nutri.water < 0) {
      notify(tx(lang, 'Los valores de ingesta no pueden ser negativos.', 'Intake values cannot be negative.'), 'error');
      return;
    }
    const wasSaved = savedToday !== null;
    await appendEvent(newEvent(deviceId, 'nutrition.logged', { ...nutri, date: day }));
    dirtyNutrition.current = false;
    await onRefresh();
    notify(
      wasSaved
        ? tx(
            lang,
            'Ingesta de hoy actualizada: se sobrescribió el log de este día.',
            "Today's intake updated: this day's log was overwritten.",
          )
        : tx(lang, 'Ingesta de hoy guardada como log diario.', "Today's intake saved as a daily log."),
      'success',
    );
  };

  const createFood = async (food: Food) => {
    await appendEvent(newEvent(deviceId, 'food.saved', food));
    await onRefresh();
    notify(
      tx(
        lang,
        `Alimento "${food.name}" añadido a la base local.`,
        `Food "${food.name}" added to the local database.`,
      ),
      'success',
    );
  };

  const addMeal = (item: FoodLogItem) => {
    dirtyNutrition.current = true;
    setMealItems((items) => [...items, item]);
  };

  const updateMeal = (updated: FoodLogItem) => {
    dirtyNutrition.current = true;
    setMealItems((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  };

  const removeMeal = (id: string) => {
    const next = mealItems.filter((item) => item.id !== id);
    dirtyNutrition.current = true;
    setMealItems(next);
    if (!next.length) {
      setNutri((current) => ({ ...current, ...emptyMacros(day) }));
    }
  };

  const clearMeals = () => {
    dirtyNutrition.current = true;
    setMealItems([]);
    setNutri((current) => ({ ...current, ...emptyMacros(day) }));
  };

  const changeNutri = (patch: Partial<NutritionEntry>) => {
    dirtyNutrition.current = true;
    setNutri((current) => ({ ...current, ...patch, date: day }));
  };

  const toggleUserAllergen = (id: AllergenId) => {
    setUserAllergens((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      localStorage.setItem('bt.allergens', JSON.stringify(next));
      return next;
    });
  };

  const onPanelTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = PANEL_TABS.findIndex(([id]) => id === tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % PANEL_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + PANEL_TABS.length) % PANEL_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = PANEL_TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(PANEL_TABS[next][0]);
  };

  const changeGoal = async (mode: GoalMode) => {
    const event = newEvent(deviceId, 'goal.mode', { mode });
    // En Android el reloj puede ir por detrás de eventos sincronizados de otro
    // dispositivo: asegurar que este evento va al final al ordenar por fecha.
    const latest = events.reduce((max, e) => Math.max(max, Date.parse(e.timestamp) || 0), 0);
    event.timestamp = new Date(Math.max(Date.now(), latest + 1)).toISOString();
    pendingGoalRef.current = { id: event.id, mode };
    if (goalWatchdogRef.current !== null) window.clearTimeout(goalWatchdogRef.current);
    goalWatchdogRef.current = window.setTimeout(() => {
      // Si el write se colgó, volver al estado real de la bóveda.
      pendingGoalRef.current = null;
      setGoalMode(goalModeFromEvents(events));
    }, 12_000);
    setGoalMode(mode);
    try {
      await appendEvent(event);
    } catch (e) {
      if (goalWatchdogRef.current !== null) window.clearTimeout(goalWatchdogRef.current);
      pendingGoalRef.current = null;
      setGoalMode(goalModeFromEvents(events));
      notify(
        tx(lang, `No se pudo guardar el objetivo: ${errorText(e)}`, `Could not save the goal: ${errorText(e)}`),
        'error',
      );
    }
  };

  const remainingMacros = macros
    ? {
        kcal: Math.max(0, macros.kcal - (Number(nutri.kcal) || 0)),
        protein: Math.max(0, macros.protein - (Number(nutri.protein) || 0)),
        carbs: Math.max(0, macros.carbs - (Number(nutri.carbs) || 0)),
        fat: Math.max(0, macros.fat - (Number(nutri.fat) || 0)),
      }
    : null;
  const recipeSuggestions = recommendRecipes(goalMode, remainingMacros, 3, lang, recipeSeed);

  const addRecipe = (recipe: (typeof recipeSuggestions)[number]) => {
    const items = recipeLogItems(recipe);
    for (const item of items) addMeal(item);
    notify(
      tx(
        lang,
        `${recipe.name}: ${items.length} ingredientes añadidos a ${mealSlotLabel(recipe.meal, lang)}.`,
        `${recipe.name}: ${items.length} ingredients added to ${mealSlotLabel(recipe.meal, lang)}.`,
      ),
      'success',
    );
  };

  const logWater = async (delta: number) => {
    if (waterSaving.current) return;
    const current = waterCurrent;
    const next = Math.min(10000, Math.max(0, current + delta));
    if (next === current) return;

    waterSaving.current = true;
    const generation = ++waterGenRef.current;
    setWaterBusy(true);
    // En Android un guardado puede quedar colgado; liberar el guard para que
    // los botones vuelvan a responder aunque el invoke no termine nunca.
    let finished = false;
    const watchdog = window.setTimeout(() => {
      if (!finished) {
        waterSaving.current = false;
        setWaterBusy(false);
      }
    }, 15_000);
    setNutri((value) => ({ ...value, water: next, date: day }));
    try {
      // El agua forma parte del log diario de ingesta. Se guarda al momento
      // conservando los macros ya registrados para ese día.
      const base = savedToday ?? emptyNutrition(day);
      await appendEvent(newEvent(deviceId, 'nutrition.logged', { ...base, date: day, water: next }));
      if (generation !== waterGenRef.current) return;
      // La lectura de la bóveda va en segundo plano: si falla, no debe
      // deshacerse un agua que sí se guardó.
      void onRefresh();
      if (next > waterSafeMax && current <= waterSafeMax) {
        notify(
          tx(
            lang,
            `Has superado tu límite seguro de agua (${(waterSafeMax / 1000).toFixed(1)} L). No fuerces más bebida hoy.`,
            `You have exceeded your safe water limit (${(waterSafeMax / 1000).toFixed(1)} L). Do not force more fluids today.`,
          ),
          'error',
        );
      } else if (current < waterTarget && next >= waterTarget) {
        notify(tx(lang, 'Objetivo de agua alcanzado.', 'Water goal reached.'), 'success');
      }
    } catch (e) {
      if (generation !== waterGenRef.current) return;
      setNutri((value) => ({ ...value, water: current, date: day }));
      notify(
        tx(lang, `No se pudo guardar el agua: ${errorText(e)}`, `Could not save water: ${errorText(e)}`),
        'error',
      );
    } finally {
      finished = true;
      window.clearTimeout(watchdog);
      waterSaving.current = false;
      setWaterBusy(false);
    }
  };

  useEffect(() => {
    if (dirtyNutrition.current) return;
    if (mealItems.length > 0) return;
    setNutri(savedToday ?? emptyNutrition(day));
  }, [savedToday, day, mealItems.length]);

  useEffect(() => {
    if (!mealItems.length) return;
    const totals = mealTotals(mealItems);
    setNutri((current) => ({
      ...current,
      ...emptyMacros(day),
      ...totals,
      water: current.water || savedToday?.water || 0,
    }));
  }, [mealItems, day, savedToday]);

  useEffect(() => {
    saveMealDraft(day, mealItems);
  }, [day, mealItems]);

  useEffect(() => {
    const check = () => {
      const current = todayISO();
      if (current === day) return;
      clearMealDraft();
      setDay(current);
      setMealItems([]);
      setNutri(emptyNutrition(current));
      dirtyNutrition.current = false;
    };
    const id = window.setInterval(check, 30_000);
    check();
    return () => window.clearInterval(id);
  }, [day]);

  const hasNutrition = mealItems.length > 0 || nutri.kcal > 0 || nutri.protein > 0 || nutri.carbs > 0 || nutri.fat > 0 || nutri.fiber > 0 || nutri.water > 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">{tx(lang, 'Alimentación', 'Nutrition')}</h1>
          <p className="page-sub">
            {tx(
              lang,
              'Ingesta, agua y recetas: todo lo que comes y bebes en un solo lugar.',
              'Intake, water and recipes: everything you eat and drink in one place.',
            )}
          </p>
        </div>
        <div className="page-actions">
          <span className="badge badge-primary">
            <Icon name="calendar" size={12} />{' '}
            {new Date().toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label={tx(lang, 'Secciones del panel', 'Dashboard sections')}>
        {PANEL_TABS.map(([id, es, en]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
            className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} onKeyDown={onPanelTabKeyDown}>
            {tx(lang, es, en)}
          </button>
        ))}
      </div>


      <div className="grid grid-2">
        {tab === 'agua' && (
        <>
          <section
            className={`card water-banner span-2 ${waterOver ? 'water-banner-over' : ''}`}
          aria-label={tx(lang, 'Control de agua', 'Water tracking')}
          aria-live="polite"
        >
          <div className="water-banner-body">
            <div className="water-banner-top">
              <div className="water-banner-icon"><Icon name="water" size={24} /></div>
              <div className="water-banner-copy">
                <div className="water-banner-title">{tx(lang, 'Agua de hoy', "Today's water")}</div>
                <div className="water-banner-sub">{waterGuidance.message}</div>
              </div>
              <div className="water-banner-value">
                <strong>{(waterCurrent / 1000).toFixed(2)} L</strong>
                <span>{tx(lang, 'objetivo', 'target')} {(waterTarget / 1000).toFixed(1)} L</span>
              </div>
              <span className={`badge ${waterOver ? 'badge-error' : waterPct >= 100 ? 'badge-success' : 'badge-primary'}`}>
                {waterOver ? tx(lang, 'Exceso', 'Excess') : `${waterPct}%`}
              </span>
            </div>
            <ProgressBar
              label={tx(lang, 'Progreso de hidratación', 'Hydration progress')}
              valueLabel={tx(
                lang,
                `${waterCurrent} ml · seguro hasta ${waterSafeMax} ml`,
                `${waterCurrent} ml · safe up to ${waterSafeMax} ml`,
              )}
              value={waterCurrent}
              max={Math.max(waterTarget, waterSafeMax)}
              color={waterOver ? 'var(--error)' : 'var(--info)'}
            />
            <div className="water-banner-actions">
              {[250, 500, 1000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className="btn btn-tonal btn-sm"
                  disabled={waterBusy || waterCurrent >= 10000}
                  onClick={() => void logWater(amount)}
                >
                  <Icon name="water" size={14} /> +{amount >= 1000 ? `${amount / 1000} L` : `${amount} ml`}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={waterBusy || waterCurrent === 0}
                onClick={() => void logWater(-250)}
              >
                −250 ml
              </button>
              {waterOver && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm water-undo"
                  disabled={waterBusy || waterCurrent === 0}
                  onClick={() => void logWater(-500)}
                >
                  {tx(lang, 'Corregir −500 ml', 'Correct −500 ml')}
                </button>
              )}
            </div>
            <div className={`notice ${waterOver ? 'notice-error' : waterGuidance.tone === 'warn' ? 'notice-warn' : 'notice-info'}`}>
              <Icon name={waterOver ? 'alert' : 'info'} size={16} />
              <div>
                <strong>
                  {tx(lang, 'Rango seguro:', 'Safe range:')} {(waterTarget / 1000).toFixed(1)}–{(waterSafeMax / 1000).toFixed(1)}{' '}
                  {tx(lang, 'L/día', 'L/day')}
                  {' · '}
                  {tx(lang, 'no superar', 'do not exceed')} {(waterGuidance.hardMaxMl / 1000).toFixed(1)} L
                </strong>
                <div className="small">{waterGuidance.detail}</div>
                <div className="small muted">
                  {tx(lang, 'Calculado con ', 'Calculated with ')}
                  {waterGuidance.leanMassKg !== null
                    ? tx(
                        lang,
                        `${waterGuidance.leanMassKg.toFixed(1)} kg de masa magra`,
                        `${waterGuidance.leanMassKg.toFixed(1)} kg of lean mass`,
                      )
                    : tx(lang, 'tu peso', 'your weight')}
                  {waterGuidance.fatMassKg !== null
                    ? tx(
                        lang,
                        ` y ${waterGuidance.fatMassKg.toFixed(1)} kg de grasa`,
                        ` and ${waterGuidance.fatMassKg.toFixed(1)} kg of fat`,
                      )
                    : ''}
                  {' · '}
                  {tx(
                    lang,
                    `${waterGuidance.exerciseAddMl} ml extra por entrenamiento. Se guarda al momento en el log de hoy.`,
                    `${waterGuidance.exerciseAddMl} ml extra per workout. Saved immediately to today's log.`,
                  )}
                </div>
              </div>
            </div>
            <div className="notice notice-info">
              <Icon name="water" size={17} />
              <div>
                <strong>{tx(lang, 'Agua objetivo:', 'Water target:')} {(waterTarget / 1000).toFixed(1)} L/{tx(lang, 'día', 'day')}</strong>
                <div className="small">
                  {tx(lang, 'Calculado a partir de ', 'Calculated from ')}
                  {waterGuidance.leanMassKg !== null
                    ? `${waterGuidance.leanMassKg.toFixed(1)} kg ${tx(lang, 'de masa magra', 'of lean mass')}`
                    : tx(lang, 'tu peso', 'your weight')}
                  {waterGuidance.fatMassKg !== null
                    ? ` ${tx(lang, 'y', 'and')} ${waterGuidance.fatMassKg.toFixed(1)} kg ${tx(lang, 'de grasa', 'of fat')}`
                    : ''}
                  {tx(lang, ' y ', ' and ')}
                  {training.weeklyMinutes} {tx(lang, 'min/semana de entrenamiento', 'min/week of training')}
                  {tx(lang, '. Rango seguro hasta', '. Safe range up to')} {(waterSafeMax / 1000).toFixed(1)} L.
                </div>
              </div>
            </div>
          </div>
        </section>
        </>
        )}
        {tab === 'ingesta' && (
<>
        <section className="card span-2">
          <div className="card-body row wrap">
            <button className={`btn ${autoIntake.enabledToday ? 'btn-primary' : 'btn-tonal'} btn-sm`} onClick={() => void saveAutoIntake(nutri)}>
              <Icon name="check" size={14} /> {autoIntake.enabledToday ? tx(lang, 'Desactivar registro automático', 'Disable automatic logging') : tx(lang, 'Registrar ingesta de hoy', 'Log today’s intake')}
            </button>
            <span className="hint">
              {tx(lang, `${autoIntake.days}/30 días · media ${Math.round(autoIntake.avg)} kcal/día`, `${autoIntake.days}/30 days · average ${Math.round(autoIntake.avg)} kcal/day`)}
              {intakeSource === 'auto' ? tx(lang, ' · en uso en la proyección', ' · used in the projection') : ''}
            </span>
            <span className="hint">{tx(lang, 'Al activarlo, los macros del día se guardan solos al cambiarlos.', 'When enabled, the day’s macros are saved automatically when they change.')}</span>
            <label className="field">
              <span className="field-label">{tx(lang, 'Prioridad de ingesta', 'Intake priority')}</span>
              <Select
                value={intakePriority}
                onChange={(value) => setIntakePriority(value as 'manual' | 'auto' | 'logged')}
                options={[
                  { value: 'manual', label: tx(lang, 'Manual', 'Manual') },
                  { value: 'auto', label: tx(lang, 'Automática (≥5 días/30)', 'Automatic (≥5 days/30)') },
                  { value: 'logged', label: tx(lang, 'Registrada', 'Logged') },
                ]}
              />
            </label>
            <span className="hint">{tx(lang, 'Se usa la fuente prioritaria disponible; si falta, se cae a la siguiente.', 'The highest-priority available source is used; otherwise it falls back to the next.')}</span>
          </div>
        </section>
        <section className="card span-2">
          <div className="card-header">
            <div>
              <div className="card-title"><Icon name="target" /> {tx(lang, 'Macros y agua', 'Macros and water')}</div>
              <div className="card-sub">
                {tx(
                  lang,
                  'Calculado con tu peso, altura, edad, sexo y minutos de entrenamiento de los últimos 7 días.',
                  'Calculated from your weight, height, age, sex and training minutes over the last 7 days.',
                )}
              </div>
            </div>
          </div>
          <div className="card-body stack">
            <div className="segmented" role="tablist" aria-label={tx(lang, 'Objetivo', 'Goal')}>
              {([
                ['cut', tx(lang, 'Perder grasa', 'Lose fat')],
                ['maintain', tx(lang, 'Mantener', 'Maintain')],
                ['bulk', tx(lang, 'Ganar músculo', 'Gain muscle')],
              ] as Array<[GoalMode, string]>).map(([mode, label]) => (
                <button key={mode} type="button" className={`segment ${goalMode === mode ? 'active' : ''}`} onClick={() => void changeGoal(mode)}>
                  {label}
                </button>
              ))}
            </div>

            <span className="hint">
              {tx(
                lang,
                `Nivel de actividad: ${activityOption(activity, lang).label}. La actividad, la frecuencia de entrenamiento, los pasos y la ingesta media se ajustan en Figura corporal.`,
                `Activity level: ${activityOption(activity, lang).label}. Activity, training frequency, steps and average intake are adjusted in Body figure.`,
              )}
            </span>

            {macros ? (
              <>
                <div className="grid grid-2" style={{ gap: 10 }}>
                  <Stat label={tx(lang, 'Calorías', 'Calories')} value={`${macros.kcal}`} caption={tx(lang, 'kcal/día', 'kcal/day')} />
                  <Stat label={tx(lang, 'Proteína', 'Protein')} value={`${macros.protein} g`} caption={`${(macros.protein / (baseMeasures.weight || 1)).toFixed(1)} g/kg`} />
                  <Stat label={tx(lang, 'Carbohidratos', 'Carbohydrates')} value={`${macros.carbs} g`} caption={tx(lang, 'energía y glucógeno', 'energy and glycogen')} />
                  <Stat label={tx(lang, 'Grasas', 'Fats')} value={`${macros.fat} g`} caption={tx(lang, 'hormonas y saciedad', 'hormones and satiety')} />
                  <Stat
                    label={tx(lang, 'Gasto estimado', 'Estimated expenditure')}
                    value={`${macros.tdee}`}
                    caption={
                      activity === 'auto'
                        ? `BMR ${macros.bmr} · ${tx(lang, 'actividad', 'activity')} ×${macros.activity.toFixed(3)}`
                        : `BMR ${macros.bmr} · ${activityOption(activity, lang).label} ×${macros.activity.toFixed(3)}`
                    }
                  />
                  <Stat
                    label={tx(lang, 'Balance', 'Balance')}
                    value={`${macros.kcal - macros.tdee > 0 ? '+' : ''}${macros.kcal - macros.tdee} kcal`}
                    caption={`${goalLabel(goalMode, lang)} · ${activityOption(activity, lang).label}`}
                  />
                </div>
                {macros && <p className="hint">{tx(lang, `Fibra objetivo: ${macros.fiber} g/día.`, `Fiber target: ${macros.fiber} g/day.`)}</p>}
                {macros.missing.length > 0 && (
                  <p className="hint">
                    {tx(lang, 'Estimación adaptativa: faltan ', 'Adaptive estimate: missing ')}
                    {macros.missing.join(', ')}. {macros.notes.join(' ')}
                  </p>
                )}
              </>
            ) : (
              <EmptyState
                icon={<Icon name="scale" />}
                title={tx(lang, 'Falta tu peso', 'Weight required')}
                sub={tx(
                  lang,
                  'Añade tu peso (y altura/edad si puedes) para calcular macros, agua y saciedad.',
                  'Add your weight (and height/age if you can) to calculate macros, water and satiety.',
                )}
              />
            )}
          </div>
        </section>

        <section className="card span-2">
          <div className="card-header">
            <div>
              <div className="card-title"><Icon name="bowl" /> {tx(lang, 'Ingesta y saciedad', 'Intake and satiety')}</div>
              <div className="card-sub">
                {tx(
                  lang,
                  'Añade alimentos del día, calcula calorías y macros automáticamente y guarda un único log diario. El borrador se borra al terminar el día.',
                  'Add the day\'s foods, calculate calories and macros automatically and save a single daily log. The draft clears at the end of the day.',
                )}
              </div>
            </div>
            <span className={`badge ${savedToday ? 'badge-success' : 'badge-muted'}`}>
              {savedToday ? tx(lang, 'Log de hoy guardado', "Today's log saved") : tx(lang, 'Sin log de hoy', 'No log today')}
            </span>
          </div>
          <div className="card-body stack">
            <FoodLog
              foods={foods}
              items={mealItems}
              onAdd={addMeal}
              onUpdate={updateMeal}
              onRemove={removeMeal}
              onClear={clearMeals}
              onCreateFood={createFood}
            />

            <div className="divider" />

            <div className="row between wrap">
              <span className="badge badge-primary">
                <Icon name="calendar" size={12} /> {tx(lang, 'Hoy', 'Today')} · {day}
              </span>
              <span className="hint">
                {tx(
                  lang,
                  'El log diario se guarda una sola vez por fecha; guardar de nuevo sobrescribe el de hoy.',
                  "The daily log is saved once per date; saving again overwrites today's.",
                )}
              </span>
            </div>

            <div className="grid grid-2" style={{ gap: 10 }}>
              <Field label={tx(lang, 'Agua (ml)', 'Water (ml)')}>
                <NumberInput value={nutri.water} onChange={(v) => changeNutri({ water: v })} placeholder="2500" min={0} max={10000} step={100} />
              </Field>
              <div className="stack-sm">
                <span className="field-label">{tx(lang, 'Totales actuales', 'Current totals')}</span>
                <div className="chips">
                  <span className="chip active">{nutri.kcal} kcal</span>
                  <span className="chip active">{nutri.protein} g {tx(lang, 'proteína', 'protein')}</span>
                  <span className="chip active">{nutri.carbs} g {tx(lang, 'carbohidratos', 'carbs')}</span>
                  <span className="chip active">{nutri.fat} g {tx(lang, 'grasas', 'fat')}</span>
                  <span className="chip active">{nutri.fiber} g {tx(lang, 'fibra', 'fiber')}</span>
                </div>
              </div>
            </div>

            <details className="details">
              <summary>{tx(lang, 'Ajustar macros manualmente (opcional)', 'Adjust macros manually (optional)')}</summary>
              <div className="grid grid-3" style={{ marginTop: 12 }}>
                <Field label={tx(lang, 'Calorías (kcal)', 'Calories (kcal)')}><NumberInput value={nutri.kcal} onChange={(v) => changeNutri({ kcal: v })} placeholder="2200" min={0} max={8000} /></Field>
                <Field label={tx(lang, 'Proteína (g)', 'Protein (g)')}><NumberInput value={nutri.protein} onChange={(v) => changeNutri({ protein: v })} placeholder="135" min={0} max={500} /></Field>
                <Field label={tx(lang, 'Carbohidratos (g)', 'Carbohydrates (g)')}><NumberInput value={nutri.carbs} onChange={(v) => changeNutri({ carbs: v })} placeholder="250" min={0} max={1000} /></Field>
                <Field label={tx(lang, 'Grasas (g)', 'Fats (g)')}><NumberInput value={nutri.fat} onChange={(v) => changeNutri({ fat: v })} placeholder="70" min={0} max={400} /></Field>
                <Field label={tx(lang, 'Fibra (g)', 'Fiber (g)')}><NumberInput value={nutri.fiber} onChange={(v) => changeNutri({ fiber: v })} placeholder="30" min={0} max={150} /></Field>
              </div>
            </details>

            <div className="row between wrap">
              <button className="btn btn-primary" onClick={saveNutrition} disabled={!hasNutrition}>
                <Icon name="check" size={15} />{' '}
                {savedToday
                  ? tx(lang, 'Actualizar ingesta de hoy', "Update today's intake")
                  : tx(lang, 'Guardar ingesta de hoy', "Save today's intake")}
              </button>
              {macros && (
                <span className="hint">
                  {tx(lang, 'Objetivo:', 'Target:')} {macros.kcal} kcal · {macros.protein} g{' '}
                  {tx(lang, 'proteína', 'protein')} · {(waterTarget / 1000).toFixed(1)} L{' '}
                  {tx(lang, 'de agua', 'of water')}
                </span>
              )}
            </div>

            {!macros ? (
              <p className="hint">
                {tx(lang, 'Añade tu peso para comparar la ingesta con tus objetivos.', 'Add your weight to compare intake with your targets.')}
              </p>
            ) : !hasNutrition ? (
              <div className="notice notice-info">
                <Icon name="info" size={16} />
                <span>
                  {tx(
                    lang,
                    'Añade comidas o agua para estimar la saciedad con proteína, fibra, volumen, densidad energética e hidratación.',
                    'Add meals or water to estimate satiety from protein, fiber, volume, energy density and hydration.',
                  )}
                </span>
              </div>
            ) : satiety && (
              <div className="stack">
                <ProgressBar
                  label={tx(lang, 'Índice de saciedad', 'Satiety index')}
                  valueLabel={`${satiety.score}%`}
                  value={satiety.score}
                  color={satiety.tone === 'good' ? 'var(--success)' : satiety.tone === 'bad' ? 'var(--error)' : 'var(--tertiary)'}
                />
                <div className="satiety-drivers">
                  {satiety.drivers.map((driver) => (
                    <ProgressBar
                      key={driver.id}
                      label={`${driver.label} · ${driver.weight}%`}
                      valueLabel={`${driver.value}%`}
                      value={driver.value}
                      color={driver.value >= 70 ? 'var(--success)' : driver.value < 45 ? 'var(--error)' : 'var(--info)'}
                    />
                  ))}
                </div>
                <div className="chips">
                  <span className="chip active">
                    {satiety.mealGrams} g {tx(lang, 'de comida', 'of food')}
                  </span>
                  {satiety.energyDensity !== null && (
                    <span className="chip active">{satiety.energyDensity.toFixed(2)} kcal/g</span>
                  )}
                  <span className="chip">{tx(lang, 'Distensión', 'Fullness')} {satiety.fullness}%</span>
                  <span className="chip">{tx(lang, 'Señal hormonal', 'Hormonal signal')} {satiety.hormonal}%</span>
                  <span className="chip">{tx(lang, 'Hidratación', 'Hydration')} {satiety.hydration}%</span>
                </div>
                <div className={`notice ${satiety.tone === 'good' ? 'notice-success' : satiety.tone === 'bad' ? 'notice-error' : satiety.tone === 'warn' ? 'notice-warn' : 'notice-info'}`}>
                  <Icon name={satiety.tone === 'good' ? 'check' : satiety.tone === 'info' ? 'info' : 'alert'} size={17} />
                  <div>
                    <strong>{satiety.diagnosis}</strong>
                    <div className="small">{satiety.tip}</div>
                  </div>
                </div>
                <details className="details">
                  <summary>{tx(lang, 'Cómo se calcula la saciedad', 'How satiety is calculated')}</summary>
                  <div className="stack-sm" style={{ marginTop: 10 }}>
                    {satiety.drivers.map((driver) => (
                      <div key={driver.id} className="satiety-driver-detail">
                        <strong>{driver.label}</strong>
                        <span className="small muted"> {driver.detail}</span>
                      </div>
                    ))}
                    <p className="hint">
                      {tx(
                        lang,
                        'El índice pondera proteína (30 %), peso/volumen (25 %), fibra (20 %), agua (10 %), densidad energética (10 %) y grasa (5 %). Se ajusta por masa magra, % de grasa y minutos de entrenamiento semanales. No es una medida clínica de hambre.',
                        'The index weights protein (30%), weight/volume (25%), fiber (20%), water (10%), energy density (10%) and fat (5%). It adjusts for lean mass, body fat % and weekly training minutes. It is not a clinical measure of hunger.',
                      )}
                    </p>
                  </div>
                </details>
              </div>
            )}
          </div>
        </section>
        </>
        )}
        {tab === 'recetas' && (
        <section className="card span-2">
          <div className="card-header">
            <div>
              <div className="card-title"><Icon name="bowl" /> {tx(lang, 'Recetas recomendadas', 'Recommended recipes')}</div>
              <div className="card-sub">
                {goalLabel(goalMode, lang)} ·{' '}
                {tx(
                  lang,
                  'elige una receta y añade sus ingredientes al diario con los mismos macros de la base de alimentos.',
                  'choose a recipe and add its ingredients to the diary with the same macros from the food database.',
                )}
              </div>
            </div>
            <div className="row wrap">
              <button className="btn btn-ghost btn-sm" onClick={() => setRecipeSeed((seed) => seed + 1)}>
                <Icon name="history" size={14} /> {tx(lang, 'Rotar recetas', 'Rotate recipes')}
              </button>
              <span className="badge badge-success">{tx(lang, 'Sin gluten ni frutos secos', 'Gluten & nut free')}</span>
            </div>
            <div className="row wrap allergens-row">
              <span className="hint small">{tx(lang, 'Mis alérgenos:', 'My allergens:')}</span>
              {(Object.keys(ALLERGEN_LABELS) as AllergenId[]).map((id) => (
                <button key={id} type="button" className={`chip ${userAllergens.includes(id) ? 'active' : ''}`} onClick={() => toggleUserAllergen(id)}>
                  {ALLERGEN_LABELS[id][lang === 'en' ? 1 : 0]}
                </button>
              ))}
            </div>
          </div>
          <div className="card-body stack">
            <div className="recipe-grid">
              {recipeSuggestions.map((recipe) => (
                <article key={recipe.id} className="recipe-card">
                  <div className="row between wrap">
                    <strong>{recipe.name}</strong>
                    <span className={`badge ${recipe.fit === 'excellent' ? 'badge-success' : recipe.fit === 'good' ? 'badge-primary' : 'badge-muted'}`}>
                      {recipe.fit === 'excellent'
                        ? tx(lang, 'Encaje alto', 'High fit')
                        : recipe.fit === 'good'
                          ? tx(lang, 'Buen encaje', 'Good fit')
                          : tx(lang, 'Alternativa', 'Alternative')}
                    </span>
                  </div>
                  <p className="small muted">{recipe.description}</p>
                  <div className="chips">
                    <span className="chip active">{recipe.macros.kcal} kcal</span>
                    <span className="chip active">{recipe.macros.protein} g {tx(lang, 'proteína', 'protein')}</span>
                    <span className="chip">{recipe.macros.carbs} g {tx(lang, 'carbos', 'carbs')}</span>
                    <span className="chip">{recipe.macros.fat} g {tx(lang, 'grasa', 'fat')}</span>
                    <span className="chip">{recipe.macros.fiber} g {tx(lang, 'fibra', 'fiber')}</span>
                  </div>
                  <p className="hint small">
                    <strong>{tx(lang, 'Por qué:', 'Why:')}</strong> {recipe.science}
                  </p>
                  {allergensFor(recipe).some((id) => userAllergens.includes(id)) && (
                    <div className="notice notice-warn">
                      <Icon name="alert" size={15} />
                      <span>{tx(lang, 'Esta receta contiene alérgenos que marcaste.', 'This recipe contains allergens you selected.')}</span>
                    </div>
                  )}
                  {allergensFor(recipe).length > 0 && (
                    <div className="row wrap">
                      <span className="hint small">{tx(lang, 'Alérgenos:', 'Allergens:')}</span>
                      {allergensFor(recipe).map((id) => (
                        <span key={id} className="badge badge-warning">{ALLERGEN_LABELS[id][lang === 'en' ? 1 : 0]}</span>
                      ))}
                    </div>
                  )}
                  <div className="row between wrap">
                    <span className="hint small">
                      {recipe.minutes} min · {mealSlotLabel(recipe.meal, lang)} · {recipe.macros.grams} g
                    </span>
                    <button className="btn btn-tonal btn-sm" onClick={() => addRecipe(recipe)}>
                      <Icon name="plus" size={14} /> {tx(lang, 'Añadir al diario', 'Add to diary')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <p className="hint">
              {tx(
                lang,
                'En déficit se prioriza proteína y fibra por caloría; en superávit, densidad energética y carbohidratos alrededor del entrenamiento. Ajusta las porciones a tu hambre y a tus objetivos.',
                'In a deficit, protein and fiber per calorie come first; in a surplus, energy density and carbs around training. Adjust portions to your hunger and goals.',
              )}
            </p>
          </div>
        </section>
        )}
      </div>

      <div className="row between wrap">
        <span className="hint">
          {tx(
            lang,
            'Los cálculos son estimaciones orientativas, no consejo médico. Fórmulas: Navy, RFM, Deurenberg, CUN-BAE, Mifflin-St Jeor, Katch-McArdle y Cunningham.',
            'Calculations are estimates, not medical advice. Formulas: Navy, RFM, Deurenberg, CUN-BAE, Mifflin-St Jeor, Katch-McArdle and Cunningham.',
          )}
        </span>
        <span className="hint">
          {tx(
            lang,
            `${events.length} eventos · ${fmtDuration(exerciseSummary.weekMinutes * 60)} de entrenamiento semanal`,
            `${events.length} events · ${fmtDuration(exerciseSummary.weekMinutes * 60)} of weekly training`,
          )}
        </span>
      </div>
    </div>
  );
}
