/**
 * Recomendador de recetas basado en evidencia.
 *
 * Las recetas se construyen con los mismos alimentos y macros que la base de
 * datos (`FOODS`), así que los números que muestra el recomendador son
 * exactamente los que se registran al añadir la receta al diario. No hay una
 * segunda tabla nutricional que pueda desincronizarse.
 *
 * Criterios:
 *  - Déficit: alta proteína (≥1,6–2,2 g/kg), fibra y volumen, densidad
 *    energética baja. La proteína y la fibra son los mejores predictores de
 *    saciedad y de preservación de masa magra en déficit.
 *  - Mantenimiento: reparto equilibrado y variedad de fuentes.
 *  - Superávit: densidad energética moderada-alta y carbohidratos alrededor del
 *    entrenamiento para favorecer la ganancia de peso sin exceso de grasa.
 */
import type { Lang } from './i18n';
import { tx } from './i18n';
import type { Food, FoodLogItem, GoalMode, MealSlot } from './types';
import { FOODS, calcFood } from './foodDb';

export interface RecipeIngredient {
  foodId: string;
  grams: number;
}

export type AllergenId = 'lacteos' | 'huevo' | 'soja' | 'pescado' | 'marisco' | 'sesamo';

export const ALLERGEN_LABELS: Record<AllergenId, [string, string]> = {
  lacteos: ['Lácteos', 'Dairy'],
  huevo: ['Huevo', 'Egg'],
  soja: ['Soja', 'Soy'],
  pescado: ['Pescado', 'Fish'],
  marisco: ['Marisco', 'Shellfish'],
  sesamo: ['Sésamo', 'Sesame'],
};

/** Alérgenos declarados explícitamente por id de alimento (sin inferencia por texto). */
export const ALLERGEN_BY_FOOD: Record<string, AllergenId[]> = {};

for (const id of ['leche_entera', 'leche_semidesnatada', 'leche_desnatada', 'yogur_natural', 'yogur_griego', 'yogur_desnatado', 'queso_fresco', 'queso_curado', 'requeson', 'mantequilla', 'nata', 'kefir', 'chocolate_leche', 'helado_vainilla', 'tarta_queso']) {
  ALLERGEN_BY_FOOD[id] = [...(ALLERGEN_BY_FOOD[id] ?? []), 'lacteos'];
}
for (const id of ['huevo', 'clara_huevo', 'huevo_codorniz', 'mayonesa']) {
  ALLERGEN_BY_FOOD[id] = [...(ALLERGEN_BY_FOOD[id] ?? []), 'huevo'];
}
for (const id of ['tofu', 'tempeh', 'soja_cocida', 'edamame', 'leche_soja', 'salsa_soja']) {
  ALLERGEN_BY_FOOD[id] = [...(ALLERGEN_BY_FOOD[id] ?? []), 'soja'];
}
for (const id of ['salmon', 'atun_fresco', 'atun_agua', 'atun_aceite', 'merluza', 'bacalao', 'dorada', 'lubina', 'sardinas', 'boquerones']) {
  ALLERGEN_BY_FOOD[id] = [...(ALLERGEN_BY_FOOD[id] ?? []), 'pescado'];
}
for (const id of ['gambas', 'langostinos', 'mejillones', 'almejas', 'calamar', 'pulpo']) {
  ALLERGEN_BY_FOOD[id] = [...(ALLERGEN_BY_FOOD[id] ?? []), 'marisco'];
}
ALLERGEN_BY_FOOD['sesamo'] = ['sesamo'];

/** Alérgenos presentes en los ingredientes (sin gluten ni frutos secos por diseño). */
export function allergensFor(recipe: Recipe): AllergenId[] {
  const found = new Set<AllergenId>();
  for (const ingredient of recipe.ingredients) {
    for (const allergen of ALLERGEN_BY_FOOD[ingredient.foodId] ?? []) found.add(allergen);
  }
  return [...found];
}

export interface Recipe {
  id: string;
  name: string;
  goal: GoalMode;
  meal: MealSlot;
  description: string;
  science: string;
  minutes: number;
  servings: number;
  tags: string[];
  ingredients: RecipeIngredient[];
}

export interface RecipeMacros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  grams: number;
  proteinPer100Kcal: number;
  fiberPer100Kcal: number;
}

export interface RecipeSuggestion extends Recipe {
  macros: RecipeMacros;
  fit: 'excellent' | 'good' | 'ok';
  score: number;
}

