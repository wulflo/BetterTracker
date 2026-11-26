import type { Lang } from '../i18n';
import { tx } from '../i18n';
import type { ProjectionInputsController } from '../projectionInputs';
import { NumberInput } from './Fields';

interface Props {
  controller: ProjectionInputsController;
  lang: Lang;
  /** Peso actual del usuario; usado para el kcal/día que aportan los pasos como NEAT. */
  weight?: number;
}

function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-ES', {
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Campos manuales que alimentan el TDEE y la proyección. La frecuencia y la
 * ingesta media existen porque el registro puede estar incompleto: los días sin
 * log no deben hacer creer que la persona entrena o come menos de lo real.
 */
export default function ProjectionInputs({ controller, lang, weight }: Props) {
  const { training, loggedIntake } = controller;
  const monthly = controller.frequencyUnit === 'month';
  const displayedFrequency = monthly
    ? Math.round(controller.frequencyPerWeek * (30 / 7) * 10) / 10
    : controller.frequencyPerWeek;
  const frequencyMax = monthly ? 60 : 14;

  // Desglose continuo: pasos → NEAT adicional ((pasos/1000) × 0,045 × peso kcal/día).
  const stepsKcalPerDay =
    controller.steps > 0 && weight ? Math.round((controller.steps / 1000) * 0.045 * weight) : 0;

  const trainingHint =
    training.effectivePerWeek > 0
      ? tx(
          lang,
          `EAT: ${Math.round(training.effectivePerWeek / 7)} sesiones/día × ${Math.round(training.avgSessionMinutes)} min × MET × W(t) se suman al gasto diario del modelo continuo.${controller.hasFrequency ? ` Declaradas ${training.effectivePerWeek}/sem · registradas ${training.loggedPerWeek}/sem (se usa la mayor).` : ` Registradas ${training.loggedPerWeek}/sem.`}`,
          `EAT: ${Math.round(training.effectivePerWeek / 7)} sessions/day × ${Math.round(training.avgSessionMinutes)} min × MET × W(t) are added to the daily expenditure of the continuous model.${controller.hasFrequency ? ` Declared ${training.effectivePerWeek}/wk · logged ${training.loggedPerWeek}/wk (the higher is used).` : ` Logged ${training.loggedPerWeek}/wk.`}`,
        )
      : training.loggedPerWeek > 0
        ? tx(
            lang,
            `Registradas ${training.loggedPerWeek}/sem (${training.avgSessionMinutes} min por sesión). Si entrenas más días de los que registras, indica tu frecuencia habitual.`,
            `Logged ${training.loggedPerWeek}/wk (${training.avgSessionMinutes} min per session). If you train on more days than you log, enter your usual frequency.`,
          )
        : tx(
            lang,
            'Opcional. Si solo registras algunos días, indica cuántas veces entrenas para no subestimar el gasto.',
            'Optional. If you only log some days, enter how often you train so expenditure is not underestimated.',
          );

  const stepsHint =
    controller.steps > 0
      ? tx(
          lang,
          `Aportan ≈${stepsKcalPerDay} kcal/día como NEAT adicional sin escalones: 6200 y 7800 pasos producen gastos distintos y proporcionales.`,
          `They contribute ≈${stepsKcalPerDay} kcal/day as extra NEAT with no steps: 6200 and 7800 steps produce different, proportional expenditure.`,
        )
      : tx(
          lang,
          'Opcional. Los pasos aportan NEAT continua: (pasos/1000) × 0,045 × peso kcal/día; sin escalones, 6200 y 7800 pasos generan gastos distintos y proporcionales.',
          'Optional. Steps contribute continuous NEAT: (steps/1000) × 0.045 × weight kcal/day; with no steps, 6200 and 7800 steps produce different, proportional expenditure.',
        );

  const intakeHint =
    controller.intakeSource === 'manual'
      ? tx(
          lang,
          `${formatNumber(Math.round(controller.effectiveIntake), lang)} kcal/día manuales. El TEF (10 %) está incluido en el gasto y el balance es ingesta − gasto.`,
          `${formatNumber(Math.round(controller.effectiveIntake), lang)} kcal/day entered manually. TEF (10%) is included in the expenditure and the balance is intake − expenditure.`,
        )
      : controller.intakeSource === 'logged'
        ? tx(
            lang,
            `Se usa la media de ${loggedIntake.days} días registrados (${formatNumber(loggedIntake.avg, lang)} kcal). Si no registras todo, escribe tu media habitual.`,
            `Using the average of ${loggedIntake.days} logged days (${formatNumber(loggedIntake.avg, lang)} kcal). If you do not log everything, enter your usual average.`,
          )
        : tx(
            lang,
            'Sin media manual: la proyección usa el objetivo de calorías. Si no registras todo lo que comes, escribe tu media habitual.',
            'No manual average: the projection uses the calorie target. If you do not log everything you eat, enter your usual average.',
          );

  return (
    <div className="grid grid-3" style={{ gap: 12 }}>
      <div className="field">
        <span className="field-label">
          {tx(lang, 'Frecuencia de entrenamiento', 'Training frequency')}
        </span>
        <div className="row wrap">
          <NumberInput
            value={displayedFrequency}
            onChange={(value) =>
              controller.setFrequencyPerWeek(monthly ? value * (7 / 30) : value)
            }
            min={0}
            max={frequencyMax}
            step={1}
            className="grow"
            style={{ minWidth: 88 }}
            placeholder={monthly ? '16' : '4'}
            ariaLabel={tx(lang, 'Frecuencia de entrenamiento', 'Training frequency')}
          />
          <div className="segmented" role="group" aria-label={tx(lang, 'Unidad de frecuencia', 'Frequency unit')}>
            <button
              type="button"
              className={`segment ${monthly ? '' : 'active'}`}
              onClick={() => controller.setFrequencyUnit('week')}
            >
              /{tx(lang, 'sem', 'wk')}
            </button>
            <button
              type="button"
              className={`segment ${monthly ? 'active' : ''}`}
              onClick={() => controller.setFrequencyUnit('month')}
            >
              /{tx(lang, 'mes', 'mo')}
            </button>
          </div>
          <button type="button" className="btn btn-tonal" onClick={() => void controller.saveFrequency()}>
            {tx(lang, 'Guardar', 'Save')}
          </button>
        </div>
        <span className="hint">{trainingHint}</span>
      </div>

      <div className="field">
        <span className="field-label">{tx(lang, 'Pasos promedio al día', 'Average daily steps')}</span>
        <div className="row">
          <NumberInput
            value={controller.steps}
            onChange={controller.setSteps}
            min={0}
            max={60000}
            step={500}
            className="grow"
            placeholder={tx(lang, 'Ej. 8000', 'E.g. 8000')}
            ariaLabel={tx(lang, 'Pasos promedio al día', 'Average daily steps')}
          />
          <button type="button" className="btn btn-tonal" onClick={() => void controller.saveSteps()}>
            {tx(lang, 'Guardar', 'Save')}
          </button>
        </div>
        <span className="hint">{stepsHint}</span>
      </div>

      <div className="field">
        <span className="field-label">
          {tx(lang, 'Calorías promedio que consumes', 'Average calories you eat')}
        </span>
        <div className="row">
          <NumberInput
            value={controller.intakeKcal}
            onChange={controller.setIntakeKcal}
            min={0}
            max={10000}
            step={50}
            className="grow"
            placeholder={tx(lang, 'Ej. 2100', 'E.g. 2100')}
            ariaLabel={tx(lang, 'Calorías promedio que consumes', 'Average calories you eat')}
          />
          <button type="button" className="btn btn-tonal" onClick={() => void controller.saveIntake()}>
            {tx(lang, 'Guardar', 'Save')}
          </button>
        </div>
        {loggedIntake.days >= 3 && loggedIntake.avg > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={controller.useLoggedIntake}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
          >
            {tx(
              lang,
              `Usar media registrada (${formatNumber(loggedIntake.avg, lang)} kcal)`,
              `Use logged average (${formatNumber(loggedIntake.avg, lang)} kcal)`,
            )}
          </button>
        )}
        <span className="hint">{intakeHint}</span>
      </div>
    </div>
  );
}
