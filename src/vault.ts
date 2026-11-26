import { invoke } from '@tauri-apps/api/core';
import pkg from '../package.json';
import { barcodeVariants } from './foodDb';
import type { AppInfo, BarcodeProduct, Food, FoodCategory, VaultEvent } from './types';

export type { VaultEvent };

const MOCK = '__better_tracker_mock__';
const MOCK_VAULT_KEY = 'bt.mock.vault';
const MOCK_DEVICE_KEY = 'bt.mock.device';
const MOCK_EVENTS_KEY = 'bt.mock.events';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function mockDeviceId(): string {
  let id = localStorage.getItem(MOCK_DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(MOCK_DEVICE_KEY, id);
  }
  return id;
}

function mockEvents(): VaultEvent[] {
  const raw = localStorage.getItem(MOCK_EVENTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as VaultEvent[];
  } catch {
    return [];
  }
}

function saveMockEvents(events: VaultEvent[]): void {
  localStorage.setItem(MOCK_EVENTS_KEY, JSON.stringify(events));
}

export interface VaultInfo {
  path: string | null;
  label: string | null;
  data_dir: string | null;
}

export interface VaultSelection {
  path: string;
  label: string;
}

export interface SnapshotInfo {
  /** `<fecha>` para copias antiguas o `<dispositivo>/<fecha>` en las nuevas. */
  id: string;
  date: string;
  device_id: string;
  device_label: string;
  files: number;
  bytes: number;
  /** Archivos que debería tener según su manifiesto; `null` en copias antiguas. */
  expected_files: number | null;
  expected_bytes: number | null;
  /** Marcada como completa pero con menos archivos de los que declara. */
  damaged: boolean;
  complete: boolean;
  legacy: boolean;
  current_device: boolean;
}

export interface BackupStatus {
  retention_days: number;
  last_backup: string | null;
  copies: SnapshotInfo[];
  total_bytes: number;
}

export interface BackupRunResult {
  created: boolean;
  skipped: string | null;
  date: string | null;
  status: BackupStatus;
}

export interface RestoreResult {
  imported: number;
  already_present: number;
  source_events: number;
  folder: string;
}

export async function getVaultInfo(): Promise<VaultInfo> {
  if (!isTauri()) {
    const path = localStorage.getItem(MOCK_VAULT_KEY);
    return { path, label: path, data_dir: path ? `${path}/omega` : null };
  }
  return invoke<VaultInfo>('get_vault_info');
}

export async function selectVault(): Promise<VaultSelection> {
  if (!isTauri()) {
    const path = localStorage.getItem(MOCK_VAULT_KEY) || 'Bóveda local (modo navegador)';
    localStorage.setItem(MOCK_VAULT_KEY, path);
    return { path, label: 'Bóveda local (modo navegador)' };
  }
  return invoke<VaultSelection>('select_vault');
}

function emptyBackupStatus(): BackupStatus {
  return {
    retention_days: 7,
    last_backup: null,
    copies: [],
    total_bytes: 0,
  };
}

export async function getBackupStatus(): Promise<BackupStatus> {
  if (!isTauri()) return emptyBackupStatus();
  return invoke<BackupStatus>('vault_backup_status');
}

export async function runBackup(force = false): Promise<BackupRunResult> {
  if (!isTauri()) {
    return {
      created: false,
      skipped: 'Las copias longlife solo están disponibles en la app nativa.',
      date: null,
      status: emptyBackupStatus(),
    };
  }
  return invoke<BackupRunResult>('vault_run_backup', { force });
}

export async function deleteBackups(): Promise<BackupStatus> {
  if (!isTauri()) return emptyBackupStatus();
  return invoke<BackupStatus>('vault_delete_backups');
}

/**
 * Importa a la bóveda actual los eventos de una copia longlife que ya no estén
 * presentes. Nunca sobrescribe ni borra eventos: los recuperados se escriben en
 * `omega/devices/restored-<copia>-<marca>/events.jsonl` y se deduplican por id.
 */
export async function restoreSnapshot(id: string): Promise<RestoreResult> {
  if (!isTauri()) {
    throw new Error('La restauración de copias solo está disponible en la app nativa.');
  }
  return invoke<RestoreResult>('vault_restore_snapshot', { id });
}

