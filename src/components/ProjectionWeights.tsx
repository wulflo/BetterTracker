import React from 'react';
import type { Lang } from '../i18n';
import { tx } from '../i18n';
import type { ProjectionTrajectoryPoint } from '../bodyRange';
import { formatProjectionDate } from '../metrics';

interface Props {
  trajectory: ProjectionTrajectoryPoint[];
  targetWeight: number | null;
  targetFatMass: number | null;
  targetLeanMass: number | null;
  targetReached: boolean;
  etaDate: string | null;
  lang: Lang;
}

/**
 * Lista semana a semana de los pesos proyectados hasta el objetivo. Se muestra
 * siempre que el simulador haya generado una trayectoria, para que el peso
 * ideal no quede escondido detrás de las tarjetas de resumen.
 */
export default function ProjectionWeights({
  trajectory,
  targetWeight,
  targetFatMass,
  targetLeanMass,
  targetReached,
  etaDate,
  lang,
}: Props) {
  if (trajectory.length < 2) return null;
  // Si el balance no cambia el tejido (mantenimiento real), no tiene sentido
  // repetir cinco filas idénticas: se muestra el punto actual y se explica.
  const flat = trajectory.every(
    (point) => Math.abs(point.tissueWeight - trajectory[0].tissueWeight) < 0.05,
  );
  const rows = flat ? trajectory.slice(0, 1) : trajectory;
  const last = trajectory[trajectory.length - 1];
  const lastTissue = last.tissueWeight > 0 ? last.tissueWeight : last.fatMass + last.leanMass;
  const showTargetRow =
    targetWeight !== null && (!targetReached || Math.abs(lastTissue - targetWeight) > 0.15);

  const targetLabel =
    targetWeight !== null
      ? tx(
          lang,
          `Objetivo: ${targetWeight.toFixed(1)} kg${etaDate ? ` · ${formatProjectionDate(etaDate, lang)}` : ''}`,
          `Target: ${targetWeight.toFixed(1)} kg${etaDate ? ` · ${formatProjectionDate(etaDate, lang)}` : ''}`,
        )
      : tx(lang, 'Sin peso objetivo', 'No target weight');

  return (
    <div className="projection-weights">
      <div className="row between wrap">
        <span className="small">
          <strong>{targetLabel}</strong>
          {targetWeight !== null && !targetReached
            ? ` · ${tx(lang, 'no alcanzado en el horizonte', 'not reached within the horizon')}`
            : ''}
        </span>
        <span className="small muted">
          {flat
            ? tx(lang, 'sin cambio de peso proyectado', 'no projected weight change')
            : tx(lang, `${rows.length} puntos proyectados`, `${rows.length} projected points`)}
        </span>
      </div>
      <div className="projection-weights-scroll">
        <table className="table projection-table">
          <thead>
            <tr>
              <th>{tx(lang, 'Fecha', 'Date')}</th>
              <th>{tx(lang, 'Peso', 'Weight')}</th>
              <th>{tx(lang, 'Grasa', 'Fat')}</th>
              <th>{tx(lang, 'Magra', 'Lean')}</th>
              <th>% {tx(lang, 'grasa', 'fat')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point, index) => {
              const tissue =
                point.tissueWeight > 0 ? point.tissueWeight : point.fatMass + point.leanMass;
              const bodyFat = tissue > 0 ? (point.fatMass / tissue) * 100 : null;
              const isFinal = index === rows.length - 1 && !flat;
              return (
                <tr
                  key={`${point.date}-${index}`}
                  className={isFinal && targetReached ? 'projection-target-row' : undefined}
                >
                  <td className="small muted">
                    {index === 0 ? tx(lang, 'Hoy', 'Today') : formatProjectionDate(point.date, lang)}
                    {isFinal && targetReached ? ` · ${tx(lang, 'objetivo', 'target')}` : ''}
                  </td>
                  <td className="mono strong">{tissue.toFixed(1)} kg</td>
                  <td className="mono small">{point.fatMass.toFixed(1)} kg</td>
                  <td className="mono small">{point.leanMass.toFixed(1)} kg</td>
                  <td className="mono small">{bodyFat !== null ? `${bodyFat.toFixed(1)}%` : '—'}</td>
                </tr>
              );
            })}
            {showTargetRow && (
              <tr className="projection-target-row">
                <td className="small">
                  {tx(lang, 'Objetivo', 'Target')}
                  {!targetReached ? ` · ${tx(lang, 'no alcanzado en el horizonte', 'not reached within the horizon')}` : ''}
                </td>
                <td className="mono strong">{targetWeight!.toFixed(1)} kg</td>
                <td className="mono small">
                  {targetFatMass !== null ? `${targetFatMass.toFixed(1)} kg` : '—'}
                </td>
                <td className="mono small">
                  {targetLeanMass !== null ? `${targetLeanMass.toFixed(1)} kg` : '—'}
                </td>
                <td className="mono small">
                  {targetWeight! > 0 && targetFatMass !== null
                    ? `${((targetFatMass / targetWeight!) * 100).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {tx(
          lang,
          'Peso de tejido (grasa + masa magra), sin el agua transitoria del cambio de ingesta. La fila Objetivo es el peso ideal calculado con tu composición.',
          'Tissue weight (fat + lean mass), excluding the transient water from the intake change. The Target row is the ideal weight calculated from your composition.',
        )}
      </p>
    </div>
  );
}
