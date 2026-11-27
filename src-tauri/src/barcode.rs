use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/* ------------------------------------------------------------------ */
/* Búsqueda de productos por código de barras (Open Food Facts)       */
/* ------------------------------------------------------------------ */

const OFF_BASE: &str = "https://world.openfoodfacts.org/api/v2/product";

/// Servidores oficiales de Open Food Facts para búsqueda por palabras clave.
///
/// **Solo Windows.** La búsqueda de texto completo del buscador legacy
/// (`cgi/search.pl`) devuelve 503 de forma masiva (medido el 2026-11-27: 10 de
/// 12 peticiones). El reemplazo oficial es Search-a-licious, que se prueba
/// primero (`OFF_SEARCH_ALICIOUS`); estos dos hosts quedan solo como respaldo,
/// sin segunda pasada, para no multiplicar peticiones contra el límite de OFF.
#[cfg(windows)]
const OFF_SEARCH_ENDPOINTS: &[&str] = &[
    "https://world.openfoodfacts.org/cgi/search.pl",
    "https://fr.openfoodfacts.org/cgi/search.pl",
];

/// Linux, Android e iOS conservan **exactamente** la ruta que ya funcionaba.
#[cfg(not(windows))]
const OFF_SEARCH_ENDPOINTS: &[&str] = &[
    "https://world.openfoodfacts.org/cgi/search.pl",
    "https://fr.openfoodfacts.org/cgi/search.pl",
    "https://world.openfoodfacts.org/api/v2/search",
];

const OFF_FIELDS: &str = "code,product_name,product_name_es,generic_name,brands,nutriments,categories_tags,quantity,serving_size";
const TIMEOUT: Duration = Duration::from_secs(12);
const MAX_QUERY_CHARS: usize = 80;
const MAX_SEARCH_RESULTS: usize = 8;
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(600);
const SEARCH_CACHE_MAX: usize = 24;
/// Presupuesto total de la búsqueda, aunque haya varios endpoints y reintentos.
const SEARCH_DEADLINE: Duration = Duration::from_secs(20);
/// Entrada de la caché de búsqueda: momento en que se guardó y resultados.
type SearchCacheEntry = (Instant, Vec<Value>);
type SearchCache = HashMap<String, SearchCacheEntry>;

/// Caché pequeña y con caducidad: evita repetir la misma búsqueda al teclear
/// y crece como máximo hasta `SEARCH_CACHE_MAX` entradas.
static SEARCH_CACHE: OnceLock<Mutex<SearchCache>> = OnceLock::new();

// Límites de OFF documentados (https://openfoodfacts.github.io/openfoodfacts-server/api):
// 10 búsquedas/min/IP y 15 lecturas de producto/min/IP; al superarlos responde
// 503 y puede acabar bloqueando la IP. La app aplica un margen y un backoff
// exponencial para no auto-bloquearse. Solo Windows: en Linux/Android se
// conserva el comportamiento que ya funcionaba.
#[cfg(any(windows, test))]
const SEARCH_RATE_MAX: usize = 8;
#[cfg(any(windows, test))]
const PRODUCT_RATE_MAX: usize = 12;
#[cfg(any(windows, test))]
const RATE_WINDOW: Duration = Duration::from_secs(60);
#[cfg(any(windows, test))]
const BACKOFF_BASE: Duration = Duration::from_secs(30);
#[cfg(any(windows, test))]
const BACKOFF_MAX: Duration = Duration::from_secs(600);
/// Ventana deslizante aproximada: `(inicio, peticiones)`.
#[cfg(any(windows, test))]
type RateWindow = (Instant, usize);
#[cfg(any(windows, test))]
static SEARCH_RATE: OnceLock<Mutex<RateWindow>> = OnceLock::new();
#[cfg(any(windows, test))]
static PRODUCT_RATE: OnceLock<Mutex<RateWindow>> = OnceLock::new();
/// `(bloqueado hasta, intentos consecutivos)`.
#[cfg(any(windows, test))]
type Backoff = (Instant, u32);
#[cfg(any(windows, test))]
static SEARCH_BACKOFF: OnceLock<Mutex<Backoff>> = OnceLock::new();

