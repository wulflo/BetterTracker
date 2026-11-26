import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ActivityLevel, BodyMeasures, GoalMode, MeasurementEntry, Sex, VaultEvent } from './types';
import { EMPTY_MEASURES } from './types';
import { appendEvent, newEvent } from './vault';
import {
  ACTIVITY_LEVELS,
  AUTO_ACTIVITY,
  activityLevelFromEvents,
  activityOption,
  bodyComposition,
  computeMacros,
  formatProjectionDate,
  goalModeFromEvents,
  latestMeasurement,
  reduceExercises,
  reduceWeights,
  todayISO,
  trainingSummary,
} from './metrics';
import { classifyValue, formatProjectionDuration, projectBody, safeBmiRange, safeBodyFatRange } from './bodyRange';
import { useProjectionInputs } from './projectionInputs';
import BodyFigure from './BodyFigure';
import Select from './components/Select';
import { NumberInput, Field, EmptyState, Stat } from './components/Fields';
import { Icon } from './components/Icons';
import { MiniSparkline } from './components/Charts';
import FatTrend from './components/FatTrend';
import ProjectionInputs from './components/ProjectionInputs';
import ProjectionCurve from './components/ProjectionCurve';
import ProjectionWeights from './components/ProjectionWeights';
import { plural, tx, useLanguage } from './i18n';

type BodyTab = 'datos' | 'composicion' | 'proyeccion';

const BODY_TABS: Array<[BodyTab, string, string]> = [
  ['datos', 'Datos y medidas', 'Data & measurements'],
  ['composicion', 'Composición', 'Composition'],
  ['proyeccion', 'Proyección', 'Projection'],
];

