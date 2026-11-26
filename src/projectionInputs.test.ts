import { describe, expect, it } from 'vitest';
import { autoIntakeEntries, autoIntakeSummary } from './projectionInputs';
import type { VaultEvent } from './types';

function ev(date: string, kcal: number, enabled = true): VaultEvent {
  return {
    id: `auto-${date}`,
    device_id: 'test',
    timestamp: `${date}T12:00:00.000Z`,
    kind: 'intake.auto',
    payload: { date, enabled, kcal, protein: 100, carbs: 200, fat: 60, fiber: 25 },
  };
}

describe('autoIntakeSummary', () => {
  it('requiere al menos 5 días activos en los últimos 30', () => {
    const today = new Date('2026-11-26T12:00:00.000Z');
    const four = Array.from({ length: 4 }, (_, i) => ev(`2026-11-${String(23 - i).padStart(2, '0')}`, 2000));
    expect(autoIntakeSummary(four, today).days).toBe(4);
    const five = [...four, ev('2026-11-19', 2200)];
    const summary = autoIntakeSummary(five, today);
    expect(summary.days).toBe(5);
    expect(summary.avg).toBe(2040);
    expect(summary.enabledToday).toBe(false);
  });

  it('ignora días desactivados y respeta el último evento del día', () => {
    const today = new Date('2026-11-26T12:00:00.000Z');
    const events = [
      ev('2026-11-26', 2000, true),
      ev('2026-11-26', 0, false),
      ev('2026-11-25', 1800),
    ];
    const summary = autoIntakeSummary(events, today);
    expect(summary.enabledToday).toBe(false);
    expect(summary.days).toBe(1);
  });
});

describe('autoIntakeEntries', () => {
  it('permite corregir y cancelar un día con un evento posterior', () => {
    const today = new Date('2026-11-26T12:00:00.000Z');
    const events = [
      ev('2026-11-20', 2100),
      ev('2026-11-20', 1700),
      ev('2026-11-21', 2000, false),
    ];
    const entries = autoIntakeEntries(events, today);
    expect(entries.find((entry) => entry.date === '2026-11-20')?.kcal).toBe(1700);
    expect(entries.find((entry) => entry.date === '2026-11-21')?.enabled).toBe(false);
    expect(autoIntakeSummary(events, today).days).toBe(1);
  });
});
