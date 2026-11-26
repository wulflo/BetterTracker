import React, { useRef, useState } from 'react';
import type { BodyMeasures } from './types';
import { clamp } from './metrics';
import { tx, useLanguage } from './i18n';

interface Limits {
  min: number;
  max: number;
}

const NEUTRAL: Record<string, Limits> = {
  neck: { min: 28, max: 48 },
  chest: { min: 78, max: 122 },
  waist: { min: 58, max: 112 },
  abdomen: { min: 60, max: 115 },
  hip: { min: 82, max: 118 },
  arm: { min: 22, max: 42 },
  forearm: { min: 20, max: 33 },
  thigh: { min: 42, max: 68 },
  calf: { min: 28, max: 44 },
  wrist: { min: 14, max: 21 },
};

const LIMITS: Record<string, { male: Limits; female: Limits }> = {
  neck: { male: { min: 28, max: 50 }, female: { min: 25, max: 45 } },
  chest: { male: { min: 78, max: 135 }, female: { min: 72, max: 125 } },
  waist: { male: { min: 55, max: 135 }, female: { min: 50, max: 125 } },
  abdomen: { male: { min: 58, max: 140 }, female: { min: 52, max: 130 } },
  hip: { male: { min: 78, max: 135 }, female: { min: 78, max: 140 } },
  arm: { male: { min: 22, max: 50 }, female: { min: 18, max: 44 } },
  forearm: { male: { min: 19, max: 38 }, female: { min: 16, max: 34 } },
  thigh: { male: { min: 38, max: 78 }, female: { min: 38, max: 78 } },
  calf: { male: { min: 26, max: 52 }, female: { min: 24, max: 48 } },
  wrist: { male: { min: 14, max: 23 }, female: { min: 12, max: 21 } },
};

function limitsFor(key: string, sex: BodyMeasures['sex']): Limits {
  if (sex === 'unspecified') return NEUTRAL[key] ?? { min: 0, max: 1 };
  return LIMITS[key]?.[sex] ?? NEUTRAL[key] ?? { min: 0, max: 1 };
}

const NODES: Array<{
  key: keyof BodyMeasures;
  label: string;
  labelEn: string;
  x: number;
  y: number;
  labelLeft?: boolean;
}> = [
  { key: 'neck', label: 'Cuello', labelEn: 'Neck', x: 150, y: 88 },
  { key: 'chest', label: 'Pecho', labelEn: 'Chest', x: 150, y: 132 },
  { key: 'waist', label: 'Cintura', labelEn: 'Waist', x: 150, y: 190 },
  { key: 'abdomen', label: 'Abdomen', labelEn: 'Abdomen', x: 150, y: 214, labelLeft: true },
  { key: 'hip', label: 'Cadera', labelEn: 'Hip', x: 150, y: 244 },
  { key: 'arm', label: 'Brazo', labelEn: 'Arm', x: 72, y: 160 },
  { key: 'forearm', label: 'Antebrazo', labelEn: 'Forearm', x: 64, y: 208 },
  { key: 'thigh', label: 'Muslo', labelEn: 'Thigh', x: 124, y: 318 },
  { key: 'calf', label: 'Pantorrilla', labelEn: 'Calf', x: 128, y: 380 },
  { key: 'wrist', label: 'Muñeca', labelEn: 'Wrist', x: 54, y: 246 },
];