interface Props {
  deviceId: string;
  events: VaultEvent[];
  onRefresh: () => Promise<void>;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export default function BodyView({ deviceId, events, onRefresh, notify }: Props) {
  const { lang } = useLanguage();
  const [bodyTab, setBodyTab] = useState<BodyTab>('datos');
  const onBodyTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = BODY_TABS.findIndex(([id]) => id === bodyTab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % BODY_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + BODY_TABS.length) % BODY_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = BODY_TABS.length - 1;
    else return;
    event.preventDefault();
    setBodyTab(BODY_TABS[next][0]);
  };
  const lastMeas = latestMeasurement(events);
  const lastMeasEventId = [...events].reverse().find((e) => e.kind === 'measurement.saved')?.id;
  const [form, setForm] = useState<MeasurementEntry>({
    ...EMPTY_MEASURES,
    ...(lastMeas ?? {}),
    date: lastMeas?.date ?? todayISO(),
  });
  useEffect(() => {
    if (!lastMeasEventId) return;
    const latest = latestMeasurement(events);
    if (latest) setForm({ ...EMPTY_MEASURES, ...latest, date: latest.date });
  }, [lastMeasEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const weights = useMemo(() => reduceWeights(events), [events]);
  const comp = useMemo(() => bodyComposition(form, lang), [form, lang]);
  const latestWeight = weights.length ? weights[weights.length - 1] : null;
  const [weightDate, setWeightDate] = useState(todayISO());
  const [weightKg, setWeightKg] = useState(0);

  const saveWeight = async () => {
    if (weightKg < 20 || weightKg > 400) {
      notify(tx(lang, 'Introduce un peso entre 20 y 400 kg.', 'Enter a weight between 20 and 400 kg.'), 'error');
      return;
    }
    await appendEvent(newEvent(deviceId, 'weight.logged', { date: weightDate, kg: weightKg }));
    setWeightKg(0);
    await onRefresh();
    notify(tx(lang, 'Peso registrado.', 'Weight logged.'), 'success');
  };
  const goal = useMemo(() => goalModeFromEvents(events), [events]);
  const activity = useMemo(() => activityLevelFromEvents(events), [events]);
  const exerciseSummary = useMemo(
    () => trainingSummary(events, reduceExercises(events)),
    [events],
  );
  const projectionInputs = useProjectionInputs({
    events,
    deviceId,
    onRefresh,
    notify,
    summary: exerciseSummary,
    lang,
  });
  const training = projectionInputs.training;
  const steps = projectionInputs.steps;
  const bmiRange = safeBmiRange(form.age, lang);
  const fatRange = safeBodyFatRange(form.sex, form.age, lang);
  // La proyección necesita un objetivo con dirección. Si el usuario está en
  // "mantener" pero su composición queda fuera del rango saludable, se proyecta
  // la referencia hacia ese rango en lugar de mostrar 5 filas idénticas.
  const projectionGoal = useMemo<GoalMode>(() => {
    if (goal !== 'maintain') return goal;
    const fatHigh = comp.avg !== null && fatRange !== null && comp.avg > fatRange.max;
    const fatLow = comp.avg !== null && fatRange !== null && comp.avg < fatRange.min;
    const bmiHigh = comp.bmi !== null && comp.bmi > bmiRange.max;
    const bmiLow = comp.bmi !== null && comp.bmi < bmiRange.min;
    if (fatHigh || bmiHigh) return 'cut';
    if (fatLow || bmiLow) return 'bulk';
    return 'maintain';
  }, [goal, comp.avg, comp.bmi, fatRange, bmiRange]);
  const projection = useMemo(
    () =>
      projectBody(
        form,
        projectionGoal,
        training.weeklyMinutes,
        activity,
        comp,
        lang,
        training.strengthPerMonth,
        steps,
        {
          avgIntakeKcal: projectionInputs.effectiveIntake,
          intakeSource:
            projectionInputs.intakeSource === 'logged' ? 'logged' : 'manual',
          summary: exerciseSummary,
          declaredPerWeek: training.effectivePerWeek,
        },
      ),
    [
      form,
      projectionGoal,
      training.weeklyMinutes,
      training.strengthPerMonth,
      training.effectivePerWeek,
      activity,
      comp,
      lang,
      steps,
      exerciseSummary,
      projectionInputs.effectiveIntake,
      projectionInputs.intakeSource,
    ],
  );
  const macros = useMemo(
    () => computeMacros(form, training.weeklyMinutes, goal, activity, lang, steps, {
      summary: exerciseSummary,
      declaredPerWeek: training.effectivePerWeek,
    }),
    [form, training.weeklyMinutes, goal, activity, lang, steps],
  );
  const bmiStatus = classifyValue(comp.bmi, bmiRange, lang);
  const fatStatus = classifyValue(comp.avg, fatRange, lang);

  const set = <K extends keyof BodyMeasures>(key: K, value: BodyMeasures[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setField = <K extends keyof MeasurementEntry>(key: K, value: MeasurementEntry[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    if (form.weight < 0 || form.height < 0 || form.age < 0) {
      notify(tx(lang, 'Las medidas no pueden ser negativas.', "Measurements can't be negative."), 'error');
      return;
    }
    await appendEvent(newEvent(deviceId, 'measurement.saved', { ...form }));
    await onRefresh();
    notify(tx(lang, 'Medidas guardadas.', 'Measurements saved.'), 'success');
  };

  const useLatestWeight = () => {
    if (latestWeight) set('weight', latestWeight.kg);
    else notify(tx(lang, 'Todavía no hay un peso registrado.', 'No weight has been logged yet.'), 'info');
  };

  const changeActivity = async (level: ActivityLevel) => {
    await appendEvent(newEvent(deviceId, 'activity.level', { level }));
    await onRefresh();
  };

  const estimatedFields = [
    comp.avg !== null ? tx(lang, '% grasa', '% fat') : null,
    comp.bmi !== null ? tx(lang, 'IMC', 'BMI') : null,
    comp.fatMass !== null ? tx(lang, 'masa grasa', 'fat mass') : null,
    comp.leanMass !== null ? tx(lang, 'masa magra', 'lean mass') : null,
  ].filter(Boolean) as string[];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">{tx(lang, 'Figura corporal', 'Body figure')}</h1>
          <p className="page-sub">
            {tx(
              lang,
              'Silueta y composición adaptativas. Usa peso, altura, edad, sexo y circunferencias; cuantos más datos, mejor, pero la app calcula con lo que haya disponible.',
              'Adaptive silhouette and composition. Uses weight, height, age, sex and circumferences; the more data the better, but the app works with whatever is available.',
            )}
          </p>
        </div>
      </header>

      <div className="tabs body-tabs" role="tablist" aria-label={tx(lang, 'Secciones de figura corporal', 'Body figure sections')}>
        <button type="button" role="tab" id={"body-tab-datos"} aria-controls={"body-panel-datos"}
          aria-selected={bodyTab === 'datos'} tabIndex={bodyTab === 'datos' ? 0 : -1}
          className={`tab ${bodyTab === 'datos' ? 'active' : ''}`}
          onClick={() => setBodyTab('datos')} onKeyDown={onBodyTabKeyDown}>
          {tx(lang, 'Datos y medidas', 'Data & measurements')}
        </button>
        <button type="button" role="tab" id={"body-tab-composicion"} aria-controls={"body-panel-composicion"}
          aria-selected={bodyTab === 'composicion'} tabIndex={bodyTab === 'composicion' ? 0 : -1}
          className={`tab ${bodyTab === 'composicion' ? 'active' : ''}`}
          onClick={() => setBodyTab('composicion')} onKeyDown={onBodyTabKeyDown}>
          {tx(lang, 'Composición', 'Composition')}
        </button>
        <button type="button" role="tab" id={"body-tab-proyeccion"} aria-controls={"body-panel-proyeccion"}
          aria-selected={bodyTab === 'proyeccion'} tabIndex={bodyTab === 'proyeccion' ? 0 : -1}
          className={`tab ${bodyTab === 'proyeccion' ? 'active' : ''}`}
          onClick={() => setBodyTab('proyeccion')} onKeyDown={onBodyTabKeyDown}>
          {tx(lang, 'Proyección', 'Projection')}
        </button>
      </div>
      <div className="body-panels">
      <section className="body-tab-panel" role="tabpanel" id={"body-panel-datos"} aria-labelledby={"body-tab-datos"} hidden={bodyTab !== 'datos'}>
      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title"><Icon name="scale" /> {tx(lang, 'Medidas', 'Measurements')}</div>
            <div className="card-sub">{tx(lang, 'Los campos vacíos se tratan como dato ausente, no como cero. Se guardan como un evento nuevo.', 'Empty fields are treated as missing data, not as zero. They are saved as a new event.')}</div>
          </div>
          <span className="badge badge-muted">{lastMeas ? tx(lang, `Última ${lastMeas.date}`, `Latest ${lastMeas.date}`) : tx(lang, 'Sin medidas guardadas', 'No saved measurements')}</span>
        </div>
        <div className="card-body stack">
          <div className="grid grid-4">
            <Field label={tx(lang, 'Fecha', 'Date')}><input className="input" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} /></Field>
            <Field label={tx(lang, 'Sexo', 'Sex')}>
              <Select
                value={form.sex}
                onChange={(v) => set('sex', v as Sex)}
                options={[
                  { value: 'unspecified', label: tx(lang, 'Sin especificar', 'Unspecified') },
                  { value: 'male', label: tx(lang, 'Hombre', 'Male') },
                  { value: 'female', label: tx(lang, 'Mujer', 'Female') },
                ]}
              />
            </Field>
            <Field label={tx(lang, 'Edad', 'Age')}><NumberInput value={form.age} onChange={(v) => set('age', v)} placeholder="30" min={10} max={100} /></Field>
            <Field label={tx(lang, 'Peso (kg)', 'Weight (kg)')}><NumberInput value={form.weight} onChange={(v) => set('weight', v)} placeholder="75" min={20} max={400} step={0.1} /></Field>
            <Field label={tx(lang, 'Altura (cm)', 'Height (cm)')}><NumberInput value={form.height} onChange={(v) => set('height', v)} placeholder="175" min={100} max={230} /></Field>
            <Field label={tx(lang, 'Cuello (cm)', 'Neck (cm)')}><NumberInput value={form.neck} onChange={(v) => set('neck', v)} placeholder="38" min={20} max={70} /></Field>
            <Field label={tx(lang, 'Pecho (cm)', 'Chest (cm)')}><NumberInput value={form.chest} onChange={(v) => set('chest', v)} placeholder="100" min={50} max={180} /></Field>
            <Field label={tx(lang, 'Cintura (cm)', 'Waist (cm)')}><NumberInput value={form.waist} onChange={(v) => set('waist', v)} placeholder="85" min={40} max={180} /></Field>
            <Field label={tx(lang, 'Abdomen ombligo (cm)', 'Navel abdomen (cm)')}><NumberInput value={form.abdomen} onChange={(v) => set('abdomen', v)} placeholder="85" min={40} max={180} /></Field>
            <Field label={tx(lang, 'Cadera (cm)', 'Hip (cm)')}><NumberInput value={form.hip} onChange={(v) => set('hip', v)} placeholder="95" min={40} max={180} /></Field>
            <Field label={tx(lang, 'Brazo (cm)', 'Arm (cm)')}><NumberInput value={form.arm} onChange={(v) => set('arm', v)} placeholder="32" min={15} max={70} /></Field>
            <Field label={tx(lang, 'Antebrazo (cm)', 'Forearm (cm)')}><NumberInput value={form.forearm} onChange={(v) => set('forearm', v)} placeholder="25" min={15} max={45} /></Field>
            <Field label={tx(lang, 'Muslo (cm)', 'Thigh (cm)')}><NumberInput value={form.thigh} onChange={(v) => set('thigh', v)} placeholder="55" min={25} max={100} /></Field>
            <Field label={tx(lang, 'Pantorrilla (cm)', 'Calf (cm)')}><NumberInput value={form.calf} onChange={(v) => set('calf', v)} placeholder="38" min={20} max={70} /></Field>
            <Field label={tx(lang, 'Muñeca (cm)', 'Wrist (cm)')}><NumberInput value={form.wrist} onChange={(v) => set('wrist', v)} placeholder="17" min={10} max={30} /></Field>
          </div>
          <div className="row between wrap">
            <span className="hint">
              {tx(
                lang,
                'Fórmulas: Navy/Air Force, RFM (sin peso), Deurenberg, CUN-BAE, Ejército (Vogel y versión 2023), Marines (Wright), Friedl, Mifflin-St Jeor, Katch-McArdle y Cunningham. El abdomen se mide a la altura del ombligo y la cintura en su punto más estrecho. Son estimaciones, no diagnóstico médico.',
                'Formulas: Navy/Air Force, RFM (weight-free), Deurenberg, CUN-BAE, Army (Vogel and 2023), Marine Corps (Wright), Friedl, Mifflin-St Jeor, Katch-McArdle and Cunningham. Abdomen is measured at the navel and waist at its narrowest point. These are estimates, not a medical diagnosis.',
              )}
            </span>
            <div className="row wrap">
              <button className="btn btn-tonal" onClick={useLatestWeight}>
                <Icon name="scale" size={15} /> {tx(lang, 'Usar último peso', 'Use latest weight')}
              </button>
              <button className="btn btn-primary" onClick={save}><Icon name="check" size={15} /> {tx(lang, 'Guardar medidas', 'Save measurements')}</button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title"><Icon name="scale" /> {tx(lang, 'Registro rápido de peso', 'Quick weight log')}</div>
            <div className="card-sub">{tx(lang, 'Guarda un peso con fecha sin rellenar el resto de medidas. La curva usa este valor para la tendencia.', 'Log a weight with its date without filling in the rest of the measurements. The trend chart uses this value.')}</div>
          </div>
          <span className="badge badge-muted">{latestWeight ? tx(lang, `Último: ${latestWeight.kg.toFixed(1)} kg`, `Latest: ${latestWeight.kg.toFixed(1)} kg`) : tx(lang, 'Sin pesos', 'No weights')}</span>
        </div>
        <div className="card-body row wrap">
          <Field label={tx(lang, 'Fecha', 'Date')}><input className="input" type="date" value={weightDate} onChange={(e) => setWeightDate(e.target.value)} /></Field>
          <Field label={tx(lang, 'Peso (kg)', 'Weight (kg)')}><NumberInput value={weightKg} onChange={setWeightKg} placeholder="75" min={20} max={400} step={0.1} /></Field>
          <button className="btn btn-primary" onClick={() => void saveWeight()}><Icon name="plus" size={15} /> {tx(lang, 'Registrar peso', 'Log weight')}</button>
          <span className="hint">{tx(lang, 'El peso de hoy también se puede guardar con «Guardar medidas».', "Today's weight can also be saved with “Save measurements”.")}</span>
        </div>
      </section>
      </section>
      <section className="body-tab-panel" role="tabpanel" id={"body-panel-composicion"} aria-labelledby={"body-tab-composicion"} hidden={bodyTab !== 'composicion'}>
      <div className="grid grid-4">
        <Stat
          label={tx(lang, '% grasa estimado', 'Estimated % fat')}
          value={comp.avg !== null ? `${comp.avg.toFixed(1)}%` : '—'}
          caption={
            comp.min !== null && comp.max !== null
              ? tx(
                  lang,
                  `Rango ${comp.min.toFixed(1)}–${comp.max.toFixed(1)}% · ${fatStatus.label}${comp.confidence !== null ? ` · confianza ${comp.confidence}%` : ''}`,
                  `Range ${comp.min.toFixed(1)}–${comp.max.toFixed(1)}% · ${fatStatus.label}${comp.confidence !== null ? ` · ${comp.confidence}% confidence` : ''}`,
                )
              : tx(lang, 'Añade datos para estimar', 'Add data to estimate')
          }
        />
        <Stat
          label={tx(lang, 'Masa grasa', 'Fat mass')}
          value={comp.fatMass !== null ? `${comp.fatMass.toFixed(1)} kg` : '—'}
          caption={comp.fatMass !== null ? tx(lang, 'Peso × % grasa estimado', 'Weight × estimated % fat') : form.weight > 0 ? tx(lang, 'Falta una estimación de % grasa', 'Missing a % fat estimate') : tx(lang, 'Falta el peso', 'Missing weight')}
        />
        <Stat
          label={tx(lang, 'Masa magra', 'Lean mass')}
          value={comp.leanMass !== null ? `${comp.leanMass.toFixed(1)} kg` : '—'}
          caption={comp.bmrKatch !== null ? tx(lang, `Katch ${Math.round(comp.bmrKatch)} kcal`, `Katch ${Math.round(comp.bmrKatch)} kcal`) : tx(lang, 'Requiere composición', 'Requires composition')}
        />
        <Stat
          label={tx(lang, 'IMC', 'BMI')}
          value={comp.bmi !== null ? comp.bmi.toFixed(1) : '—'}
          caption={comp.bmi !== null ? `${bmiRange.label} · ${bmiStatus.label}` : tx(lang, 'Faltan peso y altura', 'Missing weight and height')}
        />
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title"><Icon name="scale" /> {tx(lang, 'Indicadores militares modernos', 'Modern military indicators')}</div>
            <div className="card-sub">
              {tx(lang, 'FFMI (DoDI 1308.03 / USARIEM) y el estándar del Departamento de Defensa.', 'FFMI (DoDI 1308.03 / USARIEM) and the Department of Defense standard.')}
            </div>
             <div className="hint small">
               {tx(
                 lang,
                 'FFMI = masa magra / altura² (índice de masa libre de grasa). WHtR = cintura / altura; por debajo de 0,50 es el rango óptimo. USARIEM y DoDI son estándares militares de referencia, no diagnósticos.',
                 'FFMI = lean mass / height² (fat-free mass index). WHtR = waist / height; below 0.50 is the optimal range. USARIEM and DoDI are reference military standards, not diagnoses.',
               )}
             </div>
          </div>
        </div>
        <div className="card-body stack">
          <div className="grid grid-2" style={{ gap: 10 }}>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'FFMI', 'FFMI')}</div>
              <div className="metric-value-lg">{comp.ffmi !== null ? comp.ffmi.toFixed(2) : '—'}</div>
              <div className="metric-caption">
                {comp.ffmiStatus === 'low'
                  ? tx(lang, 'Reserva magra baja', 'Low lean reserve')
                  : comp.ffmiStatus === 'operational'
                    ? tx(lang, 'Operativo', 'Operational')
                    : comp.ffmiStatus === 'high'
                      ? tx(lang, 'Hipertrofia alta', 'High hypertrophy')
                      : tx(lang, 'Sin FFMI', 'No FFMI')}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'FFMI normalizado', 'Normalized FFMI')}</div>
              <div className="metric-value-lg">{comp.normalizedFfmi !== null ? comp.normalizedFfmi.toFixed(2) : '—'}</div>
              <div className="metric-caption">{tx(lang, 'FFMI + 6,1·(1,8 − altura/100)', 'FFMI + 6.1·(1.8 − height/100)')}</div>
            </div>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'Estándar DoDI 1308.03', 'DoDI 1308.03 standard')}</div>
              <div className="metric-value-lg">
                {comp.militaryStandard.pass
                  ? tx(lang, 'Conforme', 'Conforming')
                  : comp.militaryStandard.pass === false
                    ? tx(lang, 'A revisar', 'To review')
                    : '—'}
              </div>
              <div className="metric-caption">
                {comp.militaryStandard.whtrBand !== null
                  ? tx(lang, `Banda whtr: ${comp.militaryStandard.whtrBand}`, `Whtr band: ${comp.militaryStandard.whtrBand}`)
                  : ''}
                {comp.militaryStandard.fatOk === true
                  ? tx(lang, ' · grasa dentro del límite', ' · fat within limit')
                  : comp.militaryStandard.fatOk === false
                    ? tx(lang, ' · grasa fuera del límite', ' · fat outside the limit')
                    : ''}
              </div>
            </div>
            {comp.muscularOverride && (
              <div className="metric">
                <div className="metric-label">{tx(lang, 'Aviso de masa muscular', 'Muscular mass warning')}</div>
                <div className="metric-value-lg">{tx(lang, 'IMC sobreestimado', 'BMI overestimated')}</div>
                <div className="metric-caption">
                  {tx(lang, 'IMC ≥ 25 con whtr óptimo y grasa dentro del estándar militar: la masa muscular reduce el IMC medido.', 'BMI ≥ 25 with optimal whtr and fat within the military standard: muscle mass lowers measured BMI.')}
                </div>
              </div>
            )}
          </div>
          {comp.ffmiStatus && (
            <div className="small muted">
              {tx(lang, 'Umbrales de USARIEM: reserva magra baja ≤ 17,7 (hombres) / ≤ 14,5 (mujeres); hipertrofia alta > 23,0 / > 18,3 kg/m².', 'USARIEM thresholds: low lean reserve ≤ 17.7 (men) / ≤ 14.5 (women); high hypertrophy > 23.0 / > 18.3 kg/m².')}
            </div>
          )}
        </div>
      </section>

      <div className="body-layout">
        <section className="card">
          <div className="card-header">
            <div>
              <div className="card-title"><Icon name="body" /> {tx(lang, 'Silueta adaptativa', 'Adaptive silhouette')}</div>
              <div className="card-sub">{tx(lang, 'La forma cambia con las circunferencias. Los nodos se pueden arrastrar.', 'The shape changes with circumferences. Nodes can be dragged.')}</div>
            </div>
            {weights.length > 1 && (
              <div style={{ width: 150 }}>
                <MiniSparkline values={weights.slice(-14).map((w) => w.kg)} />
                <div className="hint right">{tx(lang, 'Peso reciente', 'Recent weight')}</div>
              </div>
            )}
          </div>
          <div className="card-body">
            <BodyFigure measures={form} onChange={(m) => setForm((f) => ({ ...f, ...m }))} />
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <div className="card-title"><Icon name="target" /> {tx(lang, 'Composición', 'Composition')}</div>
              <div className="card-sub">{tx(lang, 'Resultados con los datos actuales, sin exigir el formulario completo.', 'Results from the current data, without requiring the full form.')}</div>
              <div className="hint small">
                {tx(
                  lang,
                  '«Peso» es cuánto aporta cada ecuación al consenso (suma 100 %), no tu peso corporal. SEE es el error típico publicado de la ecuación; cuanto menor, más peso recibe. Las familias evitan que muchas ecuaciones parecidas dominen el resultado.',
                  '“Weight” is how much each equation contributes to the consensus (totals 100%), not your body weight. SEE is the published typical error; the lower it is, the more weight it gets. Families stop similar equations from dominating.',
                )}
              </div>
            </div>
            <span className="badge badge-muted">
              {`${comp.methods.length} ${plural(lang, comp.methods.length, 'método', 'métodos')}`}
              {comp.confidence !== null ? ` · ${comp.confidence}%` : ''}
            </span>
          </div>
          <div className="card-body stack">
            {comp.methods.length === 0 ? (
              <EmptyState
                icon={<Icon name="scale" />}
                title={tx(lang, 'Faltan datos para estimar', 'Not enough data to estimate')}
                sub={tx(lang, 'Con cintura/abdomen + altura se activa RFM. Añade cuello (y cadera en mujeres) para Navy; abdomen al ombligo para Ejército, Marines y Friedl. En mujeres, antebrazo, muñeca, brazo y muslo completan las ecuaciones del Ejército y Marines.', 'Waist/abdomen + height enables RFM. Add neck (and hip for women) for Navy; navel abdomen for Army, Marine Corps and Friedl. For women, forearm, wrist, arm and thigh complete the Army and Marine equations.')}
              />
            ) : (
              <>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{tx(lang, 'Método', 'Method')}</th>
                      <th>{tx(lang, '% grasa', '% fat')}</th>
                      <th title={tx(lang, 'Peso dentro del consenso ponderado', 'Weight inside the weighted consensus')}>
                        {tx(lang, 'Peso', 'Weight')}
                      </th>
                      <th>{tx(lang, 'Datos', 'Data')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comp.methods.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td className="mono strong">{m.value.toFixed(1)}%</td>
                        <td className="small muted">{Math.round(m.weight ?? 0)}%</td>
                        <td className="small muted">{m.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint">
                  {tx(
                    lang,
                    `Consenso ponderado por el error publicado de cada ecuación y por los datos disponibles. Cobertura de medidas útiles: ${comp.coverage}%. Los métodos de la misma familia se reparten el peso para no contar dos veces la misma información.`,
                    `Weighted consensus based on each equation's published error and the available data. Useful measurement coverage: ${comp.coverage}%. Methods in the same family share their weight so the same information is not counted twice.`,
                  )}
                </p>
              </>
            )}

            <div className="grid grid-2" style={{ gap: 10 }}>
              <div className="metric">
                <div className="metric-label">BMR Mifflin</div>
                <div className="metric-value-lg">{comp.bmrMifflin !== null ? `${Math.round(comp.bmrMifflin)}` : '—'}</div>
                <div className="metric-caption">{tx(lang, 'kcal/día en reposo', 'kcal/day at rest')}</div>
              </div>
              <div className="metric">
                <div className="metric-label">{tx(lang, 'TDEE estimado', 'Estimated TDEE')}</div>
                <div className="metric-value-lg">{macros ? `${Math.round(macros.tdee)}` : '—'}</div>
                <div className="metric-caption">{activityOption(activity, lang).label} · {goal === 'cut' ? tx(lang, 'déficit', 'deficit') : goal === 'bulk' ? tx(lang, 'superávit', 'surplus') : tx(lang, 'mantenimiento', 'maintenance')}</div>
              </div>
              <div className="metric">
                <div className="metric-label">{tx(lang, 'Cintura/cadera', 'Waist/hip')}</div>
                <div className="metric-value-lg">{comp.whr !== null ? comp.whr.toFixed(2) : '—'}</div>
                <div className="metric-caption">{tx(lang, 'riesgo metabólico orientativo', 'reference metabolic risk')}</div>
              </div>
              <div className="metric">
                <div className="metric-label">{tx(lang, 'Cintura/altura', 'Waist/height')}</div>
                <div className="metric-value-lg">{comp.whtr !== null ? comp.whtr.toFixed(2) : '—'}</div>
                <div className="metric-caption">{tx(lang, 'objetivo < 0.5', 'target < 0.5')}</div>
              </div>
            </div>

            <div className="divider" />

            <div className="stack-sm">
              <span className="field-label">{tx(lang, 'Datos usados', 'Data used')}</span>
              <div className="chips">
                {estimatedFields.length ? estimatedFields.map((f) => <span key={f} className="chip active">{f}</span>) : <span className="hint">{tx(lang, 'Ninguno todavía.', 'None yet.')}</span>}
              </div>
            </div>

            {comp.missing.length > 0 && (
              <div className="notice notice-info">
                <Icon name="info" size={16} />
                <div>
                  <strong>{tx(lang, 'Puedes añadir más datos', 'You can add more data')}</strong>
                  <div className="small">
                    {tx(lang, `Faltan: ${comp.missing.join(', ')}. No son obligatorios: cada método se activa cuando tiene lo necesario.`, `Missing: ${comp.missing.join(', ')}. They are optional: each method activates when it has what it needs.`)}
                  </div>
                </div>
              </div>
            )}

            {comp.bmrKatch !== null && comp.bmrCunningham !== null && (
              <div className="row wrap">
                <span className="badge badge-primary">Katch-McArdle: {Math.round(comp.bmrKatch)} kcal</span>
                <span className="badge badge-primary">Cunningham: {Math.round(comp.bmrCunningham)} kcal</span>
              </div>
            )}
          </div>
        </section>
      </div>
      </section>
      <section className="body-tab-panel" role="tabpanel" id={"body-panel-proyeccion"} aria-labelledby={"body-tab-proyeccion"} hidden={bodyTab !== 'proyeccion'}>
      <FatTrend events={events} />

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title"><Icon name="target" /> {tx(lang, 'Rango seguro y progreso proyectado', 'Safe range and projected progress')}</div>
            <div className="card-sub">
              {tx(
                lang,
                'El objetivo se recalcula con tu masa magra y grasa cuando hay medidas; el ritmo y las fechas usan tu frecuencia de entrenamiento, tus pasos medios y tu ingesta media, y el gasto se recalcula semana a semana.',
                'The target is recalculated from your lean and fat mass when measurements are available; pace and dates use your training frequency, average steps and average intake, and expenditure is recalculated week by week.',
              )}
            </div>
             <div className="hint small">
               {tx(
                 lang,
                 'Siglas: BMR = gasto en reposo; TEF = digestión; NEAT = movimiento diario; EAT = entrenamiento; AT = adaptación metabólica; TDEE = gasto total. La banda «90 %» es el intervalo p5–p95 de 81 escenarios.',
                 'Glossary: BMR = resting burn; TEF = digestion; NEAT = daily movement; EAT = exercise; AT = metabolic adaptation; TDEE = total expenditure. The “90%” band is the p5–p95 interval of 81 scenarios.',
               )}
             </div>
          </div>
          <span className={`badge ${projection.safe ? 'badge-success' : 'badge-warning'}`}>
            {projection.safe ? tx(lang, 'Rango seguro', 'Safe range') : tx(lang, 'Límite alcanzado', 'Limit reached')}
          </span>
        </div>
        <div className="card-body stack">
          {projectionGoal !== goal && (
            <div className="notice notice-info">
              <Icon name="info" size={16} />
              <div>
                {tx(
                  lang,
                  'Tu objetivo está en «Mantener», pero tu composición está fuera del rango saludable: la proyección muestra la referencia hacia ese rango. Cambia el objetivo en el Panel para usarla como objetivo real.',
                  'Your goal is set to “Maintain”, but your composition is outside the healthy range: the projection shows the reference toward that range. Change the goal in the Dashboard to use it as a real target.',
                )}
              </div>
            </div>
          )}
          <div className="grid grid-4">
            <div className="metric">
              <div className="metric-label">{tx(lang, 'IMC saludable', 'Healthy BMI')}</div>
              <div className="metric-value-lg">{bmiRange.min.toFixed(1)}–{bmiRange.max.toFixed(1)}</div>
              <div className="metric-caption">{bmiStatus.label}{comp.bmi !== null ? tx(lang, ` · actual ${comp.bmi.toFixed(1)}`, ` · current ${comp.bmi.toFixed(1)}`) : ''}</div>
            </div>
            <div className="metric">
              <div className="metric-label">{tx(lang, '% grasa orientativo', 'Reference % fat')}</div>
              <div className="metric-value-lg">{fatRange ? `${fatRange.min}–${fatRange.max}%` : '—'}</div>
              <div className="metric-caption">{fatRange ? fatStatus.label : tx(lang, 'Añade sexo y edad', 'Add sex and age')}</div>
            </div>
            <div className="metric">
              <div className="metric-label">
                {projection.targetSource === 'composition'
                  ? tx(lang, 'Objetivo por composición', 'Composition target')
                  : tx(lang, 'Objetivo', 'Target')}
              </div>
              <div className="metric-value-lg">{projection.targetWeight !== null ? `${projection.targetWeight.toFixed(1)} kg` : '—'}</div>
              <div className="metric-caption">
                {projection.targetBodyFat !== null ? tx(lang, `${projection.targetBodyFat.toFixed(0)}% grasa`, `${projection.targetBodyFat.toFixed(0)}% fat`) : tx(lang, 'Sin estimación', 'No estimate')}
                {projection.targetBmi !== null ? tx(lang, ` · IMC ${projection.targetBmi.toFixed(1)}`, ` · BMI ${projection.targetBmi.toFixed(1)}`) : ''}
              </div>
              {projection.targetFatMass !== null && projection.targetLeanMass !== null && (
                <div className="metric-caption">
                  {tx(
                    lang,
                    `${projection.targetLeanMass.toFixed(1)} kg magra · ${projection.targetFatMass.toFixed(1)} kg grasa`,
                    `${projection.targetLeanMass.toFixed(1)} kg lean · ${projection.targetFatMass.toFixed(1)} kg fat`,
                  )}
                </div>
              )}
            </div>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'Ritmo y fecha', 'Pace and date')}</div>
              <div className="metric-value-lg">
                {projection.weeklyRateKg > 0 ? `${projection.weeklyRateKg.toFixed(2)} kg` : '—'}
              </div>
              <div className="metric-caption">
                {projection.weeklyRateKg > 0 ? tx(lang, 'por semana', 'per week') : tx(lang, 'sin déficit ni superávit', 'no deficit or surplus')}
                {projection.etaDate ? ` · ${formatProjectionDate(projection.etaDate, lang)}` : ''}
                {projection.weeks && projection.weeks > 0
                  ? ` · ${formatProjectionDuration(projection.weeks, lang)}`
                  : ''}
              </div>
              <div className="metric-caption">
                {tx(lang, `Fuerza: ${projection.strengthPerMonth}/mes`, `Strength: ${projection.strengthPerMonth}/mo`)}
                {' · '}
                {steps > 0
                  ? tx(lang, `${Math.round(steps)} pasos/día`, `${Math.round(steps)} steps/day`)
                  : tx(lang, 'Pasos: sin dato', 'Steps: no data')}
              </div>
              <div className="metric-caption">
                {tx(lang, `Entreno: ${training.effectivePerWeek}/sem`, `Training: ${training.effectivePerWeek}/wk`)}
                {' · '}
                {projection.avgIntakeKcal !== null
                  ? tx(lang, `Ingesta: ${projection.avgIntakeKcal} kcal/día`, `Intake: ${projection.avgIntakeKcal} kcal/day`)
                  : tx(lang, 'Ingesta: objetivo', 'Intake: target')}
              </div>
            </div>
          </div>

          <div className={`notice ${projection.safe ? 'notice-info' : 'notice-warn'}`}>
            <Icon name={projection.safe ? 'info' : 'alert'} size={16} />
            <div>
              <strong>{projection.message}</strong>
              {projection.note && <div className="small">{projection.note}</div>}
              <div className="small muted">
                {bmiRange.note} {fatRange?.note ?? ''} {tx(lang, 'El cálculo es orientativo y no sustituye una valoración médica.', 'This calculation is a guide and does not replace a medical assessment.')}
              </div>
            </div>
          </div>

          {projection.warnings.length > 0 && (
            <div className="notice notice-warn">
              <Icon name="alert" size={16} />
              <div>
                {projection.warnings.map((warning, index) => (
                  <div key={warning} className={index === 0 ? '' : 'small'}>
                    {warning}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span className="field-label">{tx(lang, 'Nivel de actividad física', 'Physical activity level')}</span>
              <Select
                value={activity}
                onChange={(value) => void changeActivity(value as ActivityLevel)}
                options={[AUTO_ACTIVITY, ...ACTIVITY_LEVELS].map((option) => ({
                  value: option.id,
                  label: `${activityOption(option.id, lang).label} · ${
                    option.multiplier > 0
                      ? `×${option.multiplier}`
                      : tx(lang, 'según entrenamiento', 'based on training')
                  }`,
                  hint: activityOption(option.id, lang).description,
                }))}
              />
              <span className="hint">{activityOption(activity, lang).description}</span>
            </label>
            <ProjectionInputs controller={projectionInputs} lang={lang} weight={form.weight} />
          </div>

          {/* Desglose del gasto diario: BMR, TEF, NEAT, EAT, termogénesis adaptativa. */}
          <div className="grid grid-2" style={{ gap: 10 }}>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'BMR dinámico', 'Dynamic BMR')}</div>
              <div className="metric-value-lg">{Math.round(projection.dailyBreakdown.bmr)} kcal</div>
              <div className="metric-caption">
                {tx(lang, 'Promedio Katch/Cunningham + Mifflin (masa magra actual)', 'Katch/Cunningham + Mifflin average (current lean mass)')}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'TEF (efecto térmico)', 'TEF (thermic effect)')}</div>
              <div className="metric-value-lg">{Math.round(projection.dailyBreakdown.tef)} kcal</div>
              <div className="metric-caption">{tx(lang, '10 % de la ingesta media', '10% of average intake')}</div>
            </div>
            <div className="metric">
              <div className="metric-label">
                {tx(lang, 'NEAT (pasos + actividad base)', 'NEAT (steps + base activity)')}
              </div>
              <div className="metric-value-lg">{Math.round(projection.dailyBreakdown.neat)} kcal</div>
              <div className="metric-caption">
                {tx(lang, 'Factor PAL − 1 × BMR + gasto de caminar', 'PAL factor − 1 × BMR + walking expenditure')}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'EAT (entreno)', 'EAT (training)')}</div>
              <div className="metric-value-lg">{Math.round(projection.dailyBreakdown.eat)} kcal</div>
              <div className="metric-caption">
                {tx(lang, 'Sesiones/sem ÷ 7 × min/sesión × MET × W(t)', 'Sessions/wk ÷ 7 × min/session × MET × W(t)')}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">
                {tx(lang, 'Adaptación metabólica (AT)', 'Metabolic adaptation (AT)')}
              </div>
              <div className="metric-value-lg">{Math.round(projection.adaptiveThermogenesis)} kcal</div>
              <div className="metric-caption">
                {tx(lang, '11 % del desbalance energético, τ = 18 días', '11% of the energy imbalance, τ = 18 days')}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">{tx(lang, 'TDEE total', 'Total TDEE')}</div>
              <div className="metric-value-lg">{Math.round(projection.dailyBreakdown.tdee)} kcal</div>
              <div className="metric-caption">{tx(lang, 'BMR + TEF + NEAT + EAT − AT', 'BMR + TEF + NEAT + EAT − AT')}</div>
            </div>
          </div>

          {(projection.weightLow !== null || projection.weightHigh !== null) && (
            <div className="grid grid-2" style={{ gap: 10 }}>
              <div className="metric">
                <div className="metric-label">
                  {tx(lang, 'Intervalo de predicción del 90 %', '90% prediction interval')}
                </div>
                <div className="metric-value-lg">
                  {projection.weightLow?.toFixed(1)} – {projection.weightHigh?.toFixed(1)} kg
                </div>
                <div className="metric-caption">
                  {tx(
                    lang,
                    'Percentiles 5–95 de 81 escenarios Monte Carlo: BMR, PAL, ingesta, adaptación y agua',
                    '5th–95th percentiles from 81 Monte Carlo scenarios: BMR, PAL, intake, adaptation and water',
                  )}
                </div>
              </div>
              {projection.milestones.length > 0 && (
                <div className="metric">
                  <div className="metric-label">
                    {tx(lang, 'Hitos con rango realista', 'Milestones with realistic range')}
                  </div>
                  <div className="metric-caption">
                    {projection.milestones.map((m) => `${m.date}: ${m.weight.toFixed(1)} kg [${m.weightLow.toFixed(1)}–${m.weightHigh.toFixed(1)}]`).join(' · ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {projection.trajectory.length > 1 && (
            <div className="stack-sm">
              <span className="field-label">
                {tx(lang, 'Pesos proyectados hasta el objetivo', 'Projected weights to target')}
              </span>
              <ProjectionWeights
                trajectory={projection.trajectory}
                targetWeight={projection.targetWeight}
                targetFatMass={projection.targetFatMass}
                targetLeanMass={projection.targetLeanMass}
                targetReached={projection.targetReached}
                etaDate={projection.etaDate}
                lang={lang}
              />
            </div>
          )}

          {projection.trajectory.length > 1 && (
            <div className="stack-sm">
              <span className="field-label">
                {tx(lang, 'Evolución proyectada de composición corporal', 'Projected body composition evolution')}
              </span>
              <ProjectionCurve trajectory={projection.trajectory} lang={lang} />
            </div>
          )}

          {projection.milestones.length > 0 && (
            <div className="projection-track">
              <span className="field-label">{tx(lang, 'Progreso esperado', 'Expected progress')}</span>
              <div className="projection-steps">
                {projection.milestones.map((milestone) => (
                  <div key={milestone.date} className="projection-step">
                    <strong>{milestone.weight.toFixed(1)} kg</strong>
                    <span className="small muted">{formatProjectionDate(milestone.date, lang)}</span>
                    {milestone.bodyFat !== null && <span className="small">≈{milestone.bodyFat.toFixed(1)}%</span>}
                    {milestone.fatMass !== null && (
                      <span className="small muted">
                        {tx(lang, `${milestone.fatMass.toFixed(1)} kg grasa`, `${milestone.fatMass.toFixed(1)} kg fat`)}
                        {milestone.leanMass !== null
                          ? tx(lang, ` · ${milestone.leanMass.toFixed(1)} kg magra`, ` · ${milestone.leanMass.toFixed(1)} kg lean`)
                          : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      </section>
      </div>

    </div>
  );
}