export const RECIPES: Recipe[] = [
  // ---------------------------------------------------------------- déficit
  {
    id: 'cut-chicken-rice',
    name: 'Bowl de pollo, arroz integral y brócoli',
    goal: 'cut',
    meal: 'comida',
    description: 'Comida completa con proteína magra, carbohidrato integral y verdura voluminosa.',
    science: 'La proteína magra y la fibra del brócoli aumentan la saciedad por caloría; el arroz integral aporta energía estable para entrenar.',
    minutes: 20,
    servings: 1,
    tags: ['alto en proteína', 'meal prep'],
    ingredients: [
      { foodId: 'pollo_pechuga', grams: 150 },
      { foodId: 'arroz_integral', grams: 150 },
      { foodId: 'brocoli', grams: 150 },
      { foodId: 'aceite_oliva', grams: 5 },
    ],
  },
  {
    id: 'cut-oats-protein',
    name: 'Avena proteica con fresas y chía',
    goal: 'cut',
    meal: 'desayuno',
    description: 'Desayuno rápido, dulce y con proteína y fibra suficientes para llegar a la comida.',
    science: 'La avena y la chía aportan fibra soluble (beta-glucano) que enlentece el vaciado gástrico; el suero completa el perfil de aminoácidos.',
    minutes: 8,
    servings: 1,
    tags: ['fibra', 'rápido'],
    ingredients: [
      { foodId: 'avena', grams: 50 },
      { foodId: 'leche_desnatada', grams: 200 },
      { foodId: 'proteina_suero', grams: 25 },
      { foodId: 'fresa', grams: 120 },
      { foodId: 'chia', grams: 10 },
    ],
  },
  {
    id: 'cut-salmon-potato',
    name: 'Salmón al horno con patata y espinaca',
    goal: 'cut',
    meal: 'cena',
    description: 'Cena saciante con omega-3, potasio y verdura de hoja verde.',
    science: 'El salmón aporta EPA/DHA y proteína completa; la patata cocida tiene un índice de saciedad alto por su contenido en agua y almidón resistente.',
    minutes: 30,
    servings: 1,
    tags: ['omega-3', 'sin gluten'],
    ingredients: [
      { foodId: 'salmon', grams: 130 },
      { foodId: 'patata', grams: 200 },
      { foodId: 'espinaca', grams: 100 },
      { foodId: 'aceite_oliva', grams: 5 },
    ],
  },
  {
    id: 'cut-yogurt-bowl',
    name: 'Yogur griego con plátano y chía',
    goal: 'cut',
    meal: 'snack',
    description: 'Snack con proteína, potasio y una porción pequeña de grasa saludable.',
    science: 'El yogur griego duplica la proteína del yogur normal; la chía añade fibra soluble y ácidos grasos con una porción controlada.',
    minutes: 5,
    servings: 1,
    tags: ['snack', 'proteico'],
    ingredients: [
      { foodId: 'yogur_griego', grams: 170 },
      { foodId: 'platano', grams: 100 },
      { foodId: 'chia', grams: 10 },
      { foodId: 'avena', grams: 20 },
    ],
  },

  // ---------------------------------------------------------- mantenimiento
  {
    id: 'maintain-pasta-tuna',
    name: 'Arroz integral con atún y tomate',
    goal: 'maintain',
    meal: 'comida',
    description: 'Plato equilibrado con carbohidrato, proteína y licopeno.',
    science: 'Reparto de macros cercano al 30/40/30: suficiente proteína para mantener masa magra y carbohidrato para reponer glucógeno.',
    minutes: 18,
    servings: 1,
    tags: ['equilibrado', 'económico'],
    ingredients: [
      { foodId: 'arroz_integral', grams: 180 },
      { foodId: 'atun_agua', grams: 120 },
      { foodId: 'tomate', grams: 150 },
      { foodId: 'aceite_oliva', grams: 10 },
    ],
  },
  {
    id: 'maintain-turkey-tacos',
    name: 'Tacos de pavo, alubias y aguacate',
    goal: 'maintain',
    meal: 'cena',
    description: 'Tres tacos con proteína magra, legumbre y grasa saludable.',
    science: 'La combinación de cereal y legumbre mejora el perfil de aminoácidos y aporta fibra fermentable beneficiosa para la microbiota.',
    minutes: 22,
    servings: 1,
    tags: ['fibra', 'mexicano'],
    ingredients: [
      { foodId: 'tortilla_maiz', grams: 90 },
      { foodId: 'pavo_pechuga', grams: 150 },
      { foodId: 'alubias', grams: 120 },
      { foodId: 'pimiento', grams: 80 },
      { foodId: 'aguacate', grams: 40 },
    ],
  },
  {
    id: 'maintain-tofu-quinoa',
    name: 'Tofu salteado con quinoa y pimiento',
    goal: 'maintain',
    meal: 'comida',
    description: 'Opción vegetal completa, rica en fibra y sin colesterol.',
    science: 'La soja es una proteína vegetal completa; la quinoa complementa con aminoácidos y la verdura aporta vitamina C y fibra.',
    minutes: 20,
    servings: 1,
    tags: ['vegetariano', 'fibra'],
    ingredients: [
      { foodId: 'tofu', grams: 180 },
      { foodId: 'quinoa_cocida', grams: 180 },
      { foodId: 'pimiento', grams: 100 },
      { foodId: 'aceite_oliva', grams: 8 },
    ],
  },
  {
    id: 'maintain-tortilla',
    name: 'Tortilla de patata con ensalada verde',
    goal: 'maintain',
    meal: 'cena',
    description: 'Clásico saciante con huevo, patata y hoja verde.',
    science: 'El huevo tiene el mejor perfil de aminoácidos de referencia y la patata cocida es uno de los alimentos con mayor índice de saciedad.',
    minutes: 25,
    servings: 1,
    tags: ['huevo', 'saciante'],
    ingredients: [
      { foodId: 'huevo', grams: 150 },
      { foodId: 'patata', grams: 150 },
      { foodId: 'espinaca', grams: 60 },
      { foodId: 'aceite_oliva', grams: 8 },
    ],
  },

  // ------------------------------------------------------------- superávit
  {
    id: 'bulk-shake',
    name: 'Batido de avena, plátano y suero',
    goal: 'bulk',
    meal: 'desayuno',
    description: 'Desayuno líquido denso en energía para días de mucho volumen.',
    science: 'Los líquidos permiten ingerir más calorías sin saciedad excesiva; la avena y el plátano reponen glucógeno y el suero añade proteína.',
    minutes: 5,
    servings: 1,
    tags: ['alto en calorías', 'post-entreno'],
    ingredients: [
      { foodId: 'avena', grams: 80 },
      { foodId: 'leche_entera', grams: 300 },
      { foodId: 'platano', grams: 120 },
      { foodId: 'semillas_calabaza', grams: 20 },
      { foodId: 'proteina_suero', grams: 30 },
    ],
  },
  {
    id: 'bulk-beef-rice',
    name: 'Arroz con ternera y aguacate',
    goal: 'bulk',
    meal: 'comida',
    description: 'Comida densa con proteína completa, carbohidrato y grasa monoinsaturada.',
    science: 'Un superávit moderado (≈10 %) con 1,6–2,2 g/kg de proteína maximiza la síntesis proteica y limita la ganancia de grasa.',
    minutes: 25,
    servings: 1,
    tags: ['alto en calorías', 'fuerza'],
    ingredients: [
      { foodId: 'arroz_blanco', grams: 250 },
      { foodId: 'filete_ternera', grams: 180 },
      { foodId: 'aguacate', grams: 60 },
      { foodId: 'aceite_oliva', grams: 8 },
    ],
  },
  {
    id: 'bulk-pasta-salmon',
    name: 'Arroz con salmón y queso fresco',
    goal: 'bulk',
    meal: 'cena',
    description: 'Cena energética con omega-3 y proteína de alta calidad.',
    science: 'El arroz alrededor del entrenamiento favorece la recuperación; el salmón aporta grasa antiinflamatoria y el queso fresco calcio y umami.',
    minutes: 22,
    servings: 1,
    tags: ['omega-3', 'recuperación'],
    ingredients: [
      { foodId: 'arroz_blanco', grams: 220 },
      { foodId: 'salmon', grams: 160 },
      { foodId: 'tomate', grams: 100 },
      { foodId: 'aceite_oliva', grams: 12 },
      { foodId: 'queso_parmesano', grams: 10 },
    ],
  },
  {
    id: 'bulk-eggs-toast',
    name: 'Huevos, tortilla de maíz y aguacate',
    goal: 'bulk',
    meal: 'desayuno',
    description: 'Desayuno sólido con proteína, grasa y carbohidrato para empezar con energía.',
    science: 'Reparte la proteína en 3–4 tomas de 0,4 g/kg para estimular la síntesis proteica a lo largo del día; este desayuno cubre una de ellas.',
    minutes: 12,
    servings: 1,
    tags: ['proteico', 'rápido'],
    ingredients: [
      { foodId: 'huevo', grams: 150 },
      { foodId: 'tortilla_maiz', grams: 70 },
      { foodId: 'aguacate', grams: 50 },
      { foodId: 'platano', grams: 100 },
    ],
  },
  {
    id: 'extra-01',
    name: 'Bowl de pollo, arroz integral y brócoli',
    goal: 'cut',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 12,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'pollo_pechuga', grams: 120 },{ foodId: 'arroz_integral', grams: 100 },{ foodId: 'brocoli', grams: 120 },{ foodId: 'aceite_oliva', grams: 10 }
    ],
  },
  {
    id: 'extra-02',
    name: 'Bowl de pavo, patata y calabacín',
    goal: 'maintain',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 13,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'pavo_pechuga', grams: 135 },{ foodId: 'patata', grams: 120 },{ foodId: 'calabacin', grams: 130 },{ foodId: 'aguacate', grams: 15 }
    ],
  },
  {
    id: 'extra-03',
    name: 'Bowl de ternera, tortilla de maíz y champiñón',
    goal: 'bulk',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 14,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'ternera_solomillo', grams: 150 },{ foodId: 'tortilla_maiz', grams: 140 },{ foodId: 'champinon', grams: 140 },{ foodId: 'chia', grams: 20 }
    ],
  },
  {
    id: 'extra-04',
    name: 'Ensalada de huevo con tomate y arroz integral',
    goal: 'cut',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 15,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'huevo', grams: 165 },{ foodId: 'arroz_integral', grams: 160 },{ foodId: 'tomate', grams: 150 },{ foodId: 'lino', grams: 10 }
    ],
  },
  {
    id: 'extra-05',
    name: 'Bowl de tofu, patata y zanahoria',
    goal: 'maintain',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 16,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'tofu', grams: 180 },{ foodId: 'patata', grams: 100 },{ foodId: 'zanahoria', grams: 160 },{ foodId: 'sesamo', grams: 15 }
    ],
  },
  {
    id: 'extra-06',
    name: 'Bowl de tempeh, tortilla de maíz y alcachofa',
    goal: 'bulk',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 17,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'tempeh', grams: 120 },{ foodId: 'tortilla_maiz', grams: 120 },{ foodId: 'alcachofa', grams: 170 },{ foodId: 'aceitunas', grams: 20 }
    ],
  },
  {
    id: 'extra-07',
    name: 'Bowl de salmón, arroz integral y pimiento',
    goal: 'cut',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 18,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'salmon', grams: 135 },{ foodId: 'arroz_integral', grams: 140 },{ foodId: 'pimiento', grams: 120 },{ foodId: 'aceite_oliva', grams: 10 }
    ],
  },
  {
    id: 'extra-08',
    name: 'Ensalada de atún con lechuga y patata',
    goal: 'maintain',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 19,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'atun_fresco', grams: 150 },{ foodId: 'patata', grams: 160 },{ foodId: 'lechuga', grams: 130 },{ foodId: 'aguacate', grams: 15 }
    ],
  },
  {
    id: 'extra-09',
    name: 'Bowl de merluza, tortilla de maíz y espinaca',
    goal: 'bulk',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 20,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'merluza', grams: 165 },{ foodId: 'tortilla_maiz', grams: 100 },{ foodId: 'espinaca', grams: 140 },{ foodId: 'chia', grams: 20 }
    ],
  },
  {
    id: 'extra-10',
    name: 'Bowl de gambas, arroz integral y berenjena',
    goal: 'cut',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 21,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'gambas', grams: 180 },{ foodId: 'arroz_integral', grams: 120 },{ foodId: 'berenjena', grams: 150 },{ foodId: 'lino', grams: 10 }
    ],
  },
  {
    id: 'extra-11',
    name: 'Bowl de queso fresco, patata y espárrago',
    goal: 'maintain',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 22,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'queso_fresco', grams: 120 },{ foodId: 'patata', grams: 140 },{ foodId: 'esparrago', grams: 160 },{ foodId: 'sesamo', grams: 15 }
    ],
  },
  {
    id: 'extra-12',
    name: 'Ensalada de yogur griego con pepino y tortilla de maíz',
    goal: 'bulk',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 23,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'yogur_griego', grams: 135 },{ foodId: 'tortilla_maiz', grams: 160 },{ foodId: 'pepino', grams: 170 },{ foodId: 'aceitunas', grams: 20 }
    ],
  },
  {
    id: 'extra-13',
    name: 'Bowl de suero, arroz integral y coliflor',
    goal: 'cut',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 24,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'proteina_suero', grams: 150 },{ foodId: 'arroz_integral', grams: 100 },{ foodId: 'coliflor', grams: 120 },{ foodId: 'aceite_oliva', grams: 10 }
    ],
  },
  {
    id: 'extra-14',
    name: 'Bowl de pollo, patata y brócoli',
    goal: 'maintain',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 25,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'pollo_pechuga', grams: 165 },{ foodId: 'patata', grams: 120 },{ foodId: 'brocoli', grams: 130 },{ foodId: 'aguacate', grams: 15 }
    ],
  },
  {
    id: 'extra-15',
    name: 'Bowl de pavo, tortilla de maíz y calabacín',
    goal: 'bulk',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 26,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'pavo_pechuga', grams: 180 },{ foodId: 'tortilla_maiz', grams: 140 },{ foodId: 'calabacin', grams: 140 },{ foodId: 'chia', grams: 20 }
    ],
  },
  {
    id: 'extra-16',
    name: 'Ensalada de ternera con champiñón y arroz integral',
    goal: 'cut',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 27,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'ternera_solomillo', grams: 120 },{ foodId: 'arroz_integral', grams: 160 },{ foodId: 'champinon', grams: 150 },{ foodId: 'lino', grams: 10 }
    ],
  },
  {
    id: 'extra-17',
    name: 'Bowl de huevo, patata y tomate',
    goal: 'maintain',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 28,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'huevo', grams: 135 },{ foodId: 'patata', grams: 100 },{ foodId: 'tomate', grams: 160 },{ foodId: 'sesamo', grams: 15 }
    ],
  },
  {
    id: 'extra-18',
    name: 'Bowl de tofu, tortilla de maíz y zanahoria',
    goal: 'bulk',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 29,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'tofu', grams: 150 },{ foodId: 'tortilla_maiz', grams: 120 },{ foodId: 'zanahoria', grams: 170 },{ foodId: 'aceitunas', grams: 20 }
    ],
  },
  {
    id: 'extra-19',
    name: 'Bowl de tempeh, arroz integral y alcachofa',
    goal: 'cut',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 30,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'tempeh', grams: 165 },{ foodId: 'arroz_integral', grams: 140 },{ foodId: 'alcachofa', grams: 120 },{ foodId: 'aceite_oliva', grams: 10 }
    ],
  },
  {
    id: 'extra-20',
    name: 'Ensalada de salmón con pimiento y patata',
    goal: 'maintain',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 31,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'salmon', grams: 180 },{ foodId: 'patata', grams: 160 },{ foodId: 'pimiento', grams: 130 },{ foodId: 'aguacate', grams: 15 }
    ],
  },
  {
    id: 'extra-21',
    name: 'Bowl de atún, tortilla de maíz y lechuga',
    goal: 'bulk',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 12,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'atun_fresco', grams: 120 },{ foodId: 'tortilla_maiz', grams: 100 },{ foodId: 'lechuga', grams: 140 },{ foodId: 'chia', grams: 20 }
    ],
  },
  {
    id: 'extra-22',
    name: 'Bowl de merluza, arroz integral y espinaca',
    goal: 'cut',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 13,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'merluza', grams: 135 },{ foodId: 'arroz_integral', grams: 120 },{ foodId: 'espinaca', grams: 150 },{ foodId: 'lino', grams: 10 }
    ],
  },
  {
    id: 'extra-23',
    name: 'Bowl de gambas, patata y berenjena',
    goal: 'maintain',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 14,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'gambas', grams: 150 },{ foodId: 'patata', grams: 140 },{ foodId: 'berenjena', grams: 160 },{ foodId: 'sesamo', grams: 15 }
    ],
  },
  {
    id: 'extra-24',
    name: 'Ensalada de queso fresco con espárrago y tortilla de maíz',
    goal: 'bulk',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 15,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'queso_fresco', grams: 165 },{ foodId: 'tortilla_maiz', grams: 160 },{ foodId: 'esparrago', grams: 170 },{ foodId: 'aceitunas', grams: 20 }
    ],
  },
  {
    id: 'extra-25',
    name: 'Bowl de yogur griego, arroz integral y pepino',
    goal: 'cut',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 16,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'yogur_griego', grams: 180 },{ foodId: 'arroz_integral', grams: 100 },{ foodId: 'pepino', grams: 120 },{ foodId: 'aceite_oliva', grams: 10 }
    ],
  },
  {
    id: 'extra-26',
    name: 'Bowl de suero, patata y coliflor',
    goal: 'maintain',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 17,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'proteina_suero', grams: 120 },{ foodId: 'patata', grams: 120 },{ foodId: 'coliflor', grams: 130 },{ foodId: 'aguacate', grams: 15 }
    ],
  },
  {
    id: 'extra-27',
    name: 'Bowl de pollo, tortilla de maíz y brócoli',
    goal: 'bulk',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 18,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'pollo_pechuga', grams: 135 },{ foodId: 'tortilla_maiz', grams: 140 },{ foodId: 'brocoli', grams: 140 },{ foodId: 'chia', grams: 20 }
    ],
  },
  {
    id: 'extra-28',
    name: 'Ensalada de pavo con calabacín y arroz integral',
    goal: 'cut',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 19,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'pavo_pechuga', grams: 150 },{ foodId: 'arroz_integral', grams: 160 },{ foodId: 'calabacin', grams: 150 },{ foodId: 'lino', grams: 10 }
    ],
  },
  {
    id: 'extra-29',
    name: 'Bowl de ternera, patata y champiñón',
    goal: 'maintain',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 20,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'ternera_solomillo', grams: 165 },{ foodId: 'patata', grams: 100 },{ foodId: 'champinon', grams: 160 },{ foodId: 'sesamo', grams: 15 }
    ],
  },
  {
    id: 'extra-30',
    name: 'Bowl de huevo, tortilla de maíz y tomate',
    goal: 'bulk',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 21,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'huevo', grams: 180 },{ foodId: 'tortilla_maiz', grams: 120 },{ foodId: 'tomate', grams: 170 },{ foodId: 'aceitunas', grams: 20 }
    ],
  },
  {
    id: 'extra-31',
    name: 'Bowl de tofu, arroz integral y zanahoria',
    goal: 'cut',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 22,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'tofu', grams: 120 },{ foodId: 'arroz_integral', grams: 140 },{ foodId: 'zanahoria', grams: 120 },{ foodId: 'aceite_oliva', grams: 10 }
    ],
  },
  {
    id: 'extra-32',
    name: 'Ensalada de tempeh con alcachofa y patata',
    goal: 'maintain',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 23,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'tempeh', grams: 135 },{ foodId: 'patata', grams: 160 },{ foodId: 'alcachofa', grams: 130 },{ foodId: 'aguacate', grams: 15 }
    ],
  },
  {
    id: 'extra-33',
    name: 'Bowl de salmón, tortilla de maíz y pimiento',
    goal: 'bulk',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 24,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'salmon', grams: 150 },{ foodId: 'tortilla_maiz', grams: 100 },{ foodId: 'pimiento', grams: 140 },{ foodId: 'chia', grams: 20 }
    ],
  },
  {
    id: 'extra-34',
    name: 'Bowl de atún, arroz integral y lechuga',
    goal: 'cut',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 25,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'atun_fresco', grams: 165 },{ foodId: 'arroz_integral', grams: 120 },{ foodId: 'lechuga', grams: 150 },{ foodId: 'lino', grams: 10 }
    ],
  },
  {
    id: 'extra-35',
    name: 'Bowl de merluza, patata y espinaca',
    goal: 'maintain',
    meal: 'desayuno',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 26,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'merluza', grams: 180 },{ foodId: 'patata', grams: 140 },{ foodId: 'espinaca', grams: 160 },{ foodId: 'sesamo', grams: 15 }
    ],
  },
  {
    id: 'extra-36',
    name: 'Ensalada de gambas con berenjena y tortilla de maíz',
    goal: 'bulk',
    meal: 'snack',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Aporta densidad energética moderada y carbohidrato alrededor del entrenamiento para recuperar glucógeno sin exceso de grasa.',
    minutes: 27,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'gambas', grams: 120 },{ foodId: 'tortilla_maiz', grams: 160 },{ foodId: 'berenjena', grams: 170 },{ foodId: 'aceitunas', grams: 20 }
    ],
  },
  {
    id: 'extra-37',
    name: 'Bowl de queso fresco, arroz integral y espárrago',
    goal: 'cut',
    meal: 'comida',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Alta saciedad por caloría: proteína magra, fibra de verdura y grasa en porción pequeña.',
    minutes: 28,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'proteico'],
    ingredients: [
      { foodId: 'queso_fresco', grams: 135 },{ foodId: 'arroz_integral', grams: 100 },{ foodId: 'esparrago', grams: 120 },{ foodId: 'aceite_oliva', grams: 10 }
    ],
  },
  {
    id: 'extra-38',
    name: 'Bowl de yogur griego, patata y pepino',
    goal: 'maintain',
    meal: 'cena',
    description: 'Combinación equilibrada de proteína, carbohidrato y verdura con grasa saludable.',
    science: 'Reparte la proteína entre comidas y acompáñala de fibra y grasa insoluble para mantener la saciedad y la masa magra.',
    minutes: 29,
    servings: 1,
    tags: ['sin gluten', 'sin frutos secos', 'equilibrado'],
    ingredients: [
      { foodId: 'yogur_griego', grams: 150 },{ foodId: 'patata', grams: 120 },{ foodId: 'pepino', grams: 130 },{ foodId: 'aguacate', grams: 15 }
    ],
  },
];