/// Consume una petición del presupuesto. Si se agotó, devuelve los segundos
/// que faltan para que el llamador avise en vez de insistir contra OFF.
#[cfg(any(windows, test))]
fn take_rate_budget(cell: &'static OnceLock<Mutex<RateWindow>>, max: usize) -> Result<(), u64> {
    let mut guard = cell
        .get_or_init(|| Mutex::new((Instant::now(), 0)))
        .lock()
        .map_err(|_| RATE_WINDOW.as_secs())?;
    if guard.0.elapsed() >= RATE_WINDOW {
        *guard = (Instant::now(), 0);
    }
    if guard.1 >= max {
        return Err(RATE_WINDOW.saturating_sub(guard.0.elapsed()).as_secs().max(1));
    }
    guard.1 += 1;
    Ok(())
}

/// Segundos que quedan de bloqueo, si OFF nos limitó hace poco.
#[cfg(any(windows, test))]
fn backoff_remaining() -> Option<u64> {
    let guard = SEARCH_BACKOFF
        .get_or_init(|| Mutex::new((Instant::now(), 0)))
        .lock()
        .ok()?;
    let left = guard.0.saturating_duration_since(Instant::now());
    (!left.is_zero()).then(|| left.as_secs().max(1))
}

/// Un 503/429 activa una espera exponencial: 30 s, 60 s, 120 s, 240 s (máx. 10 min).
#[cfg(any(windows, test))]
fn note_rate_limited() {
    if let Ok(mut guard) = SEARCH_BACKOFF
        .get_or_init(|| Mutex::new((Instant::now(), 0)))
        .lock()
    {
        let attempts = guard.1.saturating_add(1);
        let factor = 1u32 << (attempts.min(4) - 1);
        let delay = BACKOFF_BASE.saturating_mul(factor).min(BACKOFF_MAX);
        *guard = (Instant::now() + delay, attempts);
    }
}

#[cfg(any(windows, test))]
fn clear_rate_limit() {
    if let Ok(mut guard) = SEARCH_BACKOFF
        .get_or_init(|| Mutex::new((Instant::now(), 0)))
        .lock()
    {
        *guard = (Instant::now(), 0);
    }
}

#[cfg(any(windows, test))]
fn rate_limited_message(wait: u64) -> String {
    format!(
        "Open Food Facts limita las consultas anónimas (10 búsquedas o 15 lecturas por minuto) y ha respondido 503. Espera {wait} s antes de reintentar; la búsqueda local sigue disponible."
    )
}

/// Un 503 puede venir de Open Food Facts o de un proxy intermedio. La cabecera
/// `Server` y el `<title>` de la página distinguen al emisor sin volcar HTML ni
/// trazas al usuario; permite diagnosticar fallos que parecen iguales.
async fn status_detail(response: reqwest::Response) -> String {
    let server: String = response
        .headers()
        .get(reqwest::header::SERVER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(60)
        .collect();
    let body = response.text().await.unwrap_or_default();
    let title = html_title(&body);
    match (server.is_empty(), title.is_empty()) {
        (true, true) => String::new(),
        (true, false) => format!(" (página: {title})"),
        (false, true) => format!(" (servidor: {server})"),
        (false, false) => format!(" (servidor: {server}, página: {title})"),
    }
}

fn html_title(body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    let Some(start) = lower.find("<title>") else {
        return String::new();
    };
    let start = start + "<title>".len();
    let Some(end) = lower.get(start..).and_then(|rest| rest.find("</title>")) else {
        return String::new();
    };
    body.get(start..start + end)
        .map(|title| title.trim().chars().take(80).collect())
        .unwrap_or_default()
}

/// API oficial de reemplazo del buscador legacy de OFF (`cgi/search.pl` y
/// `api/v2/search`), que devuelve 503 de forma intermitente por límite de
/// peticiones anónimas. Con `fields=...,nutriments,...` trae las macros en la
/// misma respuesta: una búsqueda completa cuesta una sola petición.
/// Documentado por OFF: https://openfoodfacts.github.io/openfoodfacts-server/api
///
/// Se compila también en tests para poder ejercitarla contra el servicio real
/// desde Linux; en producción solo existe en Windows.
#[cfg(any(windows, test))]
const OFF_SEARCH_ALICIOUS: &str = "https://search.openfoodfacts.org/search";

/// Segundo cliente **solo para Windows**: ignora el proxy del sistema y las
/// variables `*_PROXY`. La build de Store perdió el proxy del registro por el
/// entailado de features (ya corregido con la feature `system-proxy`), pero
/// sigue siendo útil como respaldo: si el proxy configurado devuelve 503 o no
/// está disponible, esta pasada prueba la conexión directa.
#[cfg(windows)]
fn http_client_no_proxy() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .no_proxy()
        .user_agent(concat!(
            "BetterTracker/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/wulflo/BetterTracker)"
        ))
        .build()
        .map_err(|e| format!("No se pudo crear el cliente HTTP directo: {e}"))
}

