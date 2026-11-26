/**
 * Platos sencillos con valores de referencia (USDA FoodData Central, valores
 * típicos por 100 g). Se usan como anclas dentro de los 500 platos: el resto
 * son estimaciones por composición y están marcados como `estimate`.
 */
import type { FoodRow } from '../foodDb';

export const REFERENCE_DISH_ROWS: FoodRow[] = [
  ['ref_grilled_chicken', 'Pollo a la plancha', 'carne', 165, 31, 0, 3.6, 0, { porcion: 150 }, 'reference', 0.85],
  ['ref_cooked_rice', 'Arroz blanco cocido', 'cereal', 130, 2.7, 28, 0.3, 0.4, { porcion: 180 }, 'reference', 0.85],
  ['ref_steamed_broccoli', 'Brócoli al vapor', 'verdura', 35, 2.4, 7.2, 0.4, 3.3, { porcion: 150 }, 'reference', 0.85],
  ['ref_scrambled_egg', 'Huevo revuelto', 'huevo', 148, 11, 1.6, 11, 0, { porcion: 120 }, 'reference', 0.85],
  ['ref_baked_salmon', 'Salmón al horno', 'pescado', 206, 22, 0, 12, 0, { porcion: 150 }, 'reference', 0.85],
  ['ref_cooked_lentils', 'Lentejas cocidas', 'legumbre', 116, 9, 20, 0.4, 7.9, { porcion: 200 }, 'reference', 0.85],
  ['ref_baked_potato', 'Patata asada', 'verdura', 93, 2.5, 21, 0.1, 2.2, { porcion: 200 }, 'reference', 0.85],
  ['ref_greek_yogurt_fruit', 'Yogur griego con fruta', 'lacteo', 97, 9, 12, 2, 1, { porcion: 180 }, 'reference', 0.85],
];