export default function BodyFigure({
  measures,
  onChange,
}: {
  measures: BodyMeasures;
  onChange: (m: BodyMeasures) => void;
}) {
  const { lang } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const valueOf = (key: keyof BodyMeasures): number => {
    const v = Number(measures[key]);
    if (Number.isFinite(v) && v > 0) return v;
    const lim = limitsFor(key, measures.sex);
    return (lim.min + lim.max) / 2;
  };

  const scaleOf = (key: keyof BodyMeasures): number => {
    const lim = limitsFor(key, measures.sex);
    return clamp((valueOf(key) - lim.min) / Math.max(1, lim.max - lim.min), 0, 1);
  };

  const setValue = (key: keyof BodyMeasures, value: number) => {
    const lim = limitsFor(key, measures.sex);
    onChange({ ...measures, [key]: Math.round(clamp(value, lim.min, lim.max) * 10) / 10 });
  };

  const onPointerDown = (key: string) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    setDragging(key);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (key: keyof BodyMeasures) => (e: React.PointerEvent<SVGCircleElement>) => {
    if (dragging !== key) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 300;
    const y = ((e.clientY - rect.top) / rect.height) * 420;
    const distance = Math.hypot(x - 150, y - 120);
    const lim = limitsFor(key, measures.sex);
    const normalized = clamp((distance - 42) / 118, 0, 1);
    setValue(key, lim.min + normalized * (lim.max - lim.min));
  };

  const onPointerUp = (e: React.PointerEvent<SVGCircleElement>) => {
    setDragging(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // La captura ya se liberó.
    }
  };

  const male = measures.sex === 'male';
  const female = measures.sex === 'female';
  const chest = 36 + scaleOf('chest') * 26;
  const waistKey = measures.waist > 0 ? 'waist' : 'abdomen';
  const waist = 27 + scaleOf(waistKey) * 20;
  const hip = 33 + scaleOf('hip') * 25;
  const shoulder = chest + (male ? 7 : female ? -1 : 3);
  const hipWidth = hip + (male ? -5 : female ? 7 : 0);
  const waistWidth = waist + (male ? 0 : female ? -2 : -1);
  const arm = 9 + scaleOf('arm') * 8;
  const thigh = 17 + scaleOf('thigh') * 12;
  const calf = 9 + scaleOf('calf') * 8;
  const neck = 10 + scaleOf('neck') * 5;

  const limb = (d: string, width: number, key: string) => (
    <g key={key}>
      <path d={d} fill="none" stroke="var(--outline-variant)" strokeWidth={width + 3} strokeLinecap="round" opacity="0.75" />
      <path d={d} fill="none" stroke="url(#figure-fill)" strokeWidth={width} strokeLinecap="round" />
    </g>
  );

  return (
    <div className="body-figure">
      <svg
        ref={svgRef}
        viewBox="0 0 300 420"
        role="img"
        aria-label={tx(lang, 'Figura corporal adaptativa', 'Adaptive body figure')}
      >
        <defs>
          <linearGradient id="figure-fill" x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="var(--primary-strong)" stopOpacity="0.92" />
            <stop offset="60%" stopColor="var(--primary)" stopOpacity="0.82" />
            <stop offset="100%" stopColor="var(--primary-container)" stopOpacity="0.72" />
          </linearGradient>
        </defs>

        {/* Guía sutil: eje central y aureola, sin sombras difusas. */}
        <circle cx="150" cy="212" r="156" fill="var(--surface-1)" opacity="0.35" />
        <line x1="150" y1="70" x2="150" y2="406" stroke="var(--outline-variant)" strokeDasharray="4 7" strokeWidth="1" opacity="0.6" />

        {/* Cabeza y cuello */}
        <circle cx="150" cy="52" r="26" fill="url(#figure-fill)" stroke="var(--primary)" strokeWidth="2" />
        <path
          d={`M${150 - neck} 76 L${150 + neck} 76 L${150 + neck + 4} 100 L${150 - neck - 4} 100 Z`}
          fill="url(#figure-fill)"
          stroke="var(--primary)"
          strokeWidth="1.5"
        />

        {/* Torso continuo, con hombros y caderas según la silueta elegida. */}
        <path
          d={`M${150 - shoulder} 112
              C${150 - shoulder - 7} 142, ${150 - waistWidth} 168, ${150 - waistWidth} 198
              C${150 - waistWidth} 224, ${150 - hipWidth} 234, ${150 - hipWidth} 252
              L${150 + hipWidth} 252
              C${150 + hipWidth} 234, ${150 + waistWidth} 224, ${150 + waistWidth} 198
              C${150 + waistWidth} 168, ${150 + shoulder + 7} 142, ${150 + shoulder} 112
              C${150 + 16} 102, ${150 - 16} 102, ${150 - shoulder} 112 Z`}
          fill="url(#figure-fill)"
          stroke="var(--primary)"
          strokeWidth="2"
        />

        {limb(`M${150 - shoulder + 3} 122 Q${150 - shoulder - arm - 12} 172 ${150 - shoulder - arm - 4} 246`, arm * 2, 'arm-l')}
        {limb(`M${150 + shoulder - 3} 122 Q${150 + shoulder + arm + 12} 172 ${150 + shoulder + arm + 4} 246`, arm * 2, 'arm-r')}
        {limb(`M${150 - hip + 8} 252 Q${150 - hipWidth + 2} 300 ${150 - 26} 348`, thigh * 2, 'thigh-l')}
        {limb(`M${150 + hip - 8} 252 Q${150 + hipWidth - 2} 300 ${150 + 26} 348`, thigh * 2, 'thigh-r')}
        {limb(`M${150 - 26} 352 Q${150 - 24} 386 ${150 - 22} 404`, calf * 2, 'calf-l')}
        {limb(`M${150 + 26} 352 Q${150 + 24} 386 ${150 + 22} 404`, calf * 2, 'calf-r')}

        {/* Nodos arrastrables */}
        {NODES.map((node) => {
          const active = dragging === node.key;
          const value = valueOf(node.key);
          const toRight = node.labelLeft ? false : node.x >= 150;
          const dx = toRight ? 13 : -13;
          const anchor = toRight ? 'start' : 'end';
          return (
            <g key={node.key}>
              <circle
                cx={node.x}
                cy={node.y}
                r={active ? 9 : 6.5}
                fill={active ? 'var(--primary)' : 'var(--surface-1)'}
                stroke="var(--primary)"
                strokeWidth="2"
                style={{ cursor: 'grab' }}
                onPointerDown={onPointerDown(node.key)}
                onPointerMove={onPointerMove(node.key)}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <title>{`${lang === 'en' ? node.labelEn : node.label}: ${value.toFixed(1)} cm`}</title>
              </circle>
              <text x={node.x + dx} y={node.y + 4} textAnchor={anchor} className="figure-node-label">
                {lang === 'en' ? node.labelEn : node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="figure-caption">
        <span>{tx(lang, 'La silueta sigue el sexo del formulario de medidas. Arrastra los nodos hacia fuera para aumentar la medida.', 'The silhouette follows the sex from the measurement form. Drag the nodes outwards to increase the measurement.')}</span>
        {measures.sex === 'unspecified' && (
          <span className="badge badge-muted">
            {tx(lang, 'Sexo sin especificar en los cálculos', 'Sex unspecified in calculations')}
          </span>
        )}
      </div>
    </div>
  );
}