/**
 * Busca un producto por EAN/UPC en Open Food Facts.
 *
 * No descargamos una base de datos completa: se consulta bajo demanda y el
 * resultado se guarda como evento `food.saved` en la bóveda (lo hace el
 * frontend). Así el producto queda cacheado en `omega` y disponible sin red.
 */
#[tauri::command]
pub async fn lookup_barcode(code: String) -> Result<Option<Value>, String> {
    let barcode = code.trim().replace(char::is_whitespace, "");
    let variants = barcode_variants(&barcode);
    if variants.is_empty() {
        return Err("El código debe tener entre 6 y 14 dígitos (EAN/UPC).".into());
    }

    let client = http_client()?;

    let mut last_error: Option<String> = None;
    for candidate in variants {
        match fetch_product(&client, &candidate).await {
            Ok(Some(product)) => {
                if let Some(product) = product_for_barcode(&product, &barcode) {
                    return Ok(Some(product));
                }
            }
            Ok(None) => continue,
            Err(error) => last_error = Some(error),
        }
    }

    match last_error {
        Some(error) => Err(error),
        None => Ok(None),
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!(
            "BetterTracker/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/wulflo/BetterTracker)"
        ))
        .build()
        .map_err(|e| format!("No se pudo crear el cliente HTTP: {e}"))
}

/// La consulta llega del webview: se recorta, se colapsan espacios y se
/// descartan caracteres de control y lo que no pueda ser un término de
/// búsqueda. La URL la construye siempre este módulo, nunca el frontend.
fn sanitize_search_query(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Escribe un alimento o un código de barras.".into());
    }
    if trimmed.chars().count() > MAX_QUERY_CHARS {
        return Err("La búsqueda es demasiado larga.".into());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("La búsqueda contiene caracteres no válidos.".into());
    }
    let clean: String = trimmed
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || "-_,¿?¡!.".contains(*c))
        .collect();
    let collapsed = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return Err("La búsqueda contiene caracteres no válidos.".into());
    }
    Ok(collapsed)
}

