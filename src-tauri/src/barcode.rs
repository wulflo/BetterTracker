use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/* ------------------------------------------------------------------ */
/* Búsqueda de productos por código de barras (Open Food Facts)       */
/* ------------------------------------------------------------------ */

const OFF_BASE: &str = "https://world.openfoodfacts.org/api/v2/product";
const OFF_SEARCH: &str = "https://world.openfoodfacts.org/cgi/search.pl";
/// Segundo host oficial de Open Food Facts: `world` devuelve 503 con frecuencia.
const OFF_SEARCH_FALLBACK: &str = "https://fr.openfoodfacts.org/cgi/search.pl";
const OFF_FIELDS: &str = "code,product_name,product_name_es,generic_name,brands,nutriments,categories_tags,quantity,serving_size";
const TIMEOUT: Duration = Duration::from_secs(12);
const MAX_QUERY_CHARS: usize = 80;
const MAX_SEARCH_RESULTS: usize = 8;
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(600);
const SEARCH_CACHE_MAX: usize = 24;

/// Caché pequeña y con caducidad: evita repetir la misma búsqueda al teclear
/// y crece como máximo hasta `SEARCH_CACHE_MAX` entradas.
static SEARCH_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<Value>)>>> = OnceLock::new();

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

    let client = http_client()?;
    let mut payload: Option<Value> = None;
    let mut last_error = String::new();
    // Solo hosts oficiales escritos en el código: el usuario no controla la URL.
    for endpoint in [OFF_SEARCH, OFF_SEARCH_FALLBACK] {
        let request = client.get(endpoint).query(&[
            ("search_terms", query.as_str()),
            ("json", "1"),
            ("page_size", &MAX_SEARCH_RESULTS.to_string()),
            ("fields", OFF_FIELDS),
        ]);
        match request.send().await {
            Ok(response) if response.status().is_success() => {
                match response.json::<Value>().await {
                    Ok(value) => {
                        payload = Some(value);
                        break;
                    }
                    Err(error) => {
                        last_error = format!("Respuesta inválida de Open Food Facts: {error}");
                    }
                }
            }
            Ok(response) => {
                last_error = format!(
                    "Open Food Facts respondió con estado {}.",
                    response.status()
                );
            }
            Err(error) => {
                last_error = format!("No se pudo consultar Open Food Facts: {error}");
            }
        }
    }
    let payload = payload.ok_or_else(|| {
        if last_error.is_empty() {
            "Open Food Facts no devolvió resultados.".to_string()
        } else {
            last_error
        }
    })?;

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
        guard.insert(query, (Instant::now(), results.clone()));
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
    let url = format!(
        "{OFF_BASE}/{barcode}.json?fields=product_name,product_name_es,generic_name,brands,nutriments,categories_tags,quantity,serving_size"
    );
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar Open Food Facts: {e}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!(
            "Open Food Facts respondió con estado {}.",
            response.status()
        ));
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
}
