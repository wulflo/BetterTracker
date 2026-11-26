import { describe, expect, it } from 'vitest';
import { RECIPES, allergensFor, isGlutenOrNut, localizedRecipe, recipeLogItems, recipeMacros, recommendRecipes } from './recipes';

describe('recetas', () => {
  it('calcula los macros con la misma base de alimentos que el diario', () => {
    for (const recipe of RECIPES) {
      const macros = recipeMacros(recipe);
      const items = recipeLogItems(recipe);
      const totals = items.reduce(
        (acc, item) => ({
          kcal: acc.kcal + item.kcal,
          protein: acc.protein + item.protein,
          carbs: acc.carbs + item.carbs,
          fat: acc.fat + item.fat,
          fiber: acc.fiber + item.fiber,
        }),
        { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      );
      expect(macros.kcal).toBe(Math.round(totals.kcal / recipe.servings));
      expect(macros.protein).toBeCloseTo(totals.protein / recipe.servings, 1);
      expect(macros.carbs).toBeCloseTo(totals.carbs / recipe.servings, 1);
      expect(macros.fat).toBeCloseTo(totals.fat / recipe.servings, 1);
      expect(macros.fiber).toBeCloseTo(totals.fiber / recipe.servings, 1);
    }
  });

  it('prioriza recetas de déficit con alta proteína por caloría', () => {
    const suggestions = recommendRecipes('cut', { kcal: 500, protein: 40 }, 3);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].goal).toBe('cut');
    expect(suggestions[0].macros.proteinPer100Kcal).toBeGreaterThan(6);
    expect(suggestions[0].score).toBeGreaterThanOrEqual(suggestions[1].score);
  });

  it('prioriza densidad energética en superávit', () => {
    const suggestions = recommendRecipes('bulk', { kcal: 900, protein: 40 }, 3);
    expect(suggestions[0].goal).toBe('bulk');
  });

  it('devuelve alimentos registrables con identificadores únicos', () => {
    const items = recipeLogItems(RECIPES[0], 'comida');
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.every((item) => item.meal === 'comida' && item.unit === 'g')).toBe(true);
  });
});

describe('catálogo ampliado de recetas', () => {
  it('tiene al menos 50 recetas sin gluten ni frutos secos', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(50);
    for (const recipe of RECIPES) {
      expect(recipe.ingredients.every((i) => !isGlutenOrNut(i.foodId))).toBe(true);
    }
    expect(isGlutenOrNut('pan_integral')).toBe(true);
    expect(isGlutenOrNut('almendra')).toBe(true);
    expect(isGlutenOrNut('arroz_integral')).toBe(false);
  });

  it('rota los resultados al azar de tres en tres', () => {
    const a = recommendRecipes('cut', undefined, 3, 'es', 0).map((r) => r.id);
    const b = recommendRecipes('cut', undefined, 3, 'es', 1).map((r) => r.id);
    const c = recommendRecipes('cut', undefined, 3, 'es', 2).map((r) => r.id);
    expect(new Set([...a, ...b, ...c]).size).toBeGreaterThan(3);
    expect(a).toHaveLength(3);
  });

  it('detecta alérgenos sin incluir gluten ni frutos secos', () => {
    const recipe = RECIPES.find((r) => r.ingredients.some((i) => i.foodId.startsWith('gambas')))!;
    expect(allergensFor(recipe)).toContain('marisco');
    expect(allergensFor(recipe)).not.toContain('lacteos');
  });
});

describe('traducción de recetas al inglés', () => {
  // Detecta tanto texto en español como traducciones mecánicas a medias
  // ("Bowl de chicken", "... fibra de verdura and grasa ...").
  // La «é» se excluye porque «Sautéed» es inglés correcto.
  const spanish = /\b(de|la|las|los|con|para|entre|por|una|sin)\b|[áíóúñ]/i;

  it('ofrece nombre, descripción, ciencia y etiquetas en inglés para cada receta', () => {
    for (const recipe of RECIPES) {
      const en = localizedRecipe(recipe, 'en');
      expect(en).not.toBe(recipe);
      expect(spanish.test(`${en.name} ${en.description} ${en.science} ${en.tags.join(' ')}`)).toBe(false);
    }
  });

  it('las sugerencias recomendadas llegan traducidas', () => {
    for (const recipe of recommendRecipes('cut', undefined, 3, 'en', 0)) {
      expect(spanish.test(`${recipe.name} ${recipe.description} ${recipe.science}`)).toBe(false);
    }
  });

  it('conserva el texto original en español', () => {
    for (const recipe of RECIPES) expect(localizedRecipe(recipe, 'es')).toBe(recipe);
  });
});
