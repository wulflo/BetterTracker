import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Food, FoodCategory, FoodLogItem, MealSlot } from '../types';
import {
  calcFood,
  categoryLabel,
  defaultQuantity,
  findFoodByBarcode,
  foodUnits,
  mealTotals,
  isGtinLength,
  normalizeBarcode,
  looksLikeBarcodeInput,
  resizeFoodLogItem,
  searchFoods,
  unitLabel,
  validBarcodeChecksum,
  localizedFoodName,
  foodCategories,
  mealSlots,
} from '../foodDb';
import { useLanguage, tx } from '../i18n';
import { isTauri, lookupBarcode, searchFoodsRemote } from '../vault';
import { lookupBarcodeCatalog } from '../barcodeCatalog';
import { errorText } from '../errors';
import Select from './Select';
import { NumberInput } from './Fields';
import { Icon } from './Icons';

interface Props {
  foods: Food[];
  items: FoodLogItem[];
  onAdd: (item: FoodLogItem) => void;
  onUpdate: (item: FoodLogItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCreateFood: (food: Food) => Promise<void>;
}

function preferredUnit(food: Food): string {
  const units = foodUnits(food);
  if (units.includes('ml') && ['bebida', 'lacteo', 'grasa', 'condimento'].includes(food.category)) {
    return 'ml';
  }
  return 'g';
}

export default function FoodLog({ foods, items, onAdd, onUpdate, onRemove, onClear, onCreateFood }: Props) {
  const { lang } = useLanguage();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(foods[0]?.id ?? '');
  const [quantity, setQuantity] = useState(100);
  const [unit, setUnit] = useState('g');
  const [meal, setMeal] = useState<MealSlot>('desayuno');
  const [customOpen, setCustomOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [editUnit, setEditUnit] = useState('g');
  const [editMeal, setEditMeal] = useState<MealSlot>('desayuno');
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeError, setBarcodeError] = useState('');
  const [barcodeNotice, setBarcodeNotice] = useState<string | null>(null);
  const [remoteResults, setRemoteResults] = useState<Food[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const remoteRequest = useRef(0);
  const [lookupFood, setLookupFood] = useState<Food | null>(null);
  const [checksumHold, setChecksumHold] = useState<string | null>(null);
  const [custom, setCustom] = useState({
    name: '',
    category: 'otro' as FoodCategory,
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    unitGrams: 0,
    barcode: '',
  });

  const selected = foods.find((food) => food.id === selectedId)
    ?? (lookupFood?.id === selectedId ? lookupFood : null);
  const units = selected ? foodUnits(selected) : ['g'];
  const preview = selected ? calcFood(selected, quantity, unit) : null;
  const totals = mealTotals(items);
  const results = useMemo(() => searchFoods(foods, query, 8, lang), [foods, query, lang]);

  const foodFor = (item: FoodLogItem): Food | undefined =>
    foods.find((food) => food.id === item.foodId)
    ?? (lookupFood?.id === item.foodId ? lookupFood : undefined);

  const displayName = (food: Food): string => localizedFoodName(food, lang);
  const displayItemName = (item: FoodLogItem): string => {
    const food = foodFor(item);
    return food ? localizedFoodName(food, lang) : item.name;
  };

  useEffect(() => {
    if (foods.some((food) => food.id === selectedId)) return;
    if (lookupFood && lookupFood.id === selectedId) return;
    const first = foods[0];
    if (first) {
      setSelectedId(first.id);
      setUnit(preferredUnit(first));
      setQuantity(defaultQuantity(preferredUnit(first)));
    }
  }, [foods, selectedId, lookupFood]);

  const chooseFood = (food: Food) => {
    setSelectedId(food.id);
    const nextUnit = preferredUnit(food);
    setUnit(nextUnit);
    setQuantity(defaultQuantity(nextUnit));
    setQuery(food.name);
  };

  const changeUnit = (nextUnit: string) => {
    setUnit(nextUnit);
    setQuantity(defaultQuantity(nextUnit));
  };

  const addFood = (food: Food, qty: number, unitValue: string) => {
    const calc = calcFood(food, qty, unitValue);
    onAdd({
      id: crypto.randomUUID(),
      foodId: food.id,
      name: food.name,
      category: food.category,
      meal,
      quantity: qty,
      unit: unitValue,
      grams: calc.grams,
      kcal: calc.kcal,
      protein: calc.protein,
      carbs: calc.carbs,
      fat: calc.fat,
      fiber: calc.fiber,
    });
  };

  const add = () => {
    if (!selected || !preview) return;
    addFood(selected, quantity, unit);
  };

  // Igual que el patrón DOI de SinNotas: cada resultado de la base de datos se
  // puede añadir directamente sin bajar al formulario de porción.
  const addFromSearch = (food: Food) => {
    const nextUnit = preferredUnit(food);
    const qty = defaultQuantity(nextUnit);
    addFood(food, qty, nextUnit);
    setSelectedId(food.id);
    setUnit(nextUnit);
    setQuantity(qty);
    setQuery(food.name);
  };

  const addRemoteFood = async (food: Food) => {
    try {
      // Se guarda en la bóveda como alimento personalizado: sus macros quedan
      // disponibles sin red y se reutilizan en búsquedas futuras.
      await onCreateFood(food);
      addFromSearch(food);
    } catch (e) {
      setRemoteError(errorText(e));
    }
  };

  const isBarcodeQuery = (value: string): boolean => looksLikeBarcodeInput(value);

  // Un solo campo: si contiene 6–14 dígitos se trata como código de barras;
  // si no, se buscan alimentos en local y, con debounce, en la nube.
  useEffect(() => {
    const value = query.trim();
    const request = ++remoteRequest.current;
    setRemoteError('');
    if (isBarcodeQuery(value) || value.length < 2 || barcodeBusy || checksumHold) {
      setRemoteResults([]);
      setRemoteBusy(false);
      return;
    }
    if (!isTauri()) {
      // La CSP del webview y CORS de OFF impiden esta búsqueda en el navegador.
      setRemoteResults([]);
      setRemoteBusy(false);
      setRemoteError(
        tx(
          lang,
          'La búsqueda en la nube solo está disponible en la app nativa; aquí se busca en tu base local.',
          'Cloud search is only available in the native app; here only your local database is searched.',
        ),
      );
      return;
    }
    setRemoteBusy(true);
    const timer = window.setTimeout(() => {
      void searchFoodsRemote(value)
        .then((foods) => {
          if (request === remoteRequest.current) setRemoteResults(foods);
        })
        .catch(() => {
          if (request === remoteRequest.current) {
            setRemoteResults([]);
            setRemoteError(
              tx(
                lang,
                'Open Food Facts no está disponible ahora. Se muestran solo los resultados locales.',
                'Open Food Facts is unavailable right now. Showing local results only.',
              ),
            );
          }
        })
        .finally(() => {
          if (request === remoteRequest.current) setRemoteBusy(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, barcodeBusy, checksumHold, lang]);

  const submitUnified = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (barcodeBusy) return;
    if (isBarcodeQuery(query)) void handleBarcode(query);
  };

  const startEdit = (item: FoodLogItem) => {
    setEditingId(item.id);
    setEditQuantity(item.quantity);
    setEditUnit(item.unit);
    setEditMeal(item.meal);
  };

  const saveEdit = (item: FoodLogItem) => {
    onUpdate(resizeFoodLogItem(item, foodFor(item), editQuantity, editUnit, editMeal));
    setEditingId(null);
  };

  const processBarcode = async (code: string) => {
    setChecksumHold(null);
    setBarcodeError('');
    const local = findFoodByBarcode(foods, code);
    if (local) {
      chooseFood(local);
      setBarcodeNotice(
        tx(lang, `Producto ya guardado: ${local.name} (${code}).`, `Product already saved: ${local.name} (${code}).`),
      );
      return;
    }

    setBarcodeBusy(true);
    setBarcodeNotice(
      tx(lang, `Buscando el código ${code} en el catálogo local…`, `Looking up code ${code} in the local catalog…`),
    );
    try {
      // 1) Catálogo local AR/PE/MX: disponible sin conexión. Los macros son
      // una aproximación por categoría, así que se avisa en el resultado.
      const catalogFood = await lookupBarcodeCatalog(code);
      if (catalogFood) {
        setLookupFood(catalogFood);
        await onCreateFood(catalogFood);
        chooseFood(catalogFood);
        setBarcodeNotice(
          tx(
            lang,
            `Producto del catálogo local: ${catalogFood.name}. Macros estimados por categoría; ajusta la cantidad o edítalo con la etiqueta si necesitas precisión.`,
            `Local catalog product: ${catalogFood.name}. Macros estimated by category; adjust the amount or edit it from the label if you need precision.`,
          ),
        );
        return;
      }

      // 2) Open Food Facts: datos exactos si el producto existe y hay red.
      setBarcodeNotice(
        tx(lang, `Buscando el código ${code} en Open Food Facts…`, `Looking up code ${code} on Open Food Facts…`),
      );
      const product = await lookupBarcode(code);
      if (product) {
        setLookupFood(product);
        await onCreateFood(product);
        chooseFood(product);
        setBarcodeNotice(
          tx(lang, `Producto encontrado y guardado en tu base: ${product.name}.`, `Product found and saved to your database: ${product.name}.`),
        );
      } else {
        setCustom((value) => ({ ...value, barcode: code }));
        setCustomOpen(true);
        setBarcodeNotice(
          tx(
            lang,
            `El código ${code} no está en el catálogo local ni en Open Food Facts o no tiene macros. Revisa la etiqueta y guárdalo manualmente: el código quedará asociado.`,
            `Code ${code} is not in the local catalog or Open Food Facts, or it has no macros. Check the label and save it manually: the code will be linked.`,
          ),
        );
      }
    } catch (e) {
      setCustom((value) => ({ ...value, barcode: code }));
      setCustomOpen(true);
      setBarcodeNotice(
        tx(
          lang,
          `No se pudo consultar el producto (${errorText(e)}). Puedes guardarlo manualmente con este código.`,
          `Could not look up the product (${errorText(e)}). You can save it manually with this code.`,
        ),
      );
    } finally {
      setBarcodeBusy(false);
    }
  };

  /**
   * Puerta de entrada del código tecleado o enviado por un lector físico:
   * normaliza, comprueba longitud y dígito de control GTIN antes de consultar
   * servicios (el aviso ofrece continuar si el checksum no cuadra).
   */
  const handleBarcode = async (raw: string) => {
    const code = normalizeBarcode(raw);
    setChecksumHold(null);
    setBarcodeError('');
    setBarcodeNotice(null);
    if (!code) {
      setBarcodeError(tx(lang, 'Escribe los dígitos del código de barras.', 'Enter the barcode digits.'));
      return;
    }
    if (code.length < 6 || code.length > 14) {
      setBarcodeError(tx(lang, 'El código debe tener entre 6 y 14 dígitos.', 'The code must have between 6 and 14 digits.'));
      return;
    }
    if (isGtinLength(code) && !validBarcodeChecksum(code)) {
      setChecksumHold(code);
      setBarcodeNotice(
        tx(
          lang,
          `El código ${code} no es válido (dígito de control): revisa los dígitos. Si estás seguro de que está bien escrito, puedes buscarlo igual.`,
          `Code ${code} is not valid (check digit): review the digits. If you are sure it is correct, you can search anyway.`,
        ),
      );
      return;
    }
    await processBarcode(code);
  };

  const searchChecksumHold = async () => {
    const code = checksumHold;
    if (!code) return;
    setBarcodeNotice(
      tx(
        lang,
        `Buscando el código ${code} aunque su dígito de control no cuadre…`,
        `Looking up code ${code} even though its check digit does not match…`,
      ),
    );
    await processBarcode(code);
  };

  const createCustom = async () => {
    setError('');
    if (!custom.name.trim()) {
      setError(tx(lang, 'Escribe el nombre del alimento.', 'Enter the food name.'));
      return;
    }
    if (custom.kcal < 0 || custom.protein < 0 || custom.carbs < 0 || custom.fat < 0 || custom.fiber < 0) {
      setError(tx(lang, 'Los valores no pueden ser negativos.', 'Values cannot be negative.'));
      return;
    }
    const barcode = normalizeBarcode(custom.barcode);
    if (barcode && findFoodByBarcode(foods, barcode)) {
      setError(tx(lang, 'Ya existe un alimento con ese código de barras.', 'A food with that barcode already exists.'));
      return;
    }
    setSaving(true);
    try {
      const food: Food = {
        id: `custom-${crypto.randomUUID()}`,
        name: custom.name.trim(),
        category: custom.category,
        per100: {
          kcal: custom.kcal,
          protein: custom.protein,
          carbs: custom.carbs,
          fat: custom.fat,
          fiber: custom.fiber,
        },
        units: custom.unitGrams > 0 ? { unidad: custom.unitGrams } : {},
        custom: true,
        barcode: barcode || undefined,
        source: 'manual',
      };
      await onCreateFood(food);
      setLookupFood(food);
      setSelectedId(food.id);
      setUnit(preferredUnit(food));
      setQuantity(defaultQuantity(preferredUnit(food)));
      setCustom({
        name: '',
        category: 'otro',
        kcal: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        unitGrams: 0,
        barcode: '',
      });
      setCustomOpen(false);
      setQuery(food.name);
    } catch {
      setError(tx(lang, 'No se pudo guardar el alimento. Inténtalo de nuevo.', 'Could not save the food. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="food-log">
      <div className="food-search">
        <form className="food-search-row" onSubmit={submitUnified}>
          <input
            className="input"
            value={query}
            maxLength={80}
            onChange={(event) => {
              setQuery(event.target.value.slice(0, 80));
              if (barcodeError) setBarcodeError('');
              if (checksumHold) {
                setChecksumHold(null);
                setBarcodeNotice(null);
              }
            }}
            placeholder={tx(
              lang,
              `Nombre (pollo, arroz...) o 6–14 dígitos. ${foods.length} alimentos en local`,
              `Name (chicken, rice...) or 6–14 digits. ${foods.length} local foods`,
            )}
            aria-label={tx(lang, 'Buscar alimento o código de barras', 'Search food or barcode')}
            enterKeyHint="search"
          />
          <button type="submit" className="btn btn-tonal btn-sm food-search-submit" disabled={barcodeBusy}>
            <Icon name="scan" size={15} /> {barcodeBusy ? tx(lang, 'Buscando…', 'Searching…') : tx(lang, 'Buscar', 'Search')}
          </button>
        </form>
        <span className="hint food-search-hint">
          {tx(
            lang,
            'Busca en tu base local y, por palabras clave o código, en Open Food Facts (world.openfoodfacts.org). Un lector de barras USB/Bluetooth que termine en Enter también funciona.',
            'Searches your local database and, by keyword or barcode, Open Food Facts (world.openfoodfacts.org). A USB/Bluetooth barcode scanner ending in Enter also works.',
          )}
        </span>
        {barcodeError && (
          <div className="notice notice-error">
            <Icon name="alert" size={16} />
            <span>{barcodeError}</span>
          </div>
        )}
        {remoteError && (
          <div className="notice notice-warn">
            <Icon name="alert" size={16} />
            <span>{remoteError}</span>
          </div>
        )}
        <div className="food-results" role="listbox" aria-label={tx(lang, 'Resultados de alimentos', 'Food results')}>
          {results.length === 0 && remoteResults.length === 0 && !remoteBusy ? (
            <div className="food-result-empty">
              {tx(
                lang,
                'No hay coincidencias. Puedes añadir este alimento con el formulario de abajo.',
                'No matches. You can add this food with the form below.',
              )}
            </div>
          ) : (
            <>
              {results.map((food) => (
                <div key={food.id} className={`food-result-row ${selected?.id === food.id ? 'active' : ''}`}>
                  <button type="button" className="food-result" onClick={() => chooseFood(food)}>
                    <span>
                      <strong>{displayName(food)}</strong>
                      <span className="small muted"> · {categoryLabel(food.category, lang)}</span>
                      <span className="badge badge-muted">{tx(lang, 'Local', 'Local')}</span>
                      {food.source === 'estimate' && (
                        <span className="badge badge-warning">{tx(lang, 'Estimación', 'Estimate')}</span>
                      )}
                    </span>
                    <span className="mono small">{food.per100.kcal} kcal/100 g</span>
                  </button>
                  <button type="button" className="btn btn-tonal btn-sm food-result-add" onClick={() => addFromSearch(food)} aria-label={tx(lang, `Añadir ${displayName(food)} a la ingesta`, `Add ${displayName(food)} to the log`)}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
              ))}
              {remoteResults
                .filter((food) => !results.some((local) => local.barcode === food.barcode))
                .map((food) => (
                  <div key={food.id} className="food-result-row">
                    <button type="button" className="food-result" onClick={() => chooseFood(food)}>
                      <span>
                        <strong>{displayName(food)}</strong>
                        <span className="small muted"> · {categoryLabel(food.category, lang)}</span>
                        <span className="badge badge-primary">{tx(lang, 'Open Food Facts', 'Open Food Facts')}</span>
                      </span>
                      <span className="mono small">{food.per100.kcal} kcal/100 g</span>
                    </button>
                    <button type="button" className="btn btn-tonal btn-sm food-result-add" onClick={() => void addRemoteFood(food)} aria-label={tx(lang, `Añadir ${displayName(food)} a la ingesta`, `Add ${displayName(food)} to the log`)}>
                      <Icon name="plus" size={13} />
                    </button>
                  </div>
                ))}
            </>
          )}
          {remoteBusy && (
            <div className="food-result-empty">{tx(lang, 'Buscando en Open Food Facts…', 'Searching Open Food Facts…')}</div>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCustomOpen((open) => !open)}>
          <Icon name="plus" size={14} /> {tx(lang, 'Añadir alimento manualmente', 'Add food manually')}
        </button>
        {barcodeNotice && (
          <div className="notice notice-info food-barcode-notice">
            <Icon name="scan" size={16} />
            <span>{barcodeNotice}</span>
            {checksumHold && (
              <div className="row wrap" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void searchChecksumHold()}>
                  {tx(lang, 'Buscar igual', 'Search anyway')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChecksumHold(null)}>
                  {tx(lang, 'Descartar', 'Discard')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {selected && preview && (
        <div className="food-preview">
          <div className="food-preview-head">
            <div>
              <strong>{displayName(selected)}</strong>
              <div className="small muted">
                {selected.per100.kcal} kcal · {selected.per100.protein} g {tx(lang, 'proteína', 'protein')} ·{' '}
                {selected.per100.carbs} g {tx(lang, 'carbohidratos', 'carbs')} · {selected.per100.fat} g{' '}
                {tx(lang, 'grasas por 100 g', 'fat per 100 g')}
                {selected.barcode ? ` · ${tx(lang, 'código', 'code')} ${selected.barcode}` : ''}
              </div>
            </div>
            <span className="badge badge-primary">{categoryLabel(selected.category, lang)}</span>
          </div>
          <div className="food-add-row">
            <label className="field">
              <span className="field-label">{tx(lang, 'Comida', 'Meal')}</span>
              <Select
                value={meal}
                onChange={(value) => setMeal(value as MealSlot)}
                options={mealSlots(lang).map((slot) => ({ value: slot.id, label: slot.label }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{tx(lang, 'Cantidad', 'Quantity')}</span>
              <NumberInput value={quantity} onChange={setQuantity} min={0} step={unit === 'g' || unit === 'ml' ? 10 : 0.5} />
            </label>
            <label className="field">
              <span className="field-label">{tx(lang, 'Medida', 'Measure')}</span>
              <Select
                value={unit}
                onChange={changeUnit}
                options={units.map((item) => ({ value: item, label: unitLabel(item, lang) }))}
              />
            </label>
            <button type="button" className="btn btn-primary btn-sm food-add-button" onClick={add}>
              <Icon name="plus" size={14} /> {tx(lang, 'Añadir', 'Add')}
            </button>
          </div>
          <div className="food-preview-totals">
            <span><strong>{preview.grams} g</strong> {tx(lang, 'aprox.', 'approx.')}</span>
            <span><strong>{preview.kcal} kcal</strong></span>
            <span>{tx(lang, 'P', 'P')} {preview.protein} g</span>
            <span>{tx(lang, 'C', 'C')} {preview.carbs} g</span>
            <span>{tx(lang, 'G', 'F')} {preview.fat} g</span>
            <span>{tx(lang, 'Fibra', 'Fiber')} {preview.fiber} g</span>
          </div>
        </div>
      )}

      <div className="food-day">
        <div className="row between wrap">
          <div>
            <span className="field-label">{tx(lang, 'Comidas de hoy', "Today's meals")}</span>
            <span className="hint">
              {' '}
              {tx(lang, 'Borrador efímero: se borra al terminar el día.', 'Ephemeral draft: cleared at the end of the day.')}
            </span>
          </div>
          {items.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
              <Icon name="trash" size={14} /> {tx(lang, 'Vaciar', 'Clear')}
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="food-empty">
            {tx(
              lang,
              'Añade alimentos para estimar la ingesta del día. Después podrás guardar un único log diario.',
              'Add foods to estimate the day\'s intake. Then you can save a single daily log.',
            )}
          </div>
        ) : (
          <div className="stack-sm">
            {mealSlots(lang).map((slot) => {
              const group = items.filter((item) => item.meal === slot.id);
              if (!group.length) return null;
              return (
                <div key={slot.id} className="meal-group">
                  <div className="meal-heading">{slot.label}</div>
                  {group.map((item) => {
                    if (item.id === editingId) {
                      const itemFood = foodFor(item);
                      const itemUnits = itemFood ? foodUnits(itemFood) : ['g'];
                      const unitOptions = itemUnits.includes(item.unit) ? itemUnits : [item.unit, ...itemUnits];
                      const editPreview = itemFood ? calcFood(itemFood, editQuantity, editUnit) : null;
                      return (
                        <div key={item.id} className="food-item food-item-edit">
                          <div className="food-item-main">
                            <strong>{displayItemName(item)}</strong>
                            <span className="small muted">
                              {editPreview
                                ? `${editPreview.grams} g · ${editPreview.kcal} kcal`
                                : tx(lang, 'Sin datos del alimento', 'No food data')}
                            </span>
                          </div>
                          <div className="food-edit-grid">
                            <label className="field">
                              <span className="field-label">{tx(lang, 'Comida', 'Meal')}</span>
                              <Select
                                value={editMeal}
                                onChange={(value) => setEditMeal(value as MealSlot)}
                                options={mealSlots(lang).map((option) => ({ value: option.id, label: option.label }))}
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">{tx(lang, 'Cantidad', 'Quantity')}</span>
                              <NumberInput
                                value={editQuantity}
                                onChange={setEditQuantity}
                                min={0}
                                step={editUnit === 'g' || editUnit === 'ml' ? 10 : 0.5}
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">{tx(lang, 'Medida', 'Measure')}</span>
                              <Select
                                value={editUnit}
                                onChange={(value) => {
                                  setEditUnit(value);
                                  setEditQuantity(defaultQuantity(value));
                                }}
                                options={unitOptions.map((option) => ({ value: option, label: unitLabel(option, lang) }))}
                              />
                            </label>
                          </div>
                          <div className="food-edit-actions">
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => saveEdit(item)}>
                              <Icon name="check" size={14} /> {tx(lang, 'Guardar', 'Save')}
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                              {tx(lang, 'Cancelar', 'Cancel')}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={item.id} className="food-item">
                        <div className="food-item-main">
                          <strong>{displayItemName(item)}</strong>
                          <span className="small muted">
                            {item.quantity} {unitLabel(item.unit, lang)} · {item.grams} g
                          </span>
                        </div>
                        <div className="food-item-macros">
                          <strong>{item.kcal} kcal</strong>
                          <span>{tx(lang, 'P', 'P')} {item.protein} · {tx(lang, 'C', 'C')} {item.carbs} · {tx(lang, 'G', 'F')} {item.fat}</span>
                        </div>
                        <div className="food-item-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={tx(lang, `Editar ${displayItemName(item)}`, `Edit ${displayItemName(item)}`)}
                            onClick={() => startEdit(item)}
                          >
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button icon-button-danger"
                            aria-label={tx(lang, `Quitar ${displayItemName(item)}`, `Remove ${displayItemName(item)}`)}
                            onClick={() => onRemove(item.id)}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 && (
          <div className="food-totals">
            <div><span>{tx(lang, 'Calorías', 'Calories')}</span><strong>{totals.kcal} kcal</strong></div>
            <div><span>{tx(lang, 'Proteína', 'Protein')}</span><strong>{totals.protein} g</strong></div>
            <div><span>{tx(lang, 'Carbohidratos', 'Carbohydrates')}</span><strong>{totals.carbs} g</strong></div>
            <div><span>{tx(lang, 'Grasas', 'Fats')}</span><strong>{totals.fat} g</strong></div>
            <div><span>{tx(lang, 'Fibra', 'Fiber')}</span><strong>{totals.fiber} g</strong></div>
          </div>
        )}
      </div>

      <div className="food-custom">
        <button type="button" className="btn btn-tonal btn-sm" onClick={() => setCustomOpen((open) => !open)}>
          <Icon name="plus" size={14} />{' '}
          {customOpen ? tx(lang, 'Cerrar', 'Close') : tx(lang, 'Añadir alimento a la base', 'Add food to database')}
        </button>
        {customOpen && (
          <div className="food-custom-form">
            <div className="grid grid-2" style={{ gap: 10 }}>
              <label className="field">
                <span className="field-label">{tx(lang, 'Nombre', 'Name')}</span>
                <input
                  className="input"
                  value={custom.name}
                  onChange={(event) => setCustom({ ...custom, name: event.target.value })}
                  placeholder={tx(lang, 'Ej. tortilla casera', 'e.g. homemade omelette')}
                />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Categoría', 'Category')}</span>
                <Select
                  value={custom.category}
                  onChange={(value) => setCustom({ ...custom, category: value as FoodCategory })}
                  options={foodCategories(lang).map((category) => ({ value: category.id, label: category.label }))}
                />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Calorías / 100 g', 'Calories / 100 g')}</span>
                <NumberInput value={custom.kcal} onChange={(value) => setCustom({ ...custom, kcal: value })} min={0} />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Proteína / 100 g', 'Protein / 100 g')}</span>
                <NumberInput value={custom.protein} onChange={(value) => setCustom({ ...custom, protein: value })} min={0} step={0.1} />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Carbohidratos / 100 g', 'Carbohydrates / 100 g')}</span>
                <NumberInput value={custom.carbs} onChange={(value) => setCustom({ ...custom, carbs: value })} min={0} step={0.1} />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Grasas / 100 g', 'Fats / 100 g')}</span>
                <NumberInput value={custom.fat} onChange={(value) => setCustom({ ...custom, fat: value })} min={0} step={0.1} />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Fibra / 100 g', 'Fiber / 100 g')}</span>
                <NumberInput value={custom.fiber} onChange={(value) => setCustom({ ...custom, fiber: value })} min={0} step={0.1} />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Peso de 1 unidad (g, opcional)', 'Weight of 1 unit (g, optional)')}</span>
                <NumberInput value={custom.unitGrams} onChange={(value) => setCustom({ ...custom, unitGrams: value })} min={0} step={1} />
              </label>
              <label className="field">
                <span className="field-label">{tx(lang, 'Código de barras (opcional)', 'Barcode (optional)')}</span>
                <input
                  className="input"
                  value={custom.barcode}
                  onChange={(event) => setCustom({ ...custom, barcode: event.target.value })}
                  placeholder={tx(lang, 'Ej. 8412345678905', 'e.g. 8412345678905')}
                  inputMode="numeric"
                />
              </label>
            </div>
            {error && <div className="notice notice-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
            <div className="row between">
              <span className="hint">
                {tx(
                  lang,
                  'Se guarda en la bóveda local y estará disponible en el buscador.',
                  'It is saved to the local vault and will be available in search.',
                )}
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void createCustom()} disabled={saving}>
                <Icon name="check" size={14} />{' '}
                {saving ? tx(lang, 'Guardando…', 'Saving…') : tx(lang, 'Guardar alimento', 'Save food')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