export async function getDeviceId(): Promise<string> {
  if (!isTauri()) return mockDeviceId();
  return invoke<string>('get_device_id');
}

export async function listEvents(): Promise<VaultEvent[]> {
  if (!isTauri()) return mockEvents();
  return invoke<VaultEvent[]>('list_events');
}

/**
 * Aviso para que la UI añada el evento a su estado sin releer toda la bóveda.
 * La bóveda guarda un archivo por evento: releerlos todos tras cada guardado se
 * vuelve caro con años de historial. El evento se añade de forma optimista y la
 * siguiente lectura completa lo confirma.
 */
export const EVENT_APPENDED = 'better-tracker:event-appended';

export async function appendEvent(ev: VaultEvent): Promise<void> {
  if (!isTauri()) {
    saveMockEvents([...mockEvents(), ev]);
  } else {
    await invoke<void>('append_event', { event: ev });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_APPENDED, { detail: ev }));
  }
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) {
    return {
      version: pkg.version,
      commit: 'navegador',
      build_date: new Date().toISOString().slice(0, 10),
      vault_schema_version: 1,
      install_format: 'navegador',
    };
  }
  return invoke<AppInfo>('get_app_info');
}

/**
 * Busca un producto por EAN/UPC. En la app nativa usa Rust (reqwest) y en el
 * modo navegador consulta Open Food Facts directamente para poder probar el
 * flujo sin compilar.
 */
export async function lookupBarcode(code: string): Promise<BarcodeProduct | null> {
  const barcode = code.replace(/\D/g, '');
  if (barcode.length < 6 || barcode.length > 14) {
    throw new Error('El código debe tener entre 6 y 14 dígitos (EAN/UPC).');
  }
  if (isTauri()) {
    return invoke<BarcodeProduct | null>('lookup_barcode', { code: barcode });
  }
  return lookupBarcodeWeb(barcode);
}

/**
 * Búsqueda de alimentos por palabras clave. En la app nativa pasa por Rust
 * (la CSP prohíbe `fetch` desde el webview); en modo navegador se llama
 * directamente solo para poder probar el flujo.
 */
export async function searchFoodsRemote(query: string): Promise<Food[]> {
  const clean = query
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s\-_,¿?¡!.]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  if (!clean || clean.length < 2 || /[\x00-\x1f]/.test(clean)) return [];
  if (isTauri()) {
    // Se propaga el fallo para que la UI distinga «sin resultados» de «sin red»;
    // la búsqueda local sigue funcionando en cualquier caso.
    return invoke<Food[]>('search_foods_remote', { query: clean });
  }
  try {
    const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
    url.searchParams.set('search_terms', clean);
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', '8');
    url.searchParams.set('fields', 'code,product_name,product_name_es,generic_name,brands,nutriments,categories_tags,quantity,serving_size');
    const response = await fetch(url.toString());
    if (!response.ok) return [];
    const payload = await response.json() as { products?: Array<Record<string, unknown>> };
    return (payload.products ?? []).slice(0, 8).map(remoteFoodFromPayload).filter((f): f is Food => f !== null);
  } catch {
    return [];
  }
}

function remoteFoodFromPayload(raw: Record<string, unknown>): Food | null {
  const code = typeof raw.code === 'string' ? raw.code.replace(/\D/g, '') : '';
  const name = typeof raw.product_name_es === 'string' && raw.product_name_es.trim()
    ? raw.product_name_es.trim()
    : typeof raw.product_name === 'string' ? raw.product_name.trim() : '';
  if (!code || !name) return null;
  const nutriments = (raw.nutriments ?? {}) as Record<string, unknown>;
  const num = (key: string): number => {
    const value = nutriments[key];
    const n = typeof value === 'string' ? Number(value.replace(',', '.')) : typeof value === 'number' ? value : 0;
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0;
  };
  const kcal = num('energy-kcal_100g') || num('energy_100g') / 4.184;
  const protein = num('proteins_100g');
  const carbs = num('carbohydrates_100g');
  const fat = num('fat_100g');
  if (kcal <= 0 && protein <= 0 && carbs <= 0 && fat <= 0) return null;
  const brands = typeof raw.brands === 'string' ? raw.brands.trim() : '';
  const tags = Array.isArray(raw.categories_tags) ? raw.categories_tags.filter((t): t is string => typeof t === 'string') : [];
  return {
    id: `off-${code}`,
    name: brands && !name.toLowerCase().includes(brands.toLowerCase()) ? `${name} (${brands})` : name,
    category: categoryFromTags(tags),
    per100: { kcal: Math.round(kcal * 10) / 10, protein, carbs, fat, fiber: num('fiber_100g') },
    units: {},
    custom: true,
    barcode: code,
    source: 'openfoodfacts',
  };
}