/// Search-a-licious interpreta `q` como consulta Lucene: `?`, `¿`, `¡`, `:`,
/// `(`, `)`, `"`, `~`, `^`, `*`, `\`, `/`, `+`, `|` y `&` cambian el sentido o
/// devuelven 0 resultados (`¿leche?` → 0). Se dejan solo letras, números,
/// espacios, guiones, guiones bajos y apóstrofos; el resto pasa a espacio.
#[cfg(any(windows, test))]
fn alicious_query(query: &str) -> String {
    query
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() || matches!(c, '-' | '_' | '\'') {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Campos que se piden a Search-a-licious. Con `fields` la respuesta baja de
/// cientos de KB a ~8 KB y sigue trayendo `nutriments`, que es lo que evita
/// leer producto por producto.
#[cfg(any(windows, test))]
const ALICIOUS_FIELDS: &str = "code,product_name,product_name_es,generic_name,brands,nutriments,categories,quantity,serving_size";

/// Se piden 60 resultados porque solo una parte del índice tiene macros: con
/// 60 se obtienen entre 2 y 10 válidos sin una sola petición extra.
#[cfg(any(windows, test))]
const ALICIOUS_PAGE_SIZE: usize = 60;

/// Search-a-licious devuelve `brands` y `categories` como arrays de etiquetas
/// (`xx:hacendado`, `en:rices`), no como el texto y `categories_tags` que
/// espera `product_for_barcode`. Se normaliza a esa forma.
#[cfg(any(windows, test))]
fn alicious_product(hit: &Value) -> Value {
    let brands = match hit.get("brands") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(clean_off_tag)
            .filter(|brand| !brand.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        Some(Value::String(text)) => clean_off_tag(text),
        _ => String::new(),
    };
    json!({
        "code": hit.get("code").cloned().unwrap_or(Value::Null),
        "product_name": hit.get("product_name").cloned().unwrap_or(Value::Null),
        "product_name_es": hit.get("product_name_es").cloned().unwrap_or(Value::Null),
        "generic_name": hit.get("generic_name").cloned().unwrap_or(Value::Null),
        "brands": brands,
        "nutriments": hit.get("nutriments").cloned().unwrap_or(Value::Null),
        "categories_tags": hit.get("categories").cloned().unwrap_or(Value::Null),
        "quantity": hit.get("quantity").cloned().unwrap_or(Value::Null),
        "serving_size": hit.get("serving_size").cloned().unwrap_or(Value::Null),
    })
}

/// `xx:el-corte-ingles` → `el corte ingles`.
#[cfg(any(windows, test))]
fn clean_off_tag(tag: &str) -> String {
    tag.split_once(':')
        .map(|(_, rest)| rest)
        .unwrap_or(tag)
        .replace('-', " ")
        .trim()
        .to_string()
}

/// Busca en Search-a-licious (el buscador oficial que sustituye al legacy) y
/// devuelve el mismo sobre `{ "products": [...] }` que el código existente
/// espera. `ALICIOUS_FIELDS` pide `nutriments`, `ALICIOUS_PAGE_SIZE = 60`
/// compensa que solo parte del índice tenga macros y `alicious_product`
/// normaliza las etiquetas.
///
/// Hace **una sola** petición: Search-a-licious ya trae `nutriments`, así que
/// no se lee cada producto por separado. Antes se gastaban hasta 16 lecturas
/// contra el límite de 15/min de OFF; ahora una búsqueda completa consume 1.
#[cfg(any(windows, test))]
async fn search_alicious(
    client: &reqwest::Client,
    query: &str,
    deadline: Instant,
) -> Option<Value> {
    let clean = alicious_query(query);
    if clean.is_empty() {
        return None;
    }
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return None;
    }
    let response = client
        .get(OFF_SEARCH_ALICIOUS)
        .query(&[
            ("q", clean.as_str()),
            ("page_size", &ALICIOUS_PAGE_SIZE.to_string()),
            ("fields", ALICIOUS_FIELDS),
        ])
        .timeout(remaining.min(Duration::from_secs(8)))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        // Solo Windows: 503/429 aquí también son el limitador de OFF.
        #[cfg(windows)]
        if matches!(response.status().as_u16(), 429 | 503) {
            note_rate_limited();
        }
        return None;
    }
    let payload: Value = response.json().await.ok()?;
    let hits = payload.get("hits")?.as_array()?;

    let mut products = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for hit in hits {
        if products.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        let code: String = hit
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect();
        if code.is_empty() || !seen.insert(code.clone()) {
            continue;
        }
        // Se devuelve el producto crudo normalizado (el mapeo a `per100` lo
        // hace `search_foods_remote`), pero solo si pasará ese filtro.
        let product = alicious_product(hit);
        if product_for_barcode(&product, &code).is_some() {
            products.push(product);
        }
    }
    (!products.is_empty()).then(|| json!({ "products": products }))
}

