import { useLayoutEffect, useRef, useState } from 'react';
import type { Lang } from '../i18n';
import { tx } from '../i18n';
import type { ProjectionTrajectoryPoint } from '../bodyRange';
import { formatProjectionDate } from '../metrics';

const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 240;

/** Pasos "redondos" (1, 2, 5 × 10ⁿ) para que el eje Y no muestre valores raros. */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const rawStep = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 1e-6; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/**
 * Curva de la evolución proyectada: peso en báscula, masa grasa y masa magra
 * comparten una misma escala en kg para que se puedan comparar directamente.
 *
 * El SVG mide el ancho real de su contenedor (ResizeObserver) y calcula el
 * viewBox con ese ancho, de modo que ocupa todo el box disponible en vez de
 * quedarse con una proporción fija y dejar huecos a los lados.
 */
export default function ProjectionCurve({ trajectory, lang }: { trajectory: ProjectionTrajectoryPoint[]; lang: Lang }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostWidth, setHostWidth] = useState(DEFAULT_WIDTH);
  const ready = trajectory.length > 1;

  useLayoutEffect(() => {
    if (!ready) return;
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const next = Math.round(host.getBoundingClientRect().width);
      if (next > 0) setHostWidth((previous) => (Math.abs(previous - next) > 1 ? next : previous));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [ready]);

  if (!ready) return null;

  const width = Math.max(MIN_WIDTH, hostWidth);
  const height = Math.round(Math.min(260, Math.max(180, width * 0.42)));
  const compact = width < 420;
  const pad = { top: 16, right: 14, bottom: 26, left: 44 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = Math.max(10, height - pad.top - pad.bottom);
  const bottom = pad.top + plotH;

  const series: { label: string; color: string; values: number[] }[] = [
    { label: tx(lang, 'Peso', 'Weight'), color: '#7c5cff', values: trajectory.map((t) => t.scaleWeight) },
    { label: tx(lang, 'Masa grasa', 'Fat mass'), color: '#e5484d', values: trajectory.map((t) => t.fatMass) },
    { label: tx(lang, 'Masa magra', 'Lean mass'), color: '#2b9d8f', values: trajectory.map((t) => t.leanMass) },
  ];
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (!all.length) return null;

  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const margin = Math.max(1, (rawMax - rawMin) * 0.08);
  const min = rawMin - margin;
  const max = rawMax + margin;
  const span = max - min || 1;
  const n = trajectory.length - 1;
  const xFor = (index: number) => pad.left + (index / n) * plotW;
  const yFor = (value: number) => bottom - ((value - min) / span) * plotH;
  const ticks = niceTicks(min, max, compact ? 3 : 4);

  const paths = series.map((s) => {
    let d = '';
    s.values.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      d += `${d ? 'L' : 'M'}${xFor(i).toFixed(1)} ${yFor(value).toFixed(1)} `;
    });
    return d.trim();
  });
  const middleIndex = Math.round(n / 2);
  const showMiddle = plotW >= 360 && middleIndex > 0 && middleIndex < n;

  return (
    <div className="projection-curve" ref={hostRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={tx(lang, 'Evolución proyectada de peso, grasa y masa magra', 'Projected weight, fat and lean mass evolution')}
      >
        <text x={4} y={10} style={{ fontSize: 'var(--fs-xs)' }} fill="currentColor" fillOpacity="0.45">
          kg
        </text>
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={`tick-${tick}`}>
              <line
                x1={pad.left}
                y1={y}
                x2={pad.left + plotW}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.1"
                strokeWidth="1"
              />
              <text x={pad.left - 6} y={y + 3} textAnchor="end" style={{ fontSize: 'var(--fs-xs)' }} fill="currentColor" fillOpacity="0.55">
                {tick.toFixed(0)}
              </text>
            </g>
          );
        })}
        {series.map((s, i) =>
          paths[i] ? (
            <path
              key={s.label}
              d={paths[i]}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
        {series.map((s) => {
          const lastValue = s.values[n];
          if (!Number.isFinite(lastValue)) return null;
          return <circle key={`dot-${s.label}`} cx={xFor(n)} cy={yFor(lastValue)} r="2.6" fill={s.color} />;
        })}
        <text x={pad.left} y={height - 8} style={{ fontSize: 'var(--fs-xs)' }} fill="currentColor" fillOpacity="0.6">
          {tx(lang, 'Hoy', 'Today')}
        </text>
        {showMiddle && (
          <text
            x={xFor(middleIndex)}
            y={height - 8}
            textAnchor="middle"
            style={{ fontSize: 'var(--fs-xs)' }}
            fill="currentColor"
            fillOpacity="0.5"
          >
            {formatProjectionDate(trajectory[middleIndex].date, lang)}
          </text>
        )}
        <text x={pad.left + plotW} y={height - 8} textAnchor="end" style={{ fontSize: 'var(--fs-xs)' }} fill="currentColor" fillOpacity="0.6">
          {formatProjectionDate(trajectory[n].date, lang)}
        </text>
      </svg>
      <div className="chips">
        {series.map((s) => {
          const lastValue = s.values[n];
          if (!Number.isFinite(lastValue)) return null;
          return (
            <span key={s.label} className="chip active" style={{ color: s.color }}>
              {s.label} · {lastValue.toFixed(1)} kg
            </span>
          );
        })}
      </div>
    </div>
  );
}