function categoryFromTags(tags: string[]): FoodCategory {
  const has = (needle: string) => tags.some((tag) => tag.includes(needle));
  if (has('beverage') || has('drink') || has('water') || has('juice') || has('soda')) return 'bebida';
  if (has('dairy') || has('milk') || has('cheese') || has('yogurt')) return 'lacteo';
  if (has('meat') || has('poultry') || has('ham') || has('sausage')) return 'carne';
  if (has('fish') || has('seafood')) return 'pescado';
  if (has('egg')) return 'huevo';
  if (has('fruit')) return 'fruta';
  if (has('vegetable') || has('salad')) return 'verdura';
  if (has('legume') || has('bean')) return 'legumbre';
  if (has('bread') || has('cereal') || has('pasta') || has('rice')) return 'cereal';
  if (has('nut') || has('seed')) return 'fruto_seco';
  if (has('oil') || has('fat') || has('butter')) return 'grasa';
  if (has('sauce') || has('condiment') || has('spice')) return 'condimento';
  if (has('sweet') || has('snack') || has('chocolate') || has('dessert')) return 'dulce';
  if (has('supplement') || has('protein')) return 'suplemento';
  return 'procesado';
}

async function lookupBarcodeWeb(barcode: string): Promise<BarcodeProduct | null> {
  let lastError: unknown = null;
  for (const candidate of barcodeVariants(barcode)) {
    try {
      const product = await fetchProductForBarcode(candidate, barcode);
      if (product) return product;
    } catch (error) {
      // Un fallo puntual con una variante no debe impedir probar las demás.
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function fetchProductForBarcode(barcode: string, enteredCode: string): Promise<BarcodeProduct | null> {
  const fields = 'product_name,product_name_es,generic_name,brands,nutriments,categories_tags,quantity,serving_size';
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${fields}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Food Facts respondió con estado ${response.status}.`);
  const payload = await response.json();
  if (payload?.status === 0 || !payload?.product) return null;
  const product = payload.product as Record<string, any>;
  const name = String(product.product_name_es || product.product_name || product.generic_name || '').trim();
  if (!name) return null;
  const brand = String(product.brands || '').trim();
  const nutriments = product.nutriments ?? {};
  const num = (key: string) => {
    const value = Number(nutriments[key]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const kcal = num('energy-kcal_100g') || num('energy_100g') / 4.184;
  const per100 = {
    kcal: Math.round(kcal * 10) / 10,
    protein: Math.round(num('proteins_100g') * 10) / 10,
    carbs: Math.round(num('carbohydrates_100g') * 10) / 10,
    fat: Math.round(num('fat_100g') * 10) / 10,
    fiber: Math.round(num('fiber_100g') * 10) / 10,
  };
  if (per100.kcal <= 0 && per100.protein <= 0 && per100.carbs <= 0 && per100.fat <= 0) return null;
  const tags = Array.isArray(product.categories_tags)
    ? product.categories_tags.map((tag: unknown) => String(tag).toLowerCase())
    : [];
  return {
    id: `off-${enteredCode}`,
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name,
    category: categoryFromTags(tags),
    per100,
    units: {},
    custom: true,
    barcode: enteredCode,
    source: 'openfoodfacts',
    quantityLabel: product.quantity ? String(product.quantity) : null,
    servingLabel: product.serving_size ? String(product.serving_size) : null,
  };
}

export function newEvent(deviceId: string, kind: string, payload: any): VaultEvent {
  return {
    id: crypto.randomUUID(),
    device_id: deviceId,
    timestamp: new Date().toISOString(),
    kind,
    payload,
  };
}

export function clearMockData(): void {
  localStorage.removeItem(MOCK_EVENTS_KEY);
  localStorage.removeItem(MOCK_VAULT_KEY);
  localStorage.removeItem(MOCK_DEVICE_KEY);
}

export { MOCK };