/// Busca alimentos por palabras clave en Open Food Facts. Solo se exponen
/// nombre, marca y macros; el frontend guarda el elegido como `food.saved`
/// para usarlo después sin red.
#[tauri::command]
pub async fn search_foods_remote(query: String) -> Result<Vec<Value>, String> {
    let query = sanitize_search_query(&query)?;
    let cache = SEARCH_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let guard = cache.lock().map_err(|_| "Caché de búsqueda no disponible.".to_string())?;
        if let Some((stored_at, foods)) = guard.get(&query) {
            if stored_at.elapsed() < SEARCH_CACHE_TTL {
                return Ok(foods.clone());
            }
        }
    }
    // Solo Windows: si OFF nos limitó hace poco, no insistir. Insistir es lo
    // que convierte un 503 puntual en un bloqueo de IP más largo.
    #[cfg(windows)]
    if let Some(wait) = backoff_remaining() {
        return Err(rate_limited_message(wait));
    }

    // Windows: primera pasada con la configuración de red del sistema y segunda
    // con conexión directa (sin proxy). El resto mantiene las dos pasadas con
    // el cliente original: Linux/Android no se tocan.
    #[cfg(windows)]
    let clients = [http_client()?, http_client_no_proxy()?];
    #[cfg(not(windows))]
    let clients = {
        let client = http_client()?;
        [client.clone(), client]
    };

    let started = Instant::now();
    let mut payload: Option<Value> = None;
    let mut last_error = String::new();
    let mut status_error: Option<String> = None;
    #[cfg(windows)]
    let mut limited = false;

    // Windows: el buscador legacy de OFF (`cgi/search.pl`) devuelve 503 de
    // forma masiva (10 de 12 peticiones medidas), así que se prueba primero
    // Search-a-licious: una sola petición de búsqueda, no seis.
    #[cfg(windows)]
    {
        match take_rate_budget(&SEARCH_RATE, SEARCH_RATE_MAX) {
            Ok(()) => {
                let deadline = started + SEARCH_DEADLINE;
                for client in &clients {
                    if let Some(value) = search_alicious(client, &query, deadline).await {
                        payload = Some(value);
                        break;
                    }
                    // Si ya nos limitó, no probar el segundo cliente.
                    #[cfg(windows)]
                    if backoff_remaining().is_some() {
                        break;
                    }
                }
            }
            Err(wait) => return Err(rate_limited_message(wait)),
        }
    }

    // Windows: si Search-a-licious acaba de responder 503/429, no encadenar
    // cuatro peticiones más al legacy: eso alarga el bloqueo de OFF.
    #[cfg(windows)]
    if payload.is_none() {
        if let Some(wait) = backoff_remaining() {
            return Err(rate_limited_message(wait));
        }
    }

    // Solo hosts oficiales escritos en el código: el usuario no controla la URL.
    if payload.is_none() {
        for client in &clients {
            for &endpoint in OFF_SEARCH_ENDPOINTS {
                let remaining = SEARCH_DEADLINE.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    break;
                }
                // Solo Windows: cada intento de respaldo consume presupuesto;
                // si se agotó, se deja de llamar en vez de forzar otro 503.
                #[cfg(windows)]
                if take_rate_budget(&SEARCH_RATE, SEARCH_RATE_MAX).is_err() {
                    break;
                }
                let request = client.get(endpoint).query(&[
                    ("search_terms", query.as_str()),
                    ("json", "1"),
                    ("page_size", &MAX_SEARCH_RESULTS.to_string()),
                    ("fields", OFF_FIELDS),
                ]);
                // Solo Windows: un timeout suelto de 12 s podía rebasar el
                // presupuesto global de 20 s y dejar el spinner colgado.
                #[cfg(windows)]
                let request = request.timeout(remaining);
                match request.send().await {
                    Ok(response) if response.status().is_success() => {
                        match response.json::<Value>().await {
                            Ok(value) => {
                                payload = Some(value);
                                break;
                            }
                            Err(error) => {
                                last_error =
                                    format!("Respuesta inválida de Open Food Facts: {error}");
                            }
                        }
                    }
                    Ok(response) => {
                        let status = response.status();
                        // Solo Windows: 503/429 son el limitador de OFF, no un
                        // fallo de red; activan espera exponencial.
                        #[cfg(windows)]
                        if status.as_u16() == 429 || status.as_u16() == 503 {
                            limited = true;
                        }
                        let detail = status_detail(response).await;
                        let message =
                            format!("Open Food Facts respondió con estado {status}.{detail}");
                        // Conservar el primer estado HTTP: es la causa real aunque los
                        // reintentos posteriores fallen por red/timeout.
                        if status_error.is_none() {
                            status_error = Some(message.clone());
                        }
                        last_error = message;
                    }
                    Err(error) => {
                        last_error = format!("No se pudo consultar Open Food Facts: {error}");
                    }
                }
                if payload.is_some() {
                    break;
                }
            }
            if payload.is_some() {
                break;
            }
        }
    }

    #[cfg(windows)]
    if limited {
        note_rate_limited();
    }

    let payload = match payload {
        Some(payload) => {
            #[cfg(windows)]
            clear_rate_limit();
            payload
        }
        None => {
            // Solo Windows: un 503/429 se explica como lo que es (límite de
            // peticiones anónimas) y se recuerda con backoff, en vez de
            // devolver el estado HTTP crudo.
            #[cfg(windows)]
            if limited {
                return Err(rate_limited_message(
                    backoff_remaining().unwrap_or(BACKOFF_BASE.as_secs()),
                ));
            }
            let message = status_error.unwrap_or_else(|| {
                if last_error.is_empty() {
                    "Open Food Facts no devolvió resultados.".to_string()
                } else {
                    last_error
                }
            });
            return Err(message);
        }
    };

    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();
    if let Some(products) = payload.get("products").and_then(Value::as_array) {
        for product in products {
            let code: String = product
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect();
            if code.is_empty() || !seen.insert(code.clone()) {
                continue;
            }
            if let Some(food) = product_for_barcode(product, &code) {
                results.push(food);
            }
            if results.len() >= MAX_SEARCH_RESULTS {
                break;
            }
        }
    }

    if let Ok(mut guard) = cache.lock() {
        if guard.len() >= SEARCH_CACHE_MAX {
            if let Some(key) = guard.keys().next().cloned() {
                guard.remove(&key);
            }
        }
        guard.insert(query.clone(), (Instant::now(), results.clone()));
    }
    Ok(results)
}