const FOOD_MAP = new Map(FOODS.map((food) => [food.id, food]));

interface RecipeTranslation {
  name: string;
  description: string;
  science: string;
  tags: string[];
}

const RECIPE_EN: Record<string, RecipeTranslation> = {
  'cut-chicken-rice': {
    name: 'Chicken, brown rice and broccoli bowl',
    description: 'Complete meal with lean protein, whole-grain carbs and high-volume vegetables.',
    science: 'Lean protein and broccoli fiber increase satiety per calorie; brown rice provides steady energy for training.',
    tags: ['high protein', 'meal prep'],
  },
  'cut-oats-protein': {
    name: 'Protein oats with strawberries and chia',
    description: 'Quick, sweet breakfast with enough protein and fiber to get you to lunch.',
    science: 'Oats and chia provide soluble fiber (beta-glucan) that slows gastric emptying; whey completes the amino acid profile.',
    tags: ['fiber', 'quick'],
  },
  'cut-salmon-potato': {
    name: 'Baked salmon with potato and spinach',
    description: 'Filling dinner with omega-3, potassium and leafy greens.',
    science: 'Salmon provides EPA/DHA and complete protein; boiled potato has a high satiety index thanks to its water and resistant starch.',
    tags: ['omega-3', 'gluten free'],
  },
  'cut-yogurt-bowl': {
    name: 'Greek yogurt with banana and chia',
    description: 'Snack with protein, potassium and a small portion of healthy fat.',
    science: 'Greek yogurt has twice the protein of regular yogurt; chia adds fatty acids and fiber in a controlled portion.',
    tags: ['snack', 'protein'],
  },
  'maintain-pasta-tuna': {
    name: 'Brown rice with tuna and tomato',
    description: 'Balanced dish with carbs, protein and lycopene.',
    science: 'Macro split close to 30/40/30: enough protein to maintain lean mass and carbs to replenish glycogen.',
    tags: ['balanced', 'budget'],
  },
  'maintain-turkey-tacos': {
    name: 'Turkey, bean and avocado tacos',
    description: 'Three tacos with lean protein, legumes and healthy fat.',
    science: 'Combining grain and legumes improves the amino acid profile and provides fermentable fiber that benefits the microbiota.',
    tags: ['fiber', 'mexican'],
  },
  'maintain-tofu-quinoa': {
    name: 'Sautéed tofu with quinoa and pepper',
    description: 'Complete plant-based option, rich in fiber and cholesterol free.',
    science: 'Soy is a complete plant protein; quinoa complements it with amino acids and the vegetables add vitamin C and fiber.',
    tags: ['vegetarian', 'fiber'],
  },
  'maintain-tortilla': {
    name: 'Potato omelette with green salad',
    description: 'Filling classic with egg, potato and leafy greens.',
    science: 'Egg has the best reference amino acid profile and boiled potato is one of the highest-satiety foods.',
    tags: ['egg', 'filling'],
  },
  'bulk-shake': {
    name: 'Oat, banana and peanut shake',
    description: 'Energy-dense liquid breakfast for high-volume days.',
    science: 'Liquids let you take in more calories without excessive fullness; oats and banana replenish glycogen and whey adds protein.',
    tags: ['high calorie', 'post-workout'],
  },
  'bulk-beef-rice': {
    name: 'Rice with beef and avocado',
    description: 'Dense meal with complete protein, carbs and monounsaturated fat.',
    science: 'A moderate surplus (≈10%) with 1.6–2.2 g/kg of protein maximizes protein synthesis and limits fat gain.',
    tags: ['high calorie', 'strength'],
  },
  'bulk-pasta-salmon': {
    name: 'Rice with salmon and fresh cheese',
    description: 'Energetic dinner with omega-3 and high-quality protein.',
    science: 'Rice around training supports recovery; salmon provides anti-inflammatory fat and fresh cheese adds calcium and umami.',
    tags: ['omega-3', 'recovery'],
  },
  'bulk-eggs-toast': {
    name: 'Eggs, corn tortilla and avocado',
    description: 'Solid breakfast with protein, fat and carbs to start with energy.',
    science: 'Spread protein across 3–4 servings of 0.4 g/kg to stimulate protein synthesis throughout the day; this breakfast covers one.',
    tags: ['protein', 'quick'],
  },
  'extra-01': {
    name: 'Chicken, brown rice and broccoli bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-02': {
    name: 'Turkey, potato and zucchini bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-03': {
    name: 'Beef, corn tortilla and mushroom bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-04': {
    name: 'Egg salad with tomato and brown rice',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-05': {
    name: 'Tofu, potato and carrot bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-06': {
    name: 'Tempeh, corn tortilla and artichoke bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-07': {
    name: 'Salmon, brown rice and bell pepper bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-08': {
    name: 'Tuna salad with lettuce and potato',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-09': {
    name: 'Hake, corn tortilla and spinach bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-10': {
    name: 'Shrimp, brown rice and eggplant bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-11': {
    name: 'Fresh cheese, potato and asparagus bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-12': {
    name: 'Greek yogurt salad with cucumber and corn tortilla',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-13': {
    name: 'Whey, brown rice and cauliflower bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-14': {
    name: 'Chicken, potato and broccoli bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-15': {
    name: 'Turkey, corn tortilla and zucchini bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-16': {
    name: 'Beef salad with mushroom and brown rice',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-17': {
    name: 'Egg, potato and tomato bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-18': {
    name: 'Tofu, corn tortilla and carrot bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-19': {
    name: 'Tempeh, brown rice and artichoke bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-20': {
    name: 'Salmon salad with bell pepper and potato',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-21': {
    name: 'Tuna, corn tortilla and lettuce bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-22': {
    name: 'Hake, brown rice and spinach bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-23': {
    name: 'Shrimp, potato and eggplant bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-24': {
    name: 'Fresh cheese salad with asparagus and corn tortilla',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-25': {
    name: 'Greek yogurt, brown rice and cucumber bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-26': {
    name: 'Whey, potato and cauliflower bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-27': {
    name: 'Chicken, corn tortilla and broccoli bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-28': {
    name: 'Turkey salad with zucchini and brown rice',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-29': {
    name: 'Beef, potato and mushroom bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-30': {
    name: 'Egg, corn tortilla and tomato bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-31': {
    name: 'Tofu, brown rice and carrot bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-32': {
    name: 'Tempeh salad with artichoke and potato',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-33': {
    name: 'Salmon, corn tortilla and bell pepper bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-34': {
    name: 'Tuna, brown rice and lettuce bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-35': {
    name: 'Hake, potato and spinach bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
  'extra-36': {
    name: 'Shrimp salad with eggplant and corn tortilla',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Provides moderate energy density and carbs around training to replenish glycogen without excess fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-37': {
    name: 'Fresh cheese, brown rice and asparagus bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'High satiety per calorie: lean protein, vegetable fiber and a small portion of fat.',
    tags: ['gluten free', 'nut free', 'protein'],
  },
  'extra-38': {
    name: 'Greek yogurt, potato and cucumber bowl',
    description: 'Balanced combination of protein, carbohydrate and vegetables with healthy fat.',
    science: 'Spread protein across meals and pair it with fiber and insoluble fat to maintain satiety and lean mass.',
    tags: ['gluten free', 'nut free', 'balanced'],
  },
};

/** Devuelve la receta con textos en el idioma activo. */
export function localizedRecipe(recipe: Recipe, lang: Lang = 'es'): Recipe {
  if (lang !== 'en') return recipe;
  const translation = RECIPE_EN[recipe.id];
  return translation ? { ...recipe, ...translation } : recipe;
}


export function recipeFoods(recipe: Recipe): Array<{ food: Food; grams: number }> {
  return recipe.ingredients
    .map((ingredient) => {
      const food = FOOD_MAP.get(ingredient.foodId);
      return food ? { food, grams: ingredient.grams } : null;
    })
    .filter((entry): entry is { food: Food; grams: number } => entry !== null);
}

export function recipeMacros(recipe: Recipe): RecipeMacros {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, grams: 0 };
  for (const { food, grams } of recipeFoods(recipe)) {
    const value = calcFood(food, grams, 'g');
    totals.kcal += value.kcal;
    totals.protein += value.protein;
    totals.carbs += value.carbs;
    totals.fat += value.fat;
    totals.fiber += value.fiber;
    totals.grams += value.grams;
  }
  const servings = Math.max(1, recipe.servings || 1);
  const kcal = Math.round(totals.kcal / servings);
  return {
    kcal,
    protein: round1(totals.protein / servings),
    carbs: round1(totals.carbs / servings),
    fat: round1(totals.fat / servings),
    fiber: round1(totals.fiber / servings),
    grams: Math.round(totals.grams / servings),
    proteinPer100Kcal: kcal > 0 ? round1(((totals.protein / servings) * 100) / kcal) : 0,
    fiberPer100Kcal: kcal > 0 ? round1(((totals.fiber / servings) * 100) / kcal) : 0,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface RemainingMacros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Ordena las recetas por encima del objetivo y por ajuste a lo que queda del
 * día. `remaining` es opcional: sin diario, prioriza el criterio del objetivo.
 */
export function recommendRecipes(
  goal: GoalMode,
  remaining?: Partial<RemainingMacros> | null,
  limit = 4,
  lang: Lang = 'es',
  seed = 0,
): RecipeSuggestion[] {
  const safe = RECIPES.filter((recipe) =>
    recipe.ingredients.every((ingredient) => !isGlutenOrNut(ingredient.foodId)),
  );
  const ranked = safe.map((recipe) => {
    const macros = recipeMacros(recipe);
    let score = recipe.goal === goal ? 60 : 20;
    const proteinPerKg = macros.proteinPer100Kcal;

    if (goal === 'cut') {
      score += proteinPerKg * 18;
      score += Math.min(12, macros.fiberPer100Kcal * 26);
      if (macros.kcal > 750) score -= 10;
    } else if (goal === 'bulk') {
      score += Math.min(14, macros.kcal / 60);
      score += Math.min(10, macros.protein * 0.18);
      if (macros.kcal < 450) score -= 6;
    } else {
      score += Math.min(12, macros.protein * 0.2);
      score += Math.min(8, macros.fiber * 0.4);
    }

    if (remaining) {
      const kcal = Math.max(0, Number(remaining.kcal) || 0);
      const protein = Math.max(0, Number(remaining.protein) || 0);
      if (kcal > 0) {
        score += Math.max(0, 18 - (Math.abs(macros.kcal - kcal) / Math.max(200, kcal)) * 18);
      }
      if (protein > 0) {
        score += Math.max(0, 16 - (Math.abs(macros.protein - protein * 0.5) / Math.max(15, protein)) * 16);
      }
    }

    const fit: RecipeSuggestion['fit'] = score >= 82 ? 'excellent' : score >= 62 ? 'good' : 'ok';
    return { ...localizedRecipe(recipe, lang), macros, fit, score: Math.round(score) };
  })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const poolSize = Math.min(12, ranked.length);
  const start = poolSize ? seed % poolSize : 0;
  return Array.from({ length: Math.min(Math.max(1, limit), poolSize) }, (_, index) =>
    ranked[(start + index) % poolSize],
  );
}

/** Ninguna receta recomendada contiene gluten ni frutos secos. */
export function isGlutenOrNut(foodId: string): boolean {
  return /^(pan|pasta|cuscus|bulgur|harina_trigo|tortilla_trigo|bagel|galleta|croissant|magdalena|seitan|almendra|nuez|avellana|pistacho|anacardo|cacahuete|crema_cacahuete|leche_almendra|muesli)/.test(foodId);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `recipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Convierte una receta en alimentos registrables, usando el mismo motor de macros. */
export function recipeLogItems(recipe: Recipe, meal: MealSlot = recipe.meal): FoodLogItem[] {
  const servings = Math.max(1, recipe.servings || 1);
  return recipeFoods(recipe).map(({ food, grams }) => {
    const perServing = grams / servings;
    const value = calcFood(food, perServing, 'g');
    return {
      id: newId(),
      foodId: food.id,
      name: food.name,
      category: food.category,
      meal,
      quantity: perServing,
      unit: 'g',
      ...value,
    };
  });
}

export function goalLabel(goal: GoalMode, lang: Lang = 'es'): string {
  if (goal === 'cut') return tx(lang, 'Déficit', 'Cut');
  if (goal === 'bulk') return tx(lang, 'Superávit', 'Bulk');
  return tx(lang, 'Mantenimiento', 'Maintenance');
}
