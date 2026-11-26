import type { Lang } from './i18n';

/** Nombres cortos de los días de la semana, empezando por el domingo. */
const DAY_NAMES_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayNames(lang: Lang): string[] {
  return lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_ES;
}