/// El mismo producto puede aparecer como UPC-A de 12 dígitos, EAN-13 con cero
/// inicial o GTIN-14. Open Food Facts indexa una sola forma, así que probamos
/// las variantes antes de decir que el código no existe.
fn barcode_variants(code: &str) -> Vec<String> {
    let clean: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    if !(6..=14).contains(&clean.len()) {
        return Vec::new();
    }

    let mut variants = Vec::new();
    let candidates = [
        clean.clone(),
        clean.trim_start_matches('0').to_string(),
        format!("{clean:0>12}"),
        format!("{clean:0>13}"),
        format!("{clean:0>14}"),
    ];
    for candidate in candidates {
        if !candidate.is_empty() && !variants.contains(&candidate) {
            variants.push(candidate);
        }
    }
    variants
}

async fn fetch_product(client: &reqwest::Client, barcode: &str) -> Result<Option<Value>, String> {
    fetch_product_with_timeout(client, barcode, None).await
}

/// Igual que `fetch_product`, pero con un timeout propio cuando la llamada
/// forma parte de una búsqueda con presupuesto global.
async fn fetch_product_with_timeout(
    client: &reqwest::Client,
    barcode: &str,
    timeout: Option<Duration>,
) -> Result<Option<Value>, String> {
    let url = format!(
        "{OFF_BASE}/{barcode}.json?fields=product_name,product_name_es,generic_name,brands,nutriments,categories_tags,quantity,serving_size"
    );
    let mut request = client.get(&url);
    if let Some(timeout) = timeout {
        request = request.timeout(timeout);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar Open Food Facts: {e}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        let status = response.status();
        let detail = status_detail(response).await;
        return Err(format!("Open Food Facts respondió con estado {status}.{detail}"));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida de Open Food Facts: {e}"))?;

    if payload.get("status").and_then(Value::as_i64) == Some(0) {
        return Ok(None);
    }
    match payload.get("product") {
        Some(product) if product.is_object() => Ok(Some(product.clone())),
        _ => Ok(None),
    }
}

fn product_for_barcode(product: &Value, barcode: &str) -> Option<Value> {
    let name = first_text(
        product,
        &["product_name_es", "product_name", "generic_name"],
    );
    let name = match name {
        Some(name) if !name.trim().is_empty() => name.trim().to_string(),
        _ => return None,
    };
    let brand = first_text(product, &["brands"]).unwrap_or_default();
    let display_name =
        if brand.trim().is_empty() || name.to_lowercase().contains(&brand.to_lowercase()) {
            name
        } else {
            format!("{name} ({brand})")
        };

    let nutriments = product.get("nutriments").unwrap_or(&Value::Null);
    let kcal = number(nutriments, &["energy-kcal_100g"])
        .or_else(|| number(nutriments, &["energy_100g"]).map(|kilojoules| kilojoules / 4.184))
        .unwrap_or(0.0);
    let protein = number(nutriments, &["proteins_100g"]).unwrap_or(0.0);
    let carbs = number(nutriments, &["carbohydrates_100g"]).unwrap_or(0.0);
    let fat = number(nutriments, &["fat_100g"]).unwrap_or(0.0);
    let fiber = number(nutriments, &["fiber_100g"]).unwrap_or(0.0);

    // Sin datos nutricionales no sirve para contar macros; preferimos que el
    // usuario cree el alimento manualmente con la etiqueta del envase.
    if kcal <= 0.0 && protein <= 0.0 && carbs <= 0.0 && fat <= 0.0 {
        return None;
    }

    let category = category_for(product);
    let quantity = first_text(product, &["quantity"]).unwrap_or_default();
    let serving = first_text(product, &["serving_size"]).unwrap_or_default();

    Some(json!({
        "id": format!("off-{barcode}"),
        "name": display_name,
        "category": category,
        "per100": {
            "kcal": round1(kcal),
            "protein": round1(protein),
            "carbs": round1(carbs),
            "fat": round1(fat),
            "fiber": round1(fiber),
        },
        "units": {},
        "custom": true,
        "barcode": barcode,
        "source": "openfoodfacts",
        "quantityLabel": if quantity.is_empty() { Value::Null } else { Value::String(quantity) },
        "servingLabel": if serving.is_empty() { Value::Null } else { Value::String(serving) },
    }))
}

fn first_text(product: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = product.get(*key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn number(value: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        match value.get(*key) {
            Some(Value::Number(number)) => {
                if let Some(number) = number.as_f64() {
                    if number.is_finite() && number >= 0.0 {
                        return Some(number);
                    }
                }
            }
            Some(Value::String(text)) => {
                if let Ok(number) = text.replace(',', ".").parse::<f64>() {
                    if number.is_finite() && number >= 0.0 {
                        return Some(number);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn category_for(product: &Value) -> &'static str {
    let tags = product
        .get("categories_tags")
        .and_then(Value::as_array)
        .map(|tags| {
            tags.iter()
                .filter_map(Value::as_str)
                .map(|tag| tag.to_lowercase())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let has = |needle: &str| tags.iter().any(|tag| tag.contains(needle));

    if has("beverage") || has("drink") || has("water") || has("juice") || has("soda") {
        "bebida"
    } else if has("dairy") || has("milk") || has("cheese") || has("yogurt") {
        "lacteo"
    } else if has("meat") || has("poultry") || has("ham") || has("sausage") {
        "carne"
    } else if has("fish") || has("seafood") {
        "pescado"
    } else if has("egg") {
        "huevo"
    } else if has("fruit") {
        "fruta"
    } else if has("vegetable") || has("salad") {
        "verdura"
    } else if has("legume") || has("bean") {
        "legumbre"
    } else if has("bread") || has("cereal") || has("pasta") || has("rice") {
        "cereal"
    } else if has("nut") || has("seed") {
        "fruto_seco"
    } else if has("oil") || has("fat") || has("butter") {
        "grasa"
    } else if has("sauce") || has("condiment") || has("spice") {
        "condimento"
    } else if has("sweet") || has("snack") || has("chocolate") || has("dessert") {
        "dulce"
    } else if has("supplement") || has("protein") {
        "suplemento"
    } else {
        "procesado"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_upc_and_ean_variants() {
        let variants = barcode_variants("012345678905");
        assert!(variants.contains(&"012345678905".to_string()));
        assert!(variants.contains(&"12345678905".to_string()));
        assert!(variants.contains(&"0012345678905".to_string()));

        let ean = barcode_variants("8412345678905");
        assert!(ean.contains(&"8412345678905".to_string()));
        assert!(ean.contains(&"08412345678905".to_string()));
    }

    #[test]
    fn sanitizes_remote_search_queries() {
        assert_eq!(sanitize_search_query("  pollo   asado  ").unwrap(), "pollo asado");
        assert!(sanitize_search_query("").is_err());
        assert!(sanitize_search_query(&"a".repeat(MAX_QUERY_CHARS + 1)).is_err());
        assert!(sanitize_search_query("leche\n<script>").is_err());
        assert_eq!(sanitize_search_query("café-con-leche").unwrap(), "café-con-leche");
    }

    #[test]
    fn rejects_codes_that_are_not_ean_or_upc() {
        assert!(barcode_variants("123").is_empty());
        assert!(barcode_variants("no-es-un-codigo").is_empty());
    }

    #[test]
    fn keeps_the_entered_code_in_the_product() {
        let product = json!({
            "product_name": "Producto",
            "brands": "Marca",
            "nutriments": { "energy-kcal_100g": 200, "proteins_100g": 10 },
        });
        let parsed = product_for_barcode(&product, "012345678905").unwrap();
        assert_eq!(parsed["barcode"], "012345678905");
        assert_eq!(parsed["id"], "off-012345678905");
        assert_eq!(parsed["name"], "Producto (Marca)");
    }

    #[test]
    fn ignores_products_without_macros() {
        let product = json!({ "product_name": "Agua", "nutriments": {} });
        assert!(product_for_barcode(&product, "012345678905").is_none());
    }

    #[test]
    fn extracts_title_from_error_page() {
        let body = "<html><head><title>Page temporarily unavailable - Open Food Facts</title></head></html>";
        assert_eq!(
            html_title(body),
            "Page temporarily unavailable - Open Food Facts"
        );
        assert_eq!(html_title("<html><body>sin título</body></html>"), "");
    }

    #[test]
    fn sanitizes_search_a_licious_lucene_query() {
        assert_eq!(alicious_query("café-con-leche"), "café-con-leche");
        assert_eq!(alicious_query("¿leche?"), "leche");
        assert_eq!(alicious_query("a+b|c*d"), "a b c d");
        assert_eq!(alicious_query("  pollo   asado  "), "pollo asado");
        assert_eq!(alicious_query("???"), "");
    }

    /// Prueba real contra el servicio (red): `cargo test -- --ignored`.
    #[test]
    #[ignore = "consulta search.openfoodfacts.org; ejecutar con --ignored"]
    fn live_search_alicious_returns_products_with_macros() {
        let client = http_client().unwrap();
        let deadline = Instant::now() + SEARCH_DEADLINE;
        let payload = tauri::async_runtime::block_on(search_alicious(&client, "leche", deadline))
            .expect("search-a-licious debe devolver resultados");
        let products = payload
            .get("products")
            .and_then(Value::as_array)
            .expect("respuesta con products");
        assert!(!products.is_empty());
        assert!(products.iter().all(|product| {
            let code = product.get("code").and_then(Value::as_str).unwrap_or_default();
            product_for_barcode(product, code).is_some()
        }));
    }

    #[test]
    fn rate_budget_blocks_after_limit_and_reports_wait() {
        for _ in 0..SEARCH_RATE_MAX {
            assert!(take_rate_budget(&SEARCH_RATE, SEARCH_RATE_MAX).is_ok());
        }
        let wait = take_rate_budget(&SEARCH_RATE, SEARCH_RATE_MAX).unwrap_err();
        assert!((1..=60).contains(&wait), "espera fuera de rango: {wait}");
        // El presupuesto de producto es independiente del de búsqueda.
        assert!(take_rate_budget(&PRODUCT_RATE, PRODUCT_RATE_MAX).is_ok());
    }

    #[test]
    fn backoff_grows_after_503_and_resets_on_success() {
        clear_rate_limit();
        assert_eq!(backoff_remaining(), None);
        note_rate_limited();
        let first = backoff_remaining().expect("debe haber bloqueo tras un 503");
        assert!((25..=30).contains(&first), "primer backoff: {first}");
        note_rate_limited();
        let second = backoff_remaining().expect("debe seguir bloqueado");
        assert!(second > first, "el backoff debe crecer: {first} -> {second}");
        clear_rate_limit();
        assert_eq!(backoff_remaining(), None);
    }

    #[test]
    fn rate_limited_message_explains_limit_and_wait() {
        let message = rate_limited_message(42);
        assert!(message.contains("42 s"));
        assert!(message.contains("503"));
        assert!(message.contains("búsqueda local"));
    }

    #[test]
    fn off_search_endpoints_are_official_https() {
        // Windows: solo quedan dos hosts legacy como respaldo de
        // Search-a-licious, para no multiplicar peticiones contra el límite.
        #[cfg(windows)]
        assert_eq!(OFF_SEARCH_ENDPOINTS.len(), 2);
        // En Linux/Android se conservan los 3 endpoints originales.
        #[cfg(not(windows))]
        assert_eq!(OFF_SEARCH_ENDPOINTS.len(), 3);
        let mut unique = std::collections::HashSet::new();
        for endpoint in OFF_SEARCH_ENDPOINTS {
            assert!(endpoint.starts_with("https://"));
            assert!(!endpoint.contains(".."));
            let host = endpoint.split('/').nth(2).unwrap();
            assert!(host.ends_with(".openfoodfacts.org"));
            assert!(unique.insert(*endpoint));
        }
    }
}
