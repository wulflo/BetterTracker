//! Almacenamiento local de la bóveda.
//!
//! La app solo usa `<bóveda>/omega` como fuente de datos. Cada evento se guarda
//! como archivo propio en `omega/devices/<device>/events/<id>.json` para que
//! un sincronizador externo no tenga que fusionar un JSONL compartido. Las copias diarias
//! viven en `<bóveda>/longlife/<device>/<AAAA-MM-DD>` (antes `Longlife`, que se
//! migra al abrir la bóveda y se sigue leyendo como legado) y se pueden listar,
//! restaurar (solo eventos que falten) o borrar desde Ajustes.
//!
//! En Android la bóveda se elige con el selector SAF y se conserva el permiso
//! entre reinicios, igual que en SinNotas. En escritorio se usa una carpeta
//! normal del sistema.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{AndroidFsExt, FsUri, UriPermission};

pub const DATA_DIR: &str = "omega";
const DEVICES_DIR: &str = "devices";
const EVENTS_FILE: &str = "events.jsonl";
const EVENTS_DIR: &str = "events";
/// Nombre nuevo de la carpeta de copias, en minúsculas, para no crear dos
/// carpetas distintas cuando la bóveda se sincroniza entre sistemas
/// operativos que distinguen mayúsculas (Linux, Android/SAF).
pub const BACKUP_DIR: &str = "longlife";
/// Nombre heredado. Se sigue leyendo como legado y se migra al abrir la
/// bóveda en escritorio.
pub const LEGACY_BACKUP_DIR: &str = "Longlife";
const BACKUP_MARKER: &str = ".backup-complete";
const SNAPSHOT_META: &str = "snapshot.json";
/// Índice centralizado de una copia: todos sus eventos en un solo NDJSON.
/// Permite restaurar con una sola lectura SAF en vez de una por evento.
const SNAPSHOT_INDEX: &str = "snapshot-events.jsonl";
pub const BACKUP_RETENTION: usize = 7;
#[cfg(target_os = "android")]
const MAX_SAF_DEPTH: usize = 64;
/// Límites de la lectura local: evita bucles por symlinks, árboles absurdos y
/// archivos gigantes sincronizados por error.
const MAX_LOCAL_DEPTH: usize = 16;
const MAX_LOCAL_EVENT_BYTES: u64 = 8 * 1024 * 1024;

/// Serializa las escrituras dentro del proceso para que dos comandos no
/// compitan por el mismo archivo de evento o por la copia diaria.
static WRITE_LOCK: Mutex<()> = Mutex::new(());
/// Copias y restauraciones son lentas en SAF: van con su propio lock para que
/// no bloqueen los `append_event` (guardar peso, agua, ejercicios…).
static BACKUP_LOCK: Mutex<()> = Mutex::new(());
/// `config.json` se lee-modifica-escribe desde varios comandos: sin este lock
/// `get_device_id` puede pisar la bóveda recién seleccionada (o al revés).
static CONFIG_LOCK: Mutex<()> = Mutex::new(());
/// Protege el índice persistente y su journal de deltas.
static INDEX_LOCK: Mutex<()> = Mutex::new(());

const EVENT_INDEX_FILE: &str = "events-index.json";
const EVENT_DELTA_FILE: &str = "events-index.delta.jsonl";
const EVENT_INDEX_MAGIC: &str = "BTI1";
const EVENT_INDEX_VERSION: u32 = 1;
/// Compactar el journal de deltas tras este número de registros.
const EVENT_DELTA_COMPACT: usize = 256;
/// Un índice corrupto o gigante se descarta y se reconstruye desde la bóveda.
const MAX_EVENT_INDEX_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Event {
    pub id: String,
    pub device_id: String,
    pub timestamp: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

/// Entrada del índice persistente: un archivo de la bóveda ya parseado, con
/// huella (mtime + tamaño) para saber si hay que volver a leerlo.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct IndexedFile {
    relative: String,
    modified: u128,
    len: u64,
    events: Vec<Event>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct IndexDelta {
    relative: String,
    modified: u128,
    len: u64,
    events: Vec<Event>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct EventIndex {
    magic: String,
    version: u32,
    vault: String,
    files: Vec<IndexedFile>,
}


/// Un evento se guarda en su propio archivo para que un sincronizador externo nunca tenga que
/// fusionar dos versiones del mismo JSONL. El nombre es el id del evento, que
/// es único y estable.
fn event_file_name(event: &Event) -> Result<String, String> {
    if event.id.is_empty()
        || event.id.len() > 128
        || !event
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("El identificador del evento no es válido.".to_string());
    }
    Ok(format!("{}.json", event.id))
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data dir")
}

fn config_path(app: &AppHandle) -> PathBuf {
    app_data_dir(app).join("config.json")
}

/// Restringe los datos locales al usuario actual. En sistemas de archivos sin
/// permisos POSIX (exFAT/NTFS) el cambio puede fallar: se registra y se sigue,
/// porque la app debe funcionar igual en una carpeta sincronizada.
#[cfg(unix)]
fn harden_permissions(path: &Path, is_dir: bool) {
    use std::os::unix::fs::PermissionsExt;
    let mode = if is_dir { 0o700 } else { 0o600 };
    if let Err(error) = fs::set_permissions(path, fs::Permissions::from_mode(mode)) {
        eprintln!(
            "No se pudieron ajustar los permisos de {}: {error}",
            path.display()
        );
    }
}

#[cfg(not(unix))]
fn harden_permissions(_path: &Path, _is_dir: bool) {}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Config {
    pub vault_path: Option<String>,
    #[serde(default)]
    pub vault_label: Option<String>,
    pub device_id: Option<String>,
    /// Fecha en la que el usuario borró las copias. Evita que la copia
    /// automática vuelva a crearlas el mismo día.
    #[serde(default)]
    pub backup_skip_date: Option<String>,
}

fn load_config(app: &AppHandle) -> Config {
    let p = config_path(app);
    if let Ok(s) = fs::read_to_string(&p) {
        serde_json::from_str(&s).unwrap_or_default()
    } else {
        Config::default()
    }
}

fn save_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let p = config_path(app);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo preparar la configuración: {error}"))?;
        harden_permissions(parent, true);
    }
    let text = serde_json::to_string_pretty(cfg)
        .map_err(|error| format!("No se pudo serializar la configuración: {error}"))?;
    // Escritura atómica: un corte durante el guardado no debe dejar un
    // `config.json` truncado que la app interprete como «sin bóveda».
    let tmp = p.with_file_name(format!(
        ".config.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    {
        let mut handle = fs::File::create(&tmp)
            .map_err(|error| format!("No se pudo guardar la configuración: {error}"))?;
        handle
            .write_all(text.as_bytes())
            .map_err(|error| format!("No se pudo guardar la configuración: {error}"))?;
        handle
            .sync_all()
            .map_err(|error| format!("No se pudo confirmar la configuración: {error}"))?;
    }
    harden_permissions(&tmp, false);
    match fs::rename(&tmp, &p) {
        Ok(()) => Ok(()),
        Err(_) if p.exists() => {
            // Windows no reemplaza el destino con `rename`.
            let _ = fs::remove_file(&p);
            fs::rename(&tmp, &p)
                .map_err(|error| format!("No se pudo publicar la configuración: {error}"))
        }
        Err(error) => {
            let _ = fs::remove_file(&tmp);
            Err(format!("No se pudo publicar la configuración: {error}"))
        }
    }
}

pub fn device_id(app: &AppHandle) -> String {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut cfg = load_config(app);
    if cfg
        .device_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        cfg.device_id = Some(uuid::Uuid::new_v4().to_string());
        let _ = save_config(app, &cfg);
    }
    cfg.device_id.unwrap_or_default()
}

/* ------------------------------------------------------------------ */
/* Ubicación activa                                                   */
/* ------------------------------------------------------------------ */

#[cfg(target_os = "android")]
struct SafLocation {
    root: FsUri,
}

#[cfg_attr(target_os = "android", allow(dead_code))]
enum VaultLocation {
    Local(PathBuf),
    #[cfg(target_os = "android")]
    Saf(SafLocation),
}

/// Representación de una raíz SAF independiente del plugin. Se mantiene aparte
/// de `FsUri` para poder probar el parser también en escritorio (`cargo test`).
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct SafRoot {
    uri: String,
    document_top_tree_uri: Option<String>,
}

/// Reconoce la representación serializada de `FsUri` que produce
/// `tauri-plugin-android-fs` 30.x (`{"uri":…,"documentTopTreeUri":…}`) y la de
/// 2.x (`{"topTreeUri":…,"relativeTerms":[]}`), además de una URI `content://`
/// plana por compatibilidad.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn parse_saf_root(root_path: &str) -> Result<Option<SafRoot>, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.starts_with("content://") || trimmed.starts_with("file://") {
        return Ok(Some(SafRoot {
            uri: trimmed.to_string(),
            document_top_tree_uri: Some(trimmed.to_string()),
        }));
    }

    if !trimmed.starts_with('{') {
        return Ok(None);
    }

    let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return Ok(None);
    };

    // Formato del plugin 30.x.
    if let Some(uri) = value.get("uri").and_then(|value| value.as_str()) {
        if !uri.starts_with("content://") && !uri.starts_with("file://") {
            return Ok(None);
        }
        return Ok(Some(SafRoot {
            uri: uri.to_string(),
            document_top_tree_uri: value
                .get("documentTopTreeUri")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        }));
    }

    // Formato del plugin 2.x. La raíz elegida con el selector se guardaba con
    // `relativeTerms` vacío, así que basta con su `topTreeUri`.
    let Some(top_tree_uri) = value.get("topTreeUri").and_then(|value| value.as_str()) else {
        return Ok(None);
    };
    if !top_tree_uri.starts_with("content://") {
        return Ok(None);
    }
    Ok(Some(SafRoot {
        uri: top_tree_uri.to_string(),
        document_top_tree_uri: Some(top_tree_uri.to_string()),
    }))
}

#[cfg(target_os = "android")]
fn saf_uri_from_root(root_path: &str) -> Result<Option<FsUri>, String> {
    Ok(parse_saf_root(root_path)?.map(|root| FsUri {
        uri: root.uri,
        document_top_tree_uri: root.document_top_tree_uri,
    }))
}

/// Comprueba que el permiso persistido sigue vigente. Si el plugin no puede
/// hacer la comprobación, se deja que falle la operación real con su error
/// concreto en lugar de bloquear una comprobación opcional.
#[cfg(target_os = "android")]
fn ensure_saf_permission(app: &AppHandle, root: &FsUri) -> Result<(), String> {
    if !root.uri.starts_with("content://") {
        return Ok(());
    }
    if let Ok(granted) = app
        .android_fs()
        .picker()
        .check_persisted_uri_permission(root, UriPermission::ReadAndWrite)
    {
        if !granted {
            return Err(
                "El permiso de la bóveda Android se ha perdido. Selecciónala de nuevo en Ajustes."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn current_location(app: &AppHandle) -> Result<Option<VaultLocation>, String> {
    let cfg = load_config(app);
    let Some(raw) = cfg.vault_path else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    #[cfg(target_os = "android")]
    {
        if let Some(dir) = saf_uri_from_root(trimmed)? {
            ensure_saf_permission(app, &dir)?;
            return Ok(Some(VaultLocation::Saf(SafLocation { root: dir })));
        }
        // En Android la bóveda siempre es SAF. Caer en `std::fs` con una URI
        // content:// o con un JSON del selector producía errores de escritura
        // engañosos; mejor decir qué ha pasado y cómo recuperarlo.
        return Err(
            "La bóveda guardada no es una carpeta SAF válida. Selecciónala de nuevo en Ajustes."
                .to_string(),
        );
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(Some(VaultLocation::Local(PathBuf::from(trimmed))))
    }
}

/// Nombre legible para una raíz guardada. Para SAF no se puede reconstruir el
/// nombre real sin consultar el plugin, así que se usa una etiqueta estable.
fn label_from_path(raw: &str) -> String {
    if raw.starts_with('{') || raw.starts_with("content://") {
        return "Bóveda Android".to_string();
    }
    Path::new(raw)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Bóveda")
        .to_string()
}

fn save_selection(app: &AppHandle, raw: &str, label: &str) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut cfg = load_config(app);
    cfg.vault_path = Some(raw.to_string());
    cfg.vault_label = Some(label.to_string());
    cfg.backup_skip_date = None;
    save_config(app, &cfg)?;
    Ok(())
}

#[derive(Serialize, Clone)]
pub struct VaultInfo {
    pub path: Option<String>,
    pub label: Option<String>,
    /// Ruta visible de los datos. En SAF se muestra solo `omega`.
    pub data_dir: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct VaultSelection {
    pub path: String,
    pub label: String,
}

pub fn vault_info(app: &AppHandle) -> VaultInfo {
    let cfg = load_config(app);
    let path = cfg
        .vault_path
        .clone()
        .filter(|value| !value.trim().is_empty());
    let label = cfg
        .vault_label
        .clone()
        .or_else(|| path.as_deref().map(label_from_path));
    let data_dir = path.as_deref().map(|raw| {
        #[cfg(target_os = "android")]
        {
            if raw.starts_with('{') || raw.starts_with("content://") {
                return DATA_DIR.to_string();
            }
        }
        Path::new(raw).join(DATA_DIR).to_string_lossy().into_owned()
    });

    VaultInfo {
        path,
        label,
        data_dir,
    }
}

/// Selección SAF. `AndroidFsExt::android_fs()` es la API **bloqueante** del
/// plugin: debe ejecutarse en `spawn_blocking`, nunca en el hilo async de Tauri.
#[cfg(target_os = "android")]
fn select_vault_saf(app: &AppHandle) -> Result<VaultSelection, String> {
    let api = app.android_fs();
    let Some(dir_uri) = api
        .picker()
        .pick_dir(None, false)
        .map_err(|error| format!("No se pudo abrir el selector de carpetas: {error}"))?
    else {
        return Err("cancelled".to_string());
    };

    api.picker()
        .persist_uri_permission(&dir_uri)
        .map_err(|error| format!("No se pudo conservar el permiso de la carpeta: {error}"))?;

    let serialized = dir_uri
        .to_json_string()
        .map_err(|error| format!("La ruta SAF no es válida: {error}"))?;
    let label = api
        .get_name(&dir_uri)
        .unwrap_or_else(|_| "Bóveda Android".to_string());

    save_selection(app, &serialized, &label)?;
    Ok(VaultSelection {
        path: serialized,
        label,
    })
}

/// Abre el selector de carpetas. En Android usa SAF y conserva el permiso de
/// lectura/escritura; en escritorio usa el diálogo nativo.
#[tauri::command]
pub async fn select_vault(app: AppHandle) -> Result<VaultSelection, String> {
    #[cfg(target_os = "android")]
    {
        let app2 = app.clone();
        return tauri::async_runtime::spawn_blocking(move || select_vault_saf(&app2))
            .await
            .map_err(|error| format!("No se pudo abrir el selector de carpetas: {error}"))?;
    }

    #[cfg(target_os = "ios")]
    {
        let _ = app;
        Err("En iOS se usa la bóveda interna de la aplicación.".to_string())
    }

    #[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
    {
        use tauri_plugin_dialog::DialogExt;

        let app2 = app.clone();
        let handle = tauri::async_runtime::spawn_blocking(move || {
            app2.dialog().file().blocking_pick_folder()
        });
        let folder = handle.await.map_err(|e| e.to_string())?;
        let Some(fp) = folder else {
            return Err("cancelled".to_string());
        };
        let path = fp.into_path().map_err(|e| e.to_string())?;
        ensure_local_layout(&path)?;
        let raw = path.to_string_lossy().into_owned();
        let label = label_from_path(&raw);
        save_selection(&app, &raw, &label)?;
        Ok(VaultSelection { path: raw, label })
    }
}

#[tauri::command]
pub fn get_vault_info(app: AppHandle) -> VaultInfo {
    vault_info(&app)
}

/* ------------------------------------------------------------------ */
/* Layout local y migración                                           */
/* ------------------------------------------------------------------ */

fn ensure_local_layout(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("No se pudo crear la bóveda: {e}"))?;

    let omega = root.join(DATA_DIR);
    let omega_devices = omega.join(DEVICES_DIR);
    let legacy_devices = root.join(DEVICES_DIR);

    // Versiones anteriores guardaban `devices/` en la raíz de la bóveda. Se
    // mueve una sola vez para que la app siga leyendo todo desde `omega`.
    if legacy_devices.is_dir() {
        fs::create_dir_all(&omega).map_err(|e| format!("No se pudo crear omega: {e}"))?;
        fs::create_dir_all(&omega_devices)
            .map_err(|e| format!("No se pudo crear la carpeta de eventos: {e}"))?;
        if let Ok(entries) = fs::read_dir(&legacy_devices) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let target = omega_devices.join(&name);
                if target.exists() {
                    // Si ya existe un dispositivo con ese nombre, no se
                    // descarta la copia antigua: se conserva aparte para que
                    // `read_events` la siga leyendo.
                    let fallback = omega_devices.join(format!(
                        "legacy-{}-{}",
                        name.to_string_lossy(),
                        uuid::Uuid::new_v4()
                    ));
                    if fs::rename(entry.path(), &fallback).is_err() {
                        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
                        if is_dir {
                            copy_dir_recursive(&entry.path(), &fallback)?;
                        } else {
                            fs::copy(entry.path(), &fallback).map_err(|e| {
                                format!("No se pudo conservar un dato antiguo de la bóveda: {e}")
                            })?;
                            harden_permissions(&fallback, false);
                        }
                    }
                    continue;
                }
                if fs::rename(entry.path(), &target).is_err() {
                    let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
                    if is_dir {
                        copy_dir_recursive(&entry.path(), &target)?;
                    } else {
                        fs::copy(entry.path(), &target).map_err(|e| {
                            format!("No se pudo migrar un dato antiguo de la bóveda: {e}")
                        })?;
                        harden_permissions(&target, false);
                    }
                }
            }
        }
        let _ = fs::remove_dir(&legacy_devices);
    }

    fs::create_dir_all(&omega_devices)
        .map_err(|e| format!("No se pudo crear la carpeta de eventos: {e}"))?;
    harden_permissions(&omega, true);
    harden_permissions(&omega_devices, true);
    Ok(())
}

fn validate_device_id(device_id: &str) -> Result<(), String> {
    if device_id.is_empty()
        || device_id.len() > 128
        || !device_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("El identificador del dispositivo no es válido.".to_string());
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Lectura y escritura de eventos                                     */
/* ------------------------------------------------------------------ */

pub fn append_event(app: &AppHandle, event: &Event) -> Result<(), String> {
    validate_device_id(&event.device_id)?;
    let file_name = event_file_name(event)?;
    let location =
        current_location(app)?.ok_or_else(|| "No hay una bóveda seleccionada.".to_string())?;
    let payload = serde_json::to_vec(event).map_err(|e| e.to_string())?;

    {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        match &location {
            VaultLocation::Local(root) => write_local_event(root, event, &file_name, &payload),
            #[cfg(target_os = "android")]
            VaultLocation::Saf(saf) => {
                let relative = format!(
                    "{DATA_DIR}/{DEVICES_DIR}/{}/{EVENTS_DIR}/{file_name}",
                    event.device_id
                );
                // `resolve_file_uri` es una sola llamada al plugin; recorrer el
                // árbol componente a componente con `read_dir` costaba varias
                // listados completos por evento guardado.
                if let Ok(existing) = app
                    .android_fs()
                    .resolve_file_uri(&saf.root, &relative)
                {
                    // Un archivo de 0 bytes de un write anterior interrumpido
                    // no es un evento guardado: se reescribe.
                    if app.android_fs().get_len(&existing).unwrap_or(0) == 0 {
                        app.android_fs()
                            .write(&existing, &payload)
                            .map_err(|e| format!("No se pudo reparar el evento: {e}"))?;
                    }
                    return Ok(());
                }
                saf_write_new_file(app, &saf.root, &relative, "application/json", &payload)
            }
        }
    }?;

    // Delta del índice: solo lo nuevo, sin reescribir todo el índice.
    #[cfg(not(target_os = "android"))]
    {
        let VaultLocation::Local(root) = &location;
        let path = root
            .join(DATA_DIR)
            .join(DEVICES_DIR)
            .join(&event.device_id)
            .join(EVENTS_DIR)
            .join(&file_name);
        if let Ok(metadata) = fs::metadata(&path) {
            let relative = format!(
                "{DEVICES_DIR}/{}/{EVENTS_DIR}/{file_name}",
                event.device_id
            );
            append_index_delta(
                app,
                &relative,
                file_modified_ms(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
                metadata.len(),
                vec![event.clone()],
            );
        }
    }

    // La copia de hoy debe incluir lo que se acaba de guardar. Antes solo se
    // hacía al arrancar (o cada 6 h), así que lo creado durante el día podía
    // quedarse fuera de longlife hasta el día siguiente. Es best-effort: si
    // falla la copia, el evento ya está guardado y no se debe deshacer.
    match &location {
        VaultLocation::Local(root) => {
            let _ = sync_today_backup(app, root, event, &file_name);
        }
        #[cfg(target_os = "android")]
        VaultLocation::Saf(_) => {}
    }

    Ok(())
}

/// Refleja un evento recién guardado en la copia longlife de hoy. Si la copia
/// todavía no existe (por ejemplo, la app arrancó con la bóveda vacía), crea
/// la copia completa; si existe, copia solo el archivo nuevo y actualiza el
/// manifiesto. Nunca toca una copia incompleta: de eso se encarga la
/// reparación de `run_daily_backup`.
fn sync_today_backup(
    app: &AppHandle,
    root: &Path,
    event: &Event,
    file_name: &str,
) -> Result<(), String> {
    let day = root
        .join(BACKUP_DIR)
        .join(&event.device_id)
        .join(today());
    if !day.join(BACKUP_MARKER).is_file() {
        run_daily_backup(app, false)?;
        return Ok(());
    }

    sync_backup_event_files(&day, root, event, file_name)
}

fn sync_backup_event_files(
    day: &Path,
    root: &Path,
    event: &Event,
    file_name: &str,
) -> Result<(), String> {
    let relative = Path::new(DEVICES_DIR)
        .join(&event.device_id)
        .join(EVENTS_DIR)
        .join(file_name);
    let target = day.join(&relative);
    if target.is_file() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("No se pudo preparar la copia: {e}"))?;
        harden_permissions(parent, true);
    }
    fs::copy(root.join(DATA_DIR).join(&relative), &target)
        .map_err(|e| format!("No se pudo actualizar la copia: {e}"))?;
    harden_permissions(&target, false);

    if let Some(mut meta) = read_local_meta(day) {
        let (files, bytes) = count_dir(day)?;
        meta.files = Some(files);
        meta.bytes = Some(bytes);
        let text = serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?;
        let meta_path = day.join(SNAPSHOT_META);
        fs::write(&meta_path, text).map_err(|e| format!("No se pudo describir la copia: {e}"))?;
        harden_permissions(&meta_path, false);
    }

    Ok(())
}

fn write_local_event(
    root: &Path,
    event: &Event,
    file_name: &str,
    payload: &[u8],
) -> Result<(), String> {
    ensure_local_layout(root)?;
    let dir = root
        .join(DATA_DIR)
        .join(DEVICES_DIR)
        .join(&event.device_id)
        .join(EVENTS_DIR);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear la carpeta del dispositivo: {e}"))?;
    if let Some(device_dir) = dir.parent() {
        harden_permissions(device_dir, true);
    }
    harden_permissions(&dir, true);
    let file = dir.join(file_name);
    if file.is_file() {
        harden_permissions(&file, false);
        return Ok(());
    }

    // Escribir en un temporal y renombrar evita que un lector (o un sincronizador externo)
    // vea un evento a medias.
    let tmp = dir.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    {
        let mut handle = fs::File::create(&tmp)
            .map_err(|e| format!("No se pudo abrir el archivo de eventos: {e}"))?;
        harden_permissions(&tmp, false);
        handle
            .write_all(payload)
            .map_err(|e| format!("No se pudo escribir el evento: {e}"))?;
        handle
            .sync_all()
            .map_err(|e| format!("No se pudo confirmar el evento: {e}"))?;
    }
    match fs::rename(&tmp, &file) {
        Ok(()) => Ok(()),
        Err(_) if file.is_file() => {
            let _ = fs::remove_file(&tmp);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&tmp);
            Err(format!("No se pudo publicar el evento: {error}"))
        }
    }
}

enum IndexSource {
    Local(PathBuf),
    #[cfg(target_os = "android")]
    Saf(FsUri),
}

fn event_index_path(app: &AppHandle) -> PathBuf {
    app_data_dir(app).join(EVENT_INDEX_FILE)
}

fn event_delta_path(app: &AppHandle) -> PathBuf {
    app_data_dir(app).join(EVENT_DELTA_FILE)
}

/// Registro append-only: tras cada guardado se escribe solo el evento nuevo,
/// sin reescribir el índice completo.
fn append_index_delta(
    app: &AppHandle,
    relative: &str,
    modified: u128,
    len: u64,
    events: Vec<Event>,
) {
    let delta = IndexDelta {
        relative: relative.to_string(),
        modified,
        len,
        events,
    };
    let Ok(text) = serde_json::to_string(&delta) else { return };
    let path = event_delta_path(app);
    let result = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(format!("{text}\n").as_bytes()));
    if let Err(error) = result {
        eprintln!("No se pudo registrar el delta del índice: {error}");
    }
}

fn load_index_deltas(app: &AppHandle) -> Vec<IndexDelta> {
    let Ok(text) = fs::read_to_string(event_delta_path(app)) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<IndexDelta>(line).ok())
        .collect()
}

fn clear_index_deltas(app: &AppHandle) {
    let _ = fs::write(event_delta_path(app), b"");
}

fn file_modified_ms(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn empty_event_index(vault: &str) -> EventIndex {
    EventIndex {
        magic: EVENT_INDEX_MAGIC.to_string(),
        version: EVENT_INDEX_VERSION,
        vault: vault.to_string(),
        files: Vec::new(),
    }
}

/// Un índice corrupto, de otra versión o de otra bóveda se descarta: se
/// reconstruye desde los archivos, sin tocar nunca la bóveda.
fn load_event_index(app: &AppHandle, vault: &str) -> EventIndex {
    let path = event_index_path(app);
    let Ok(metadata) = fs::metadata(&path) else {
        return empty_event_index(vault);
    };
    if metadata.len() > MAX_EVENT_INDEX_BYTES {
        return empty_event_index(vault);
    }
    let Ok(text) = fs::read_to_string(&path) else {
        return empty_event_index(vault);
    };
    parse_event_index(&text, vault)
}

fn parse_event_index(text: &str, vault: &str) -> EventIndex {
    match serde_json::from_str::<EventIndex>(text) {
        Ok(index)
            if index.magic == EVENT_INDEX_MAGIC
                && index.version == EVENT_INDEX_VERSION
                && index.vault == vault =>
        {
            index
        }
        _ => empty_event_index(vault),
    }
}

fn save_event_index(app: &AppHandle, index: &EventIndex) -> Result<(), String> {
    let path = event_index_path(app);
    let text = serde_json::to_string(index).map_err(|e| e.to_string())?;
    let tmp = path.with_file_name(format!(".events-index.{}.tmp", uuid::Uuid::new_v4().simple()));
    {
        let mut handle = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        handle.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        handle.sync_all().map_err(|e| e.to_string())?;
    }
    match fs::rename(&tmp, &path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            let _ = fs::remove_file(&path);
            fs::rename(&tmp, &path).map_err(|e| e.to_string())
        }
        Err(error) => {
            let _ = fs::remove_file(&tmp);
            Err(error.to_string())
        }
    }
}

#[cfg(not(target_os = "android"))]
fn collect_local_index_files(
    dir: &Path,
    prefix: &str,
    depth: usize,
    out: &mut Vec<(String, IndexSource, u128, u64)>,
) {
    if depth > MAX_LOCAL_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name == SNAPSHOT_META || name == BACKUP_MARKER || name.ends_with(".tmp") {
            continue;
        }
        let relative = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}/{name}")
        };
        if kind.is_dir() {
            collect_local_index_files(&entry.path(), &relative, depth + 1, out);
        } else if kind.is_file() && (name == EVENTS_FILE || name.ends_with(".json")) {
            if let Ok(metadata) = fs::metadata(entry.path()) {
                if metadata.len() <= MAX_LOCAL_EVENT_BYTES {
                    out.push((
                        relative,
                        IndexSource::Local(entry.path()),
                        file_modified_ms(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
                        metadata.len(),
                    ));
                }
            }
        }
    }
}

#[cfg(target_os = "android")]
fn collect_saf_index_files(
    app: &AppHandle,
    dir: &FsUri,
    prefix: &str,
    depth: usize,
    out: &mut Vec<(String, IndexSource, u128, u64)>,
) {
    if depth > MAX_SAF_DEPTH {
        return;
    }
    let entries = match app.android_fs().read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!("No se pudo indexar una carpeta SAF: {error}");
            return;
        }
    };
    for entry in entries {
        let name = entry.name();
        if name.is_empty()
            || name == "."
            || name == ".."
            || name == SNAPSHOT_META
            || name == BACKUP_MARKER
            || name == SNAPSHOT_INDEX
            || name.ends_with(".tmp")
        {
            continue;
        }
        let relative = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}/{name}")
        };
        if entry.is_dir() {
            collect_saf_index_files(app, entry.uri(), &relative, depth + 1, out);
        } else if name == EVENTS_FILE || name.ends_with(".json") {
            let len = entry.file_len().unwrap_or(0);
            if len <= MAX_LOCAL_EVENT_BYTES && len > 0 {
                out.push((
                    relative,
                    IndexSource::Saf(entry.uri().clone()),
                    file_modified_ms(entry.last_modified()),
                    len,
                ));
            }
        }
    }
}

/// Huella barata del estado de la bóveda (solo metadatos, sin contenido).
/// La UI la usa para saltar `listEvents()` cuando nada cambió.
pub fn vault_fingerprint(app: &AppHandle) -> Result<String, String> {
    let location =
        current_location(app)?.ok_or_else(|| "No hay una bóveda seleccionada.".to_string())?;
    let mut files: Vec<(String, IndexSource, u128, u64)> = Vec::new();
    match &location {
        #[cfg(not(target_os = "android"))]
        VaultLocation::Local(root) => {
            let devices = root.join(DATA_DIR).join(DEVICES_DIR);
            collect_local_index_files(&devices, "", 0, &mut files);
        }
        #[cfg(target_os = "android")]
        VaultLocation::Saf(saf) => {
            let Some(omega) = saf_find_dir(app, &saf.root, DATA_DIR)? else {
                return Ok(String::new());
            };
            let Some(devices) = saf_find_dir(app, &omega, DEVICES_DIR)? else {
                return Ok(String::new());
            };
            collect_saf_index_files(app, &devices, "", 0, &mut files);
        }
        #[cfg(target_os = "android")]
        VaultLocation::Local(_) => unreachable!("en Android la bóveda siempre es SAF"),
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = DefaultHasher::new();
    for (relative, _, modified, len) in files {
        relative.hash(&mut hasher);
        modified.hash(&mut hasher);
        len.hash(&mut hasher);
    }
    Ok(format!("{:x}", hasher.finish()))
}

/// Reconcilia el índice persistente con la bóveda: solo se leen los archivos
/// nuevos o modificados. En SAF esto elimina una llamada IPC por evento en
/// cada refresco; en escritorio evita volver a parsear todos los JSON.
fn indexed_events(app: &AppHandle) -> Result<Vec<Event>, String> {
    let location = current_location(app)?.ok_or_else(|| "No hay una bóveda seleccionada.".to_string())?;
    let vault = load_config(app).vault_path.unwrap_or_default();
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = load_event_index(app, &vault);
    let deltas = load_index_deltas(app);
    let delta_count = deltas.len();
    for delta in deltas {
        index.files.retain(|entry| entry.relative != delta.relative);
        index.files.push(IndexedFile {
            relative: delta.relative,
            modified: delta.modified,
            len: delta.len,
            events: delta.events,
        });
    }

    let mut current: Vec<(String, IndexSource, u128, u64)> = Vec::new();
    match &location {
        #[cfg(not(target_os = "android"))]
        VaultLocation::Local(root) => {
            let devices = root.join(DATA_DIR).join(DEVICES_DIR);
            collect_local_index_files(&devices, "", 0, &mut current);
        }
        #[cfg(target_os = "android")]
        VaultLocation::Saf(saf) => {
            let Some(omega) = saf_find_dir(app, &saf.root, DATA_DIR)? else {
                return Ok(Vec::new());
            };
            let Some(devices) = saf_find_dir(app, &omega, DEVICES_DIR)? else {
                return Ok(Vec::new());
            };
            collect_saf_index_files(app, &devices, "", 0, &mut current);
        }
        #[cfg(target_os = "android")]
        VaultLocation::Local(_) => unreachable!("en Android la bóveda siempre es SAF"),
    }

    index.files.retain(|entry| {
        current.iter().any(|(relative, _, modified, len)| {
            *relative == entry.relative && *modified == entry.modified && *len == entry.len
        })
    });

    for (relative, source, modified, len) in current {
        if index.files.iter().any(|entry| entry.relative == relative) {
            continue;
        }
        let content = match &source {
            IndexSource::Local(path) => fs::read_to_string(path).ok(),
            #[cfg(target_os = "android")]
            IndexSource::Saf(uri) => app.android_fs().read_to_string(uri).ok(),
        };
        let Some(content) = content else { continue };
        let mut events = Vec::new();
        parse_event_content(&content, &mut events);
        if !events.is_empty() {
            index.files.push(IndexedFile {
                relative,
                modified,
                len,
                events,
            });
        }
    }

    let saved = save_event_index(app, &index);
    if saved.is_ok() && delta_count > 0 {
        if delta_count >= EVENT_DELTA_COMPACT {
            eprintln!("Índice compactado tras {delta_count} deltas");
        }
        // El índice ya incluye todos los deltas: el journal se puede vaciar.
        clear_index_deltas(app);
    }
    let mut events: Vec<Event> = index
        .files
        .iter()
        .flat_map(|file| file.events.iter().cloned())
        .collect();
    dedup_events(&mut events);
    Ok(events)
}

pub fn read_events(app: &AppHandle) -> Result<Vec<Event>, String> {
    // índice persistente: la primera lectura parsea la bóveda; las siguientes
    // solo comprueban metadatos y leen lo que cambió (en SAF, cero IPC por
    // evento ya indexado).
    indexed_events(app)
}

fn parse_event_content(content: &str, out: &mut Vec<Event>) {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return;
    }
    if trimmed.starts_with('{') && !trimmed.contains('\n') {
        if let Ok(event) = serde_json::from_str::<Event>(trimmed) {
            out.push(event);
        }
        return;
    }
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(event) = serde_json::from_str::<Event>(line) {
            out.push(event);
        }
    }
}

fn read_event_file(path: &Path, events: &mut Vec<Event>) {
    // `symlink_metadata` no sigue enlaces: un symlink a un archivo enorme o
    // circular se descarta igual que cualquier otro enlace.
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_LOCAL_EVENT_BYTES {
        return;
    }
    if let Ok(content) = fs::read_to_string(path) {
        parse_event_content(&content, events);
    }
}

fn read_local_events_from_dir(dir: &Path, events: &mut Vec<Event>) {
    read_local_events_at_depth(dir, events, 0);
}

fn read_local_events_at_depth(dir: &Path, events: &mut Vec<Event>, depth: usize) {
    if depth > MAX_LOCAL_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            read_local_events_at_depth(&path, events, depth + 1);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name == SNAPSHOT_META || name == BACKUP_MARKER || name == SNAPSHOT_INDEX || name.ends_with(".tmp") {
            continue;
        }
        if name == EVENTS_FILE || name.ends_with(".json") {
            read_event_file(&path, events);
        }
    }
}

fn read_local_events(root: &Path) -> Result<Vec<Event>, String> {
    ensure_local_layout(root)?;
    let devices_dir = root.join(DATA_DIR).join(DEVICES_DIR);
    let mut events = Vec::new();
    if !devices_dir.is_dir() {
        return Ok(events);
    }

    // La estructura esperada es `omega/devices/<id>/events/` (más el
    // `events.jsonl` heredado directamente bajo `<id>`). No se recorre
    // cualquier subcarpeta arbitraria de la bóveda.
    let Ok(entries) = fs::read_dir(&devices_dir) else {
        return Ok(events);
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let device_dir = entry.path();
        read_event_file(&device_dir.join(EVENTS_FILE), &mut events);
        let events_dir = device_dir.join(EVENTS_DIR);
        if fs::symlink_metadata(&events_dir)
            .map(|metadata| metadata.file_type().is_dir())
            .unwrap_or(false)
        {
            read_local_events_from_dir(&events_dir, &mut events);
        }
    }
    dedup_events(&mut events);
    Ok(events)
}

/* ------------------------------------------------------------------ */
/* Copias diarias longlife                                            */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Clone)]
pub struct SnapshotInfo {
    /// Identificador estable: `<fecha>` para copias antiguas o `<device>/<fecha>`.
    pub id: String,
    pub date: String,
    pub device_id: String,
    pub device_label: String,
    pub files: u64,
    pub bytes: u64,
    /// Archivos que debería contener según `snapshot.json`. `None` en copias
    /// creadas antes de 0.9.4, que no guardaban el manifiesto.
    pub expected_files: Option<u64>,
    pub expected_bytes: Option<u64>,
    /// Hay marcador de copia completa pero el contenido no coincide con el
    /// manifiesto: una sincronización a medias o un borrado externo.
    pub damaged: bool,
    pub complete: bool,
    pub legacy: bool,
    pub current_device: bool,
}

#[derive(Serialize, Clone)]
pub struct BackupStatus {
    pub retention_days: usize,
    pub last_backup: Option<String>,
    pub copies: Vec<SnapshotInfo>,
    pub total_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct BackupRunResult {
    pub created: bool,
    pub skipped: Option<String>,
    pub date: Option<String>,
    pub status: BackupStatus,
}

#[derive(Serialize, Clone)]
pub struct RestoreResult {
    pub imported: u64,
    pub already_present: u64,
    pub source_events: u64,
    pub folder: String,
    /// Eventos importados. La UI los añade al estado sin volver a leer toda la
    /// bóveda por SAF (eso podía tardar minutos después de cada restauración).
    pub events: Vec<Event>,
}

#[derive(Serialize, Deserialize, Clone)]
struct SnapshotMeta {
    device_id: String,
    device_label: String,
    created_at: String,
    platform: String,
    app_version: String,
    /// Nº de archivos de `omega` copiados. Ausente en copias antiguas.
    #[serde(default)]
    files: Option<u64>,
    /// Bytes de esos archivos. Ausente en copias antiguas.
    #[serde(default)]
    bytes: Option<u64>,
}

fn empty_backup_status() -> BackupStatus {
    BackupStatus {
        retention_days: BACKUP_RETENTION,
        last_backup: None,
        copies: Vec::new(),
        total_bytes: 0,
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn is_date_name(name: &str) -> bool {
    name.len() == 10 && chrono::NaiveDate::parse_from_str(name, "%Y-%m-%d").is_ok()
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "android") {
        "Android"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "ios") {
        "iOS"
    } else {
        "Linux"
    }
}

fn short_id(device_id: &str) -> &str {
    device_id.get(..8).unwrap_or(device_id)
}

fn device_label(device_id: &str) -> String {
    format!("{} · {}", platform_name(), short_id(device_id))
}

fn snapshot_meta(device_id: &str, files: u64, bytes: u64) -> SnapshotMeta {
    SnapshotMeta {
        device_id: device_id.to_string(),
        device_label: device_label(device_id),
        created_at: chrono::Local::now().to_rfc3339(),
        platform: platform_name().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        files: Some(files),
        bytes: Some(bytes),
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(u64, u64), String> {
    fs::create_dir_all(dst).map_err(|e| format!("No se pudo crear la copia: {e}"))?;
    harden_permissions(dst, true);
    let mut files = 0u64;
    let mut bytes = 0u64;

    let entries = fs::read_dir(src).map_err(|e| format!("No se pudo leer la bóveda: {e}"))?;
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        // Los enlaces simbólicos no se copian: evita bucles y archivos fuera
        // de la bóveda.
        if file_type.is_symlink() {
            continue;
        }
        let source = entry.path();
        let target = dst.join(entry.file_name());

        if file_type.is_dir() {
            let (child_files, child_bytes) = copy_dir_recursive(&source, &target)?;
            files += child_files;
            bytes += child_bytes;
        } else if file_type.is_file() {
            fs::copy(&source, &target).map_err(|e| {
                format!(
                    "No se pudo copiar {}: {e}",
                    source
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("archivo")
                )
            })?;
            harden_permissions(&target, false);
            files += 1;
            bytes += fs::metadata(&source).map(|meta| meta.len()).unwrap_or(0);
        }
    }

    Ok((files, bytes))
}

/// Cuenta archivos y bytes de una copia **sin** su propia metadata
/// (`snapshot.json` y `.backup-complete`): así el resultado se puede comparar
/// con el manifiesto que describe el contenido de `omega`.
fn count_dir(dir: &Path) -> Result<(u64, u64), String> {
    let mut files = 0u64;
    let mut bytes = 0u64;
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(error) => return Err(format!("No se pudo leer la copia: {error}")),
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == BACKUP_MARKER || name == SNAPSHOT_META || name == SNAPSHOT_INDEX {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            let (child_files, child_bytes) = count_dir(&entry.path())?;
            files += child_files;
            bytes += child_bytes;
        } else if file_type.is_file() {
            files += 1;
            bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        }
    }

    Ok((files, bytes))
}

fn read_local_meta(dir: &Path) -> Option<SnapshotMeta> {
    fs::read_to_string(dir.join(SNAPSHOT_META))
        .ok()
        .and_then(|text| serde_json::from_str::<SnapshotMeta>(&text).ok())
}

/// ¿La copia de hoy se quedó atrás? Si `omega` tiene ahora más archivos que
/// los que describe el manifiesto (o los mismos con más bytes), se guardaron
/// datos después de crear la copia y hay que rehacerla. Nunca se considera
/// atrasada cuando `omega` tiene menos: en ese caso la copia es la que
/// protege los datos que faltan.
fn local_backup_is_stale(omega: &Path, day: &Path) -> Result<bool, String> {
    let Some(meta) = read_local_meta(day) else {
        return Ok(false);
    };
    let (Some(expected_files), Some(expected_bytes)) = (meta.files, meta.bytes) else {
        return Ok(false);
    };
    let (files, bytes) = count_dir(omega)?;
    Ok(files > expected_files || (files == expected_files && bytes > expected_bytes))
}

/// Índice centralizado de una copia local: un único NDJSON con todos sus
/// eventos. No sustituye a los `.json` (la sincronización los necesita), solo
/// permite restaurar sin abrir un archivo por evento.
fn write_snapshot_index_local(day: &Path) -> Result<(), String> {
    let mut events = Vec::new();
    read_local_events_from_dir(day, &mut events);
    let mut content = String::new();
    for event in events {
        content.push_str(&serde_json::to_string(&event).map_err(|e| e.to_string())?);
        content.push('\n');
    }
    let path = day.join(SNAPSHOT_INDEX);
    fs::write(&path, content).map_err(|e| format!("No se pudo indexar la copia: {e}"))?;
    harden_permissions(&path, false);
    Ok(())
}

/// Compara el contenido real de una copia con el manifiesto de su
/// `snapshot.json`. Las copias antiguas (sin manifiesto) se consideran válidas:
/// no hay nada con lo que compararlas.
/// Id canónico de un evento a partir de su nombre de archivo. `None` para los
/// archivos que no son eventos. Se usa en SAF para saber qué eventos hay sin
/// tener que leer su contenido.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn event_id_from_file_name(name: &str) -> Option<&str> {
    if name == EVENTS_FILE
        || name == SNAPSHOT_META
        || name == BACKUP_MARKER
        || name == SNAPSHOT_INDEX
        || name.ends_with(".tmp")
    {
        return None;
    }
    name.strip_suffix(".json").filter(|id| !id.is_empty())
}

/// Entrada ya listada por `read_dir`, sin depender del sistema de archivos.
/// Permite probar el conteo y la salud del manifiesto en escritorio.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Debug, Clone)]
struct CountingEntry {
    name: String,
    is_dir: bool,
    len: Option<u64>,
}

/// Cuenta archivos de datos y bytes a partir de entradas ya listadas. Los
/// metadatos de la copia y los temporales no cuentan, igual que en `count_dir`.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn count_entries(entries: &[CountingEntry]) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    for entry in entries {
        if entry.is_dir
            || entry.name == BACKUP_MARKER
            || entry.name == SNAPSHOT_META
            || entry.name == SNAPSHOT_INDEX
            || entry.name.ends_with(".tmp")
        {
            continue;
        }
        files += 1;
        bytes += entry.len.unwrap_or(0);
    }
    (files, bytes)
}

/// Compara recuentos ya calculados con el manifiesto. Sin manifiesto no hay
/// nada con qué comparar y la copia se da por válida.
fn manifest_matches_meta(meta: Option<&SnapshotMeta>, files: u64, bytes: u64) -> bool {
    let Some(meta) = meta else {
        return true;
    };
    let Some(expected_files) = meta.files else {
        return true;
    };
    if expected_files != files {
        return false;
    }
    match meta.bytes {
        Some(expected_bytes) => expected_bytes == bytes,
        None => true,
    }
}

/// Cuenta líneas útiles de un NDJSON sin parsear los eventos. Sirve para
/// verificar una copia SAF con una sola lectura, en vez de recorrer su árbol.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn ndjson_count(content: &str) -> u64 {
    content.lines().filter(|line| !line.trim().is_empty()).count() as u64
}

fn manifest_matches(dir: &Path) -> Result<bool, String> {
    let Some(meta) = read_local_meta(dir) else {
        return Ok(true);
    };
    let (files, bytes) = count_dir(dir)?;
    Ok(manifest_matches_meta(Some(&meta), files, bytes))
}

fn local_snapshot_info(
    dir: &Path,
    id: String,
    date: String,
    fallback_device: &str,
    fallback_label: &str,
    legacy: bool,
    current_device: &str,
) -> Result<Option<SnapshotInfo>, String> {
    let (files, bytes) = count_dir(dir)?;
    if files == 0 {
        return Ok(None);
    }
    let meta = read_local_meta(dir);
    let device_id = meta
        .as_ref()
        .map(|meta| meta.device_id.clone())
        .unwrap_or_else(|| fallback_device.to_string());
    let label = meta
        .as_ref()
        .map(|meta| meta.device_label.clone())
        .unwrap_or_else(|| fallback_label.to_string());
    let expected_files = meta.as_ref().and_then(|meta| meta.files);
    let expected_bytes = meta.as_ref().and_then(|meta| meta.bytes);
    let healthy = manifest_matches(dir)?;
    let marker = dir.join(BACKUP_MARKER).is_file();
    Ok(Some(SnapshotInfo {
        id,
        date,
        device_id: device_id.clone(),
        device_label: label,
        files,
        bytes,
        expected_files,
        expected_bytes,
        damaged: marker && !healthy,
        complete: marker && healthy,
        legacy,
        current_device: device_id == current_device,
    }))
}

/// Raíces de copias en modo escritorio: la nueva y la heredada, sin duplicar
/// la ruta cuando el sistema no distingue mayúsculas (Windows/FAT).
fn local_backup_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for name in [BACKUP_DIR, LEGACY_BACKUP_DIR] {
        let dir = root.join(name);
        if !dir.is_dir() {
            continue;
        }
        if let Ok(canonical) = dir.canonicalize() {
            if roots.contains(&canonical) {
                continue;
            }
            roots.push(canonical);
        } else {
            roots.push(dir);
        }
    }
    roots
}

/// Renombra `Longlife` a `longlife` la primera vez (con `fs::rename`, los
/// archivos no se mueven ni se copian).
///
/// En ficheros que no distinguen mayúsculas (Windows) `new.exists()` ya es
/// `true` con el nombre antiguo, así que no se toca nada: es la misma carpeta.
fn migrate_local_backup_dir(root: &Path) {
    let old = root.join(LEGACY_BACKUP_DIR);
    if !old.is_dir() {
        return;
    }
    let new = root.join(BACKUP_DIR);
    if new.exists() {
        return;
    }
    if let Err(error) = fs::rename(&old, &new) {
        eprintln!("No se pudo renombrar {LEGACY_BACKUP_DIR} a {BACKUP_DIR}: {error}");
    }
}

/// Lista las copias de todas las raíces (`longlife` y, si sigue existiendo,
/// `Longlife`) sin repetir la misma carpeta dos veces.
fn list_local_backups(root: &Path, current_device: &str) -> Result<Vec<SnapshotInfo>, String> {
    migrate_local_backup_dir(root);

    let mut copies = Vec::new();
    let mut seen_ids = HashSet::new();
    for backup_root in local_backup_roots(root) {
        let entries = match fs::read_dir(&backup_root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!("No se pudo leer {BACKUP_DIR}: {error}"));
            }
        };

        for entry in entries.flatten() {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };

            if is_date_name(name) {
                // Formato antiguo: longlife/<fecha>. Sigue siendo legible, pero
                // nunca se usa para escribir copias nuevas porque todos los
                // dispositivos competían por la misma carpeta.
                if seen_ids.insert(name.to_string()) {
                    if let Some(info) = local_snapshot_info(
                        &entry.path(),
                        name.to_string(),
                        name.to_string(),
                        "legacy",
                        "Copia antigua (sin dispositivo)",
                        true,
                        current_device,
                    )? {
                        copies.push(info);
                    }
                }
                continue;
            }

            let device_entries = match fs::read_dir(entry.path()) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for day in device_entries.flatten() {
                if !day.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    continue;
                }
                let Some(date) = day.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                if !is_date_name(&date) {
                    continue;
                }
                let id = format!("{name}/{date}");
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                if let Some(info) = local_snapshot_info(
                    &day.path(),
                    id,
                    date,
                    name,
                    &format!("Dispositivo {}", short_id(name)),
                    false,
                    current_device,
                )? {
                    copies.push(info);
                }
            }
        }
    }
    copies.sort_by(|a, b| a.date.cmp(&b.date).then(a.device_id.cmp(&b.device_id)));
    Ok(copies)
}

/// Conserva como máximo `BACKUP_RETENTION` copias **en total**, sumando todos
/// los dispositivos y las dos raíces (`longlife`/`Longlife`). Las más antiguas
/// se sustituyen por las nuevas; se borra la carpeta completa, no se oculta.
fn prune_local_backups(root: &Path) -> Result<(), String> {
    let mut copies = list_local_backups(root, "")?;
    copies.sort_by(|a, b| a.date.cmp(&b.date).then(a.device_id.cmp(&b.device_id)));

    while copies.len() > BACKUP_RETENTION {
        let oldest = copies.remove(0);
        if let Ok(dir) = resolve_snapshot_dir(root, &oldest.id) {
            let _ = fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

fn resolve_snapshot_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = id.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() || parts.len() > 2 {
        return Err("La copia seleccionada no es válida.".to_string());
    }
    for part in &parts {
        if *part == "." || *part == ".." || part.contains('\\') || part.len() > 128 {
            return Err("La copia seleccionada no es válida.".to_string());
        }
    }
    // La copia puede vivir en la carpeta nueva o en la heredada (`Longlife`)
    // cuando la migración todavía no ha corrido o el renombrado falló.
    for name in [BACKUP_DIR, LEGACY_BACKUP_DIR] {
        let mut dir = root.join(name);
        for part in &parts {
            dir.push(part);
        }
        if dir.is_dir() {
            return Ok(dir);
        }
    }
    Err("La copia ya no existe. Actualiza la lista.".to_string())
}

#[tauri::command]
pub async fn vault_backup_status(app: AppHandle) -> Result<BackupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || backup_status(&app))
        .await
        .map_err(|error| format!("No se pudo consultar longlife: {error}"))?
}

pub fn backup_status(app: &AppHandle) -> Result<BackupStatus, String> {
    let Some(location) = current_location(app)? else {
        return Ok(empty_backup_status());
    };
    let current_device = device_id(app);

    let copies = match location {
        VaultLocation::Local(root) => list_local_backups(&root, &current_device)?,
        #[cfg(target_os = "android")]
        VaultLocation::Saf(saf) => list_saf_backups(app, &saf.root, &current_device)?,
    };

    let total_bytes = copies.iter().map(|copy| copy.bytes).sum();
    // La copia de hoy de otro dispositivo no debe impedir la copia de este.
    let last_backup = copies
        .iter()
        .filter(|copy| copy.current_device)
        .map(|copy| copy.date.clone())
        .max();
    Ok(BackupStatus {
        retention_days: BACKUP_RETENTION,
        last_backup,
        copies,
        total_bytes,
    })
}

/// Crea como máximo una copia completa por día y dispositivo en
/// `longlife/<device>/<fecha>`. Así dos dispositivos nunca escriben la misma
/// carpeta del día y el sincronizador externo no tiene que resolver un conflicto destructivo.
#[tauri::command]
pub async fn vault_run_backup(
    app: AppHandle,
    force: Option<bool>,
) -> Result<BackupRunResult, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || run_daily_backup(&app, force))
        .await
        .map_err(|error| format!("No se pudo crear la copia: {error}"))?
}

pub fn run_daily_backup(app: &AppHandle, force: bool) -> Result<BackupRunResult, String> {
    let Some(location) = current_location(app)? else {
        return Ok(BackupRunResult {
            created: false,
            skipped: Some("No hay una bóveda seleccionada.".to_string()),
            date: None,
            status: empty_backup_status(),
        });
    };

    let date = today();
    let device = device_id(app);
    // El lock también protege la fecha de omisión: si el usuario borra las
    // copias mientras una copia automática está en curso, esa copia no debe
    // recrearlas después del borrado. El estado final se consulta FUERA del
    // lock: en SAF recorrer todas las copias es caro y bloquearía los append.
    let mut skipped: Option<String> = None;
    {
        let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut cfg = load_config(app);
        let skipped_today = cfg.backup_skip_date.as_deref() == Some(date.as_str());
        if skipped_today && !force {
            skipped = Some("Has borrado las copias de hoy; se reanudará mañana.".to_string());
        } else {
            if cfg.backup_skip_date.is_some() {
                cfg.backup_skip_date = None;
                save_config(app, &cfg)?;
            }

            match location {
                VaultLocation::Local(root) => {
                    migrate_local_backup_dir(&root);
                    ensure_local_layout(&root)?;
                    let omega = root.join(DATA_DIR);
                    let (files, _) = count_dir(&omega)?;
                    if files == 0 {
                        skipped =
                            Some("La carpeta omega está vacía; no hay nada que copiar.".to_string());
                    } else {
                        let day = root.join(BACKUP_DIR).join(&device).join(&date);
                        // Una copia completa pero con menos archivos que los del
                        // manifiesto está dañada (sincronización a medias, borrado
                        // externo…): se rehace en vez de darla por buena.
                        let healthy = day.join(BACKUP_MARKER).is_file() && manifest_matches(&day)?;
                        // La copia de hoy pudo crearse al arrancar, antes de que el
                        // usuario guardara ejercicios, rutinas o planes. Si `omega`
                        // creció desde entonces, se rehace para que longlife no se
                        // quede con una foto vieja hasta el día siguiente.
                        let stale = healthy && local_backup_is_stale(&omega, &day)?;
                        if healthy && !stale {
                            skipped = Some("La copia de hoy ya existe.".to_string());
                        } else {
                            if day.exists() {
                                let _ = fs::remove_dir_all(&day);
                            }
                            fs::create_dir_all(&day)
                                .map_err(|e| format!("No se pudo crear la copia: {e}"))?;
                            harden_permissions(&root.join(BACKUP_DIR), true);
                            harden_permissions(&root.join(BACKUP_DIR).join(&device), true);
                            harden_permissions(&day, true);
                            let (copied_files, copied_bytes) = copy_dir_recursive(&omega, &day)?;
                            write_snapshot_index_local(&day)?;
                            let meta = serde_json::to_vec_pretty(&snapshot_meta(
                                &device,
                                copied_files,
                                copied_bytes,
                            ))
                            .map_err(|e| format!("No se pudo describir la copia: {e}"))?;
                            let meta_path = day.join(SNAPSHOT_META);
                            fs::write(&meta_path, meta)
                                .map_err(|e| format!("No se pudo describir la copia: {e}"))?;
                            harden_permissions(&meta_path, false);
                            let marker_path = day.join(BACKUP_MARKER);
                            fs::write(&marker_path, b"ok\n")
                                .map_err(|e| format!("No se pudo cerrar la copia: {e}"))?;
                            harden_permissions(&marker_path, false);
                            prune_local_backups(&root)?;
                        }
                    }
                }
                #[cfg(target_os = "android")]
                VaultLocation::Saf(saf) => {
                    skipped = run_saf_backup(app, &saf.root, &date, &device)?;
                }
            }
        }
    }

    let created = skipped.is_none();
    let status = backup_status(app)?;
    Ok(BackupRunResult {
        created,
        skipped,
        date: if created { Some(date) } else { None },
        status,
    })
}

#[tauri::command]
pub async fn vault_restore_snapshot(app: AppHandle, id: String) -> Result<RestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || restore_snapshot(&app, &id))
        .await
        .map_err(|error| format!("No se pudo restaurar la copia: {error}"))?
}

fn restore_folder_name(id: &str) -> String {
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    // Dos restauraciones del mismo día no deben compartir carpeta: la segunda
    // podría sobrescribir los eventos importados por la primera.
    let unique = uuid::Uuid::new_v4().simple().to_string();
    format!("restored-{safe}-{stamp}-{}", &unique[..8])
}

fn dedup_events(events: &mut Vec<Event>) {
    events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp).then(a.id.cmp(&b.id)));
    events.dedup_by(|a, b| a.id == b.id);
}

/// Ids de la copia cuyo contenido hace falta leer. Los ya presentes y los
/// repetidos se descartan **antes** de tocar el archivo: en SAF cada lectura
/// es un viaje al proceso Android.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn plan_missing_ids(current: &HashSet<String>, file_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut missing = Vec::new();
    for id in file_ids {
        if seen.insert(id.clone()) && !current.contains(&id) {
            missing.push(id);
        }
    }
    missing
}

fn build_restore_result(
    current: &[Event],
    mut snapshot_events: Vec<Event>,
    folder: String,
) -> (RestoreResult, Vec<Event>) {
    dedup_events(&mut snapshot_events);
    let source_events = snapshot_events.len() as u64;
    let current_ids: HashSet<&str> = current.iter().map(|event| event.id.as_str()).collect();
    let missing: Vec<Event> = snapshot_events
        .into_iter()
        .filter(|event| !current_ids.contains(event.id.as_str()))
        .collect();
    let imported = missing.len() as u64;
    (
        RestoreResult {
            imported,
            already_present: source_events.saturating_sub(imported),
            source_events,
            folder,
            events: missing.clone(),
        },
        missing,
    )
}

fn restore_local_snapshot(root: &Path, id: &str) -> Result<RestoreResult, String> {
    let dir = resolve_snapshot_dir(root, id)?;
    let mut snapshot_events = Vec::new();
    if let Ok(content) = fs::read_to_string(dir.join(SNAPSHOT_INDEX)) {
        parse_event_content(&content, &mut snapshot_events);
    } else {
        read_local_events_from_dir(&dir, &mut snapshot_events);
    }
    let current = read_local_events(root)?;
    let folder = restore_folder_name(id);
    let (result, missing) = build_restore_result(&current, snapshot_events, folder.clone());
    if missing.is_empty() {
        return Ok(result);
    }

    let restore_dir = root.join(DATA_DIR).join(DEVICES_DIR).join(&folder);
    fs::create_dir_all(&restore_dir)
        .map_err(|e| format!("No se pudo preparar la restauración: {e}"))?;
    harden_permissions(&restore_dir, true);
    let mut content = String::new();
    for event in missing {
        content.push_str(&serde_json::to_string(&event).map_err(|e| e.to_string())?);
        content.push('\n');
    }
    let events_path = restore_dir.join(EVENTS_FILE);
    fs::write(&events_path, content)
        .map_err(|e| format!("No se pudo guardar la restauración: {e}"))?;
    harden_permissions(&events_path, false);
    Ok(RestoreResult {
        folder: format!("omega/{DEVICES_DIR}/{folder}"),
        ..result
    })
}

fn restore_snapshot(app: &AppHandle, id: &str) -> Result<RestoreResult, String> {
    let location =
        current_location(app)?.ok_or_else(|| "No hay una bóveda seleccionada.".to_string())?;
    let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match location {
        VaultLocation::Local(root) => restore_local_snapshot(&root, id),
        #[cfg(target_os = "android")]
        VaultLocation::Saf(saf) => restore_saf_snapshot(app, &saf.root, id),
    }
}

#[tauri::command]
pub async fn vault_delete_backups(app: AppHandle) -> Result<BackupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || delete_backups(&app))
        .await
        .map_err(|error| format!("No se pudieron borrar las copias: {error}"))?
}

pub fn delete_backups(app: &AppHandle) -> Result<BackupStatus, String> {
    let Some(location) = current_location(app)? else {
        return Ok(empty_backup_status());
    };

    {
        let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        match location {
            VaultLocation::Local(root) => {
                for name in [BACKUP_DIR, LEGACY_BACKUP_DIR] {
                    let backup_root = root.join(name);
                    // En sistemas sin distinción de mayúsculas, `longlife` y
                    // `Longlife` son la misma carpeta: remove_dir_all solo se
                    // ejecuta si existe.
                    if backup_root.exists() {
                        fs::remove_dir_all(&backup_root)
                            .map_err(|e| format!("No se pudieron borrar las copias: {e}"))?;
                    }
                }
            }
            #[cfg(target_os = "android")]
            VaultLocation::Saf(saf) => {
                for name in [BACKUP_DIR, LEGACY_BACKUP_DIR] {
                    if let Some(backup_root) = saf_find_dir(app, &saf.root, name)? {
                        saf_delete_tree(app, &backup_root)?;
                    }
                }
            }
        }

        // No recrear inmediatamente la copia de hoy por el automatismo diario.
        let mut cfg = load_config(app);
        cfg.backup_skip_date = Some(today());
        save_config(app, &cfg)?;
    }

    // Fuera del lock: listar copias en SAF es caro y no debe bloquear escrituras.
    backup_status(app)
}

/* ------------------------------------------------------------------ */
/* SAF (Android)                                                      */
/* ------------------------------------------------------------------ */

/// Crea un archivo nuevo y escribe su contenido en una sola operación lógica.
/// El plugin puede sanear el nombre o añadir un sufijo si ya existe: se
/// comprueba el nombre real devuelto para que un evento guardado «con éxito»
/// no se pierda por un nombre inesperado.
#[cfg(target_os = "android")]
fn saf_write_new_file(
    app: &AppHandle,
    root: &FsUri,
    relative: &str,
    mime: &str,
    payload: &[u8],
) -> Result<(), String> {
    let (uri, actual) = app
        .android_fs()
        .create_new_file_and_return_relative_path(root, relative, Some(mime))
        .map_err(|e| format!("No se pudo crear {relative}: {e}"))?;
    let expected_name = Path::new(relative)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let actual_name = actual
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if actual_name != expected_name {
        // El proveedor añadió un sufijo o saneó el nombre: el lector no
        // encontraría el evento. Si el archivo canónico ya existe, el evento
        // estaba guardado y basta con borrar el duplicado; si no, fallamos con
        // un mensaje accionable en vez de dar un éxito falso.
        let canonical_exists = app
            .android_fs()
            .resolve_file_uri(root, relative)
            .is_ok();
        let _ = app.android_fs().remove_file(&uri);
        if !canonical_exists {
            return Err(format!(
                "El proveedor SAF guardó {relative} como {actual_name}; no se pudo usar el nombre canónico."
            ));
        }
        return Ok(());
    }
    app.android_fs()
        .write(&uri, payload)
        .map_err(|e| format!("No se pudo guardar {relative}: {e}"))?;
    if app.android_fs().get_len(&uri).unwrap_or(0) == 0 {
        return Err(format!("El archivo {relative} quedó vacío tras escribirlo."));
    }
    Ok(())
}

/// Igual que la lectura local: profundidad y tamaño acotados, metadatos y
/// temporales ignorados, y un archivo ilegible no invalida toda la lectura.
#[cfg(target_os = "android")]
#[allow(dead_code)]
fn read_saf_events_from_dir(
    app: &AppHandle,
    dir: &FsUri,
    events: &mut Vec<Event>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_SAF_DEPTH {
        return Ok(());
    }
    let entries = match app.android_fs().read_dir(dir) {
        Ok(entries) => entries,
        // Una carpeta no descargada o un fallo puntual del proveedor no debe
        // invalidar toda la lectura (en local esos directorios se ignoran).
        Err(error) => {
            eprintln!("No se pudo listar una carpeta SAF: {error}");
            return Ok(());
        }
    };
    for entry in entries {
        let name = entry.name();
        if name.is_empty()
            || name == "."
            || name == ".."
            || name == SNAPSHOT_META
            || name == BACKUP_MARKER
            || name == SNAPSHOT_INDEX
            || name.ends_with(".tmp")
        {
            continue;
        }
        if entry.is_dir() {
            read_saf_events_from_dir(app, entry.uri(), events, depth + 1)?;
            continue;
        }
        if name != EVENTS_FILE && !name.ends_with(".json") {
            continue;
        }
        if entry.file_len().unwrap_or(0) > MAX_LOCAL_EVENT_BYTES {
            continue;
        }
        match app.android_fs().read_to_string(entry.uri()) {
            Ok(content) => parse_event_content(&content, events),
            Err(error) => eprintln!("No se pudo leer un evento SAF ({name}): {error}"),
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[allow(dead_code)]
fn read_saf_events(app: &AppHandle, root: &FsUri) -> Result<Vec<Event>, String> {
    let mut events = Vec::new();
    let Some(omega) = saf_find_dir(app, root, DATA_DIR)? else {
        return Ok(events);
    };
    let Some(devices) = saf_find_dir(app, &omega, DEVICES_DIR)? else {
        return Ok(events);
    };
    read_saf_events_from_dir(app, &devices, &mut events, 0)?;
    dedup_events(&mut events);
    Ok(events)
}

#[cfg(target_os = "android")]
fn saf_snapshot_dir(app: &AppHandle, root: &FsUri, id: &str) -> Result<FsUri, String> {
    let parts: Vec<&str> = id.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() || parts.len() > 2 {
        return Err("La copia seleccionada no es válida.".to_string());
    }
    for part in &parts {
        if *part == "." || *part == ".." || part.contains('\\') || part.len() > 128 {
            return Err("La copia seleccionada no es válida.".to_string());
        }
    }
    for backup_name in [BACKUP_DIR, LEGACY_BACKUP_DIR] {
        let Some(mut dir) = saf_find_dir(app, root, backup_name)? else {
            continue;
        };
        let mut found = true;
        for part in &parts {
            match saf_find_dir(app, &dir, part)? {
                Some(child) => dir = child,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if found {
            return Ok(dir);
        }
    }
    Err("La copia ya no existe. Actualiza la lista.".to_string())}

/// Lista los archivos de eventos de un directorio SAF sin leer su contenido.
/// Los ids de los eventos actuales se deducen del nombre (`<id>.json`), así
/// restaurar no obliga a leer toda la bóveda por IPC.
#[cfg(target_os = "android")]
fn saf_collect_event_files(
    app: &AppHandle,
    dir: &FsUri,
    depth: usize,
    out: &mut Vec<(String, FsUri)>,
) -> Result<(), String> {
    if depth > MAX_SAF_DEPTH {
        return Ok(());
    }
    let entries = match app.android_fs().read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!("No se pudo listar una carpeta SAF: {error}");
            return Ok(());
        }
    };
    for entry in entries {
        let name = entry.name();
        if name.is_empty()
            || name == "."
            || name == ".."
            || name == SNAPSHOT_META
            || name == BACKUP_MARKER
            || name == SNAPSHOT_INDEX
            || name.ends_with(".tmp")
        {
            continue;
        }
        if entry.is_dir() {
            saf_collect_event_files(app, entry.uri(), depth + 1, out)?;
            continue;
        }
        if name != EVENTS_FILE && !name.ends_with(".json") {
            continue;
        }
        if entry.file_len().unwrap_or(0) > MAX_LOCAL_EVENT_BYTES {
            continue;
        }
        out.push((name.to_string(), entry.uri().clone()));
    }
    Ok(())
}

/// Ids de todos los eventos presentes en la bóveda actual. Los `.json` se
/// resuelven por nombre; los `events.jsonl` heredados (pocos) sí se leen.
#[cfg(target_os = "android")]
fn saf_event_ids(app: &AppHandle, root: &FsUri) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    let Some(omega) = saf_find_dir(app, root, DATA_DIR)? else {
        return Ok(ids);
    };
    let Some(devices) = saf_find_dir(app, &omega, DEVICES_DIR)? else {
        return Ok(ids);
    };
    let mut files = Vec::new();
    saf_collect_event_files(app, &devices, 0, &mut files)?;
    // Solo nombres: leer los `events.jsonl` de restauraciones anteriores
    // costaba una llamada SAF por archivo y podía contener cientos de eventos.
    for (name, _uri) in files {
        if let Some(id) = event_id_from_file_name(&name) {
            ids.insert(id.to_string());
        }
    }
    Ok(ids)
}

#[cfg(target_os = "android")]
fn restore_saf_snapshot(app: &AppHandle, root: &FsUri, id: &str) -> Result<RestoreResult, String> {
    let dir = saf_snapshot_dir(app, root, id)?;
    let current_ids = saf_event_ids(app, root)?;
    let mut source_ids: HashSet<String> = HashSet::new();
    let mut missing: Vec<Event> = Vec::new();

    if let Some(index_uri) = saf_find_file(app, &dir, SNAPSHOT_INDEX)? {
        // Copias nuevas: un único NDJSON centralizado → una sola lectura SAF,
        // sin importar cuántos eventos tenga la copia.
        if let Ok(content) = app.android_fs().read_to_string(&index_uri) {
            let mut parsed = Vec::new();
            parse_event_content(&content, &mut parsed);
            for event in parsed {
                if !source_ids.insert(event.id.clone()) || current_ids.contains(&event.id) {
                    continue;
                }
                missing.push(event);
            }
        }
    } else {
        // Copias antiguas sin índice: se deducen los ids de los nombres y solo
        // se lee el contenido de los eventos que faltan.
        let mut files = Vec::new();
        saf_collect_event_files(app, &dir, 0, &mut files)?;
        let file_ids: Vec<(String, FsUri, Option<String>)> = files
            .into_iter()
            .map(|(name, uri)| {
                let id = if name == EVENTS_FILE {
                    None
                } else {
                    event_id_from_file_name(&name).map(str::to_string)
                };
                (name, uri, id)
            })
            .collect();
        source_ids = file_ids
            .iter()
            .filter_map(|(_, _, id)| id.clone())
            .collect();
        let planned: HashSet<String> = plan_missing_ids(
            &current_ids,
            file_ids.iter().filter_map(|(_, _, id)| id.clone()).collect(),
        )
        .into_iter()
        .collect();

        for (_name, uri, file_id) in file_ids {
            if file_id.as_ref().is_some_and(|id| !planned.contains(id)) {
                continue;
            }
            let Ok(content) = app.android_fs().read_to_string(&uri) else {
                continue;
            };
            let mut parsed = Vec::new();
            parse_event_content(&content, &mut parsed);
            for event in parsed {
                if file_id.is_none()
                    && (!source_ids.insert(event.id.clone()) || current_ids.contains(&event.id))
                {
                    continue;
                }
                missing.push(event);
            }
        }
    }
    dedup_events(&mut missing);

    let source_events = source_ids.len() as u64;
    let imported = missing.len() as u64;
    let folder = restore_folder_name(id);
    let result = RestoreResult {
        imported,
        already_present: source_events.saturating_sub(imported),
        source_events,
        folder: format!("omega/{DEVICES_DIR}/{folder}"),
        events: missing.clone(),
    };
    if missing.is_empty() {
        return Ok(result);
    }

    let mut content = String::new();
    for event in missing {
        content.push_str(&serde_json::to_string(&event).map_err(|e| e.to_string())?);
        content.push('\n');
    }
    let relative = format!("{DATA_DIR}/{DEVICES_DIR}/{folder}/{EVENTS_FILE}");
    saf_write_new_file(app, root, &relative, "application/x-ndjson", content.as_bytes())
        .map_err(|e| format!("No se pudo guardar la restauración: {e}"))?;
    Ok(result)
}

#[cfg(target_os = "android")]
fn saf_find_dir(app: &AppHandle, parent: &FsUri, name: &str) -> Result<Option<FsUri>, String> {
    for entry in app
        .android_fs()
        .read_dir(parent)
        .map_err(|e| format!("No se pudo leer la carpeta SAF: {e}"))?
    {
        if entry.name() == name && entry.is_dir() {
            return Ok(Some(entry.uri().clone()));
        }
    }
    Ok(None)
}

#[cfg(target_os = "android")]
fn saf_find_file(app: &AppHandle, parent: &FsUri, name: &str) -> Result<Option<FsUri>, String> {
    for entry in app
        .android_fs()
        .read_dir(parent)
        .map_err(|e| format!("No se pudo leer la carpeta SAF: {e}"))?
    {
        if entry.name() == name && entry.is_file() {
            return Ok(Some(entry.uri().clone()));
        }
    }
    Ok(None)
}

#[cfg(target_os = "android")]
fn saf_collect_files(
    app: &AppHandle,
    dir: &FsUri,
    prefix: &str,
    depth: usize,
    out: &mut Vec<(String, FsUri, u64)>,
) -> Result<(), String> {
    if depth > MAX_SAF_DEPTH {
        return Ok(());
    }

    let entries = match app.android_fs().read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!("No se pudo listar una carpeta SAF: {error}");
            return Ok(());
        }
    };
    for entry in entries {
        let name = entry.name();
        if name.is_empty()
            || name == "."
            || name == ".."
            || name == BACKUP_MARKER
            || name == SNAPSHOT_META
            || name == SNAPSHOT_INDEX
            || name.ends_with(".tmp")
        {
            continue;
        }
        let relative = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}/{name}")
        };
        if entry.is_file() {
            // `read_dir` ya trae el tamaño (`Entry::file_len`). Leer cada
            // archivo por IPC solo para contar bytes costaba miles de viajes.
            out.push((relative, entry.uri().clone(), entry.file_len().unwrap_or(0)));
        } else {
            saf_collect_files(app, entry.uri(), &relative, depth + 1, out)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn saf_count_dir(app: &AppHandle, dir: &FsUri) -> Result<(u64, u64), String> {
    let mut files = Vec::new();
    saf_collect_files(app, dir, "", 0, &mut files)?;
    let entries: Vec<CountingEntry> = files
        .into_iter()
        .map(|(name, _, len)| CountingEntry {
            name,
            is_dir: false,
            len: Some(len),
        })
        .collect();
    Ok(count_entries(&entries))
}

#[cfg(target_os = "android")]
fn saf_delete_tree_inner(
    app: &AppHandle,
    dir: &FsUri,
    depth: usize,
    visited: &mut HashSet<String>,
) -> Result<(), String> {
    if depth > MAX_SAF_DEPTH || !visited.insert(dir.uri.clone()) {
        return Ok(());
    }
    let entries = match app.android_fs().read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!("No se pudo listar una copia SAF: {error}");
            return Ok(());
        }
    };
    for entry in entries {
        if entry.is_file() {
            let _ = app.android_fs().remove_file(entry.uri());
        } else {
            saf_delete_tree_inner(app, entry.uri(), depth + 1, visited)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn saf_delete_tree(app: &AppHandle, dir: &FsUri) -> Result<(), String> {
    saf_delete_tree_inner(app, dir, 0, &mut HashSet::new())
}

#[cfg(target_os = "android")]
fn saf_read_snapshot_meta(app: &AppHandle, dir: &FsUri) -> Option<SnapshotMeta> {
    let file = saf_find_file(app, dir, SNAPSHOT_META).ok().flatten()?;
    let text = app.android_fs().read_to_string(&file).ok()?;
    serde_json::from_str::<SnapshotMeta>(&text).ok()
}

#[cfg(target_os = "android")]
#[allow(clippy::too_many_arguments)]
fn saf_snapshot_info(
    app: &AppHandle,
    dir: &FsUri,
    id: String,
    date: String,
    fallback_device: &str,
    fallback_label: &str,
    legacy: bool,
    current_device: &str,
) -> Result<Option<SnapshotInfo>, String> {
    // Una sola lectura del directorio de la copia: antes se hacía un
    // `read_dir` para contar (recursivo), otro para `snapshot.json` y otro para
    // el marcador. Con 13 copias SAF eso agotaba el tiempo de la llamada.
    let mut meta_uri: Option<FsUri> = None;
    let mut index_uri: Option<FsUri> = None;
    let mut marker = false;
    for entry in app
        .android_fs()
        .read_dir(dir)
        .map_err(|e| format!("No se pudo leer la copia SAF: {e}"))?
    {
        let name = entry.name().to_string();
        match name.as_str() {
            SNAPSHOT_META if entry.is_file() => meta_uri = Some(entry.uri().clone()),
            SNAPSHOT_INDEX if entry.is_file() => index_uri = Some(entry.uri().clone()),
            BACKUP_MARKER if entry.is_file() => marker = true,
            _ => {}
        }
    }
    let meta = meta_uri
        .and_then(|uri| app.android_fs().read_to_string(&uri).ok())
        .and_then(|text| serde_json::from_str::<SnapshotMeta>(&text).ok());
    let expected_files = meta.as_ref().and_then(|meta| meta.files);
    let expected_bytes = meta.as_ref().and_then(|meta| meta.bytes);
    // Las copias con manifiesto ya traen el recuento: recorrer su árbol por
    // SAF costaba una IPC por carpeta. Las antiguas sin manifiesto sí se cuentan.
    let (files, bytes) = match expected_files {
        Some(count) => (count, expected_bytes.unwrap_or(0)),
        None => saf_count_dir(app, dir)?,
    };
    if files == 0 {
        return Ok(None);
    }
    // Verificación barata de integridad: el índice centralizado debe tener un
    // evento por cada archivo que declara el manifiesto (una sola lectura).
    let index_count = index_uri
        .and_then(|uri| app.android_fs().read_to_string(&uri).ok())
        .map(|text| ndjson_count(&text));
    let healthy = match (expected_files, index_count) {
        // Un `events.jsonl` heredado puede contener varios eventos en un solo
        // archivo: no es una copia dañada aunque el índice tenga más líneas.
        (Some(expected @ 2..), Some(actual)) => actual == expected,
        _ => manifest_matches_meta(meta.as_ref(), files, bytes),
    };
    let device_id = meta
        .as_ref()
        .map(|meta| meta.device_id.clone())
        .unwrap_or_else(|| fallback_device.to_string());
    let label = meta
        .as_ref()
        .map(|meta| meta.device_label.clone())
        .unwrap_or_else(|| fallback_label.to_string());
    Ok(Some(SnapshotInfo {
        id,
        date,
        device_id: device_id.clone(),
        device_label: label,
        files,
        bytes,
        expected_files,
        expected_bytes,
        damaged: marker && !healthy,
        complete: marker && healthy,
        legacy,
        current_device: device_id == current_device,
    }))
}

#[cfg(target_os = "android")]
fn list_saf_backups(
    app: &AppHandle,
    root: &FsUri,
    current_device: &str,
) -> Result<Vec<SnapshotInfo>, String> {
    // SAF no permite renombrar: las copias heredadas en `Longlife` se leen
    // como legado mientras el usuario las mueva (o las deje) a mano.
    let mut copies = Vec::new();
    let mut seen_ids = HashSet::new();
    for backup_root in saf_backup_roots(app, root)? {
        for entry in app
            .android_fs()
            .read_dir(&backup_root)
            .map_err(|e| format!("No se pudo leer {BACKUP_DIR}: {e}"))?
        {
            if !entry.is_dir() {
                continue;
            }
            let name = entry.name().to_string();

            if is_date_name(&name) {
                if seen_ids.insert(name.clone()) {
                    if let Some(info) = saf_snapshot_info(
                        app,
                        entry.uri(),
                        name.clone(),
                        name,
                        "legacy",
                        "Copia antigua (sin dispositivo)",
                        true,
                        current_device,
                    )? {
                        copies.push(info);
                    }
                }
                continue;
            }

            for day in app
                .android_fs()
                .read_dir(entry.uri())
                .map_err(|e| format!("No se pudo leer {BACKUP_DIR}: {e}"))?
            {
                if !day.is_dir() {
                    continue;
                }
                let date = day.name().to_string();
                if !is_date_name(&date) {
                    continue;
                }
                let id = format!("{name}/{date}");
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                if let Some(info) = saf_snapshot_info(
                    app,
                    day.uri(),
                    id,
                    date,
                    &name,
                    &format!("Dispositivo {}", short_id(&name)),
                    false,
                    current_device,
                )? {
                    copies.push(info);
                }
            }
        }
    }
    copies.sort_by(|a, b| a.date.cmp(&b.date).then(a.device_id.cmp(&b.device_id)));
    Ok(copies)
}

/// Raíces de copias en SAF: `longlife` y, si sigue existiendo, `Longlife`.
/// En SAF el nombre distingue mayúsculas, así que son carpetas distintas.
#[cfg(target_os = "android")]
fn saf_backup_roots(app: &AppHandle, root: &FsUri) -> Result<Vec<FsUri>, String> {
    let mut roots = Vec::new();
    for name in [BACKUP_DIR, LEGACY_BACKUP_DIR] {
        if let Some(dir) = saf_find_dir(app, root, name)? {
            // FsUri implementa PartialEq; evita repetir la misma carpeta si
            // algún proveedor devuelve la misma URI con los dos nombres.
            if !roots.contains(&dir) {
                roots.push(dir);
            }
        }
    }
    Ok(roots)
}

#[cfg(target_os = "android")]
fn run_saf_backup(
    app: &AppHandle,
    root: &FsUri,
    date: &str,
    device: &str,
) -> Result<Option<String>, String> {
    let Some(omega) = saf_find_dir(app, root, DATA_DIR)? else {
        return Ok(Some(
            "La carpeta omega no existe; no hay nada que copiar.".to_string(),
        ));
    };

    let mut files = Vec::new();
    saf_collect_files(app, &omega, "", 0, &mut files)?;
    if files.is_empty() {
        return Ok(Some(
            "La carpeta omega está vacía; no hay nada que copiar.".to_string(),
        ));
    }

    let backup_root = saf_find_dir(app, root, BACKUP_DIR)?;
    let device_dir = if let Some(backup_root) = &backup_root {
        saf_find_dir(app, backup_root, device)?
    } else {
        None
    };
    let day_dir = if let Some(device_dir) = &device_dir {
        saf_find_dir(app, device_dir, date)?
    } else {
        None
    };

    let omega_files = files.len() as u64;

    if let Some(day_dir) = &day_dir {
        // Las copias nuevas solo tienen el índice NDJSON: se verifica con una
        // lectura en vez de recorrer el árbol por SAF. Las antiguas sin índice
        // siguen cayendo al recuento clásico.
        let meta = saf_read_snapshot_meta(app, day_dir);
        let index_count = saf_find_file(app, day_dir, SNAPSHOT_INDEX)?
            .and_then(|uri| app.android_fs().read_to_string(&uri).ok())
            .map(|text| ndjson_count(&text));
        let (day_files, day_bytes) = if index_count.is_some() {
            (0, 0)
        } else {
            saf_count_dir(app, day_dir)?
        };
        let stale = meta.as_ref().map_or(false, |meta| {
            match (meta.files, index_count) {
                (Some(expected), _) => omega_files > expected,
                _ => false,
            }
        });
        let healthy = match (index_count, meta.as_ref().and_then(|meta| meta.files)) {
            (Some(actual), Some(expected)) => actual == expected,
            _ => manifest_matches_meta(meta.as_ref(), day_files, day_bytes),
        };
        if saf_find_file(app, day_dir, BACKUP_MARKER)?.is_some() && healthy && !stale {
            return Ok(Some("La copia de hoy ya existe.".to_string()));
        }
        saf_delete_tree(app, day_dir)?;
    }

    // Un solo NDJSON con todos los eventos: antes se creaba y escribía un
    // archivo por evento (3-4 llamadas SAF por cada uno). Solo se leen los
    // archivos de `omega` para construir el índice; no se copian uno a uno.
    let mut index = String::new();
    for (_relative, file, _len) in &files {
        let bytes = app
            .android_fs()
            .read(file)
            .map_err(|e| format!("No se pudo leer un archivo de omega: {e}"))?;
        let mut parsed = Vec::new();
        parse_event_content(&String::from_utf8_lossy(&bytes), &mut parsed);
        for event in parsed {
            index.push_str(&serde_json::to_string(&event).map_err(|e| e.to_string())?);
            index.push('\n');
        }
    }

    let index_path = format!("{BACKUP_DIR}/{device}/{date}/{SNAPSHOT_INDEX}");
    saf_write_new_file(app, root, &index_path, "application/x-ndjson", index.as_bytes())
        .map_err(|e| format!("No se pudo indexar la copia: {e}"))?;

    let meta = serde_json::to_vec_pretty(&snapshot_meta(
        device,
        ndjson_count(&index),
        index.len() as u64,
    ))
    .map_err(|e| format!("No se pudo describir la copia: {e}"))?;
    let meta_path = format!("{BACKUP_DIR}/{device}/{date}/{SNAPSHOT_META}");
    saf_write_new_file(app, root, &meta_path, "application/json", &meta)
        .map_err(|e| format!("No se pudo describir la copia: {e}"))?;

    let marker = format!("{BACKUP_DIR}/{device}/{date}/{BACKUP_MARKER}");
    // `text/plain` hace que algunos proveedores SAF añadan `.txt` al nombre
    // (flutter_file_picker#1843). `createDocument` exige un MIME concreto, así
    // que se usa `application/octet-stream`: genérico pero no dispara extensión
    // ni el comodín `*/*`, desaconsejado por AndroidX CreateDocument. El nombre
    // real se verifica en `saf_write_new_file`; sin marcador la copia salía
    // «Incompleta».
    saf_write_new_file(app, root, &marker, "application/octet-stream", b"ok\n")
        .map_err(|e| format!("No se pudo cerrar la copia: {e}"))?;

    prune_saf_backups(app, root)?;
    Ok(None)
}

/// Igual que en local: retención global de `BACKUP_RETENTION` copias, no por
/// dispositivo. Las más antiguas se borran para dar hueco a las nuevas.
#[cfg(target_os = "android")]
fn prune_saf_backups(app: &AppHandle, root: &FsUri) -> Result<(), String> {
    let mut copies = list_saf_backups(app, root, "")?;
    copies.sort_by(|a, b| a.date.cmp(&b.date).then(a.device_id.cmp(&b.device_id)));

    while copies.len() > BACKUP_RETENTION {
        let oldest = copies.remove(0);
        if let Ok(dir) = saf_snapshot_dir(app, root, &oldest.id) {
            saf_delete_tree(app, &dir)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("better-tracker-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recognizes_only_real_dates() {
        assert!(is_date_name("2026-10-28"));
        assert!(!is_date_name("2026-13-01"));
        assert!(!is_date_name("2026-1-01"));
        assert!(!is_date_name("Longlife"));
        assert!(!is_date_name("longlife"));
        assert!(!is_date_name("2026-10-28-extra"));
    }

    #[test]
    fn migrates_legacy_devices_once() {
        let root = temp_dir("migrate");
        let legacy = root.join(DEVICES_DIR).join("device-a");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join(EVENTS_FILE), "{\"id\":\"1\"}\n").unwrap();

        ensure_local_layout(&root).unwrap();

        assert!(!root.join(DEVICES_DIR).exists());
        assert!(root
            .join(DATA_DIR)
            .join(DEVICES_DIR)
            .join("device-a")
            .join(EVENTS_FILE)
            .is_file());

        let _ = fs::remove_dir_all(root);
    }

    /// Crea una copia de prueba `device-a/<fecha>` bajo `backup_root`.
    fn write_snapshot(backup_root: &Path, date: &str) -> PathBuf {
        let dir = backup_root.join("device-a").join(date);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("events.jsonl"), "{\"id\":\"1\"}\n").unwrap();
        fs::write(dir.join(BACKUP_MARKER), b"ok\n").unwrap();
        dir
    }

    #[test]
    fn migrates_uppercase_longlife_to_lowercase() {
        let root = temp_dir("migrate-longlife");
        write_snapshot(&root.join(LEGACY_BACKUP_DIR), "2026-10-28");

        // La primera lectura migra y lista la copia.
        let copies = list_local_backups(&root, "device-a").unwrap();
        assert_eq!(
            copies.len(),
            1,
            "la copia heredada debe seguir viéndose"
        );
        assert!(!root.join(LEGACY_BACKUP_DIR).exists());
        assert!(root
            .join(BACKUP_DIR)
            .join("device-a")
            .join("2026-10-28")
            .join("events.jsonl")
            .is_file());

        // Segunda lectura: ya no hay nada que migrar.
        let copies = list_local_backups(&root, "device-a").unwrap();
        assert_eq!(copies.len(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_uppercase_longlife_when_lowercase_already_exists() {
        let root = temp_dir("longlife-legacy");
        write_snapshot(&root.join(BACKUP_DIR), "2026-10-29");
        write_snapshot(&root.join(LEGACY_BACKUP_DIR), "2026-10-28");

        let copies = list_local_backups(&root, "device-a").unwrap();
        let branches: Vec<&str> = copies.iter().map(|c| c.date.as_str()).collect();
        assert!(
            branches.contains(&"2026-10-28") && branches.contains(&"2026-10-29"),
            "deben listarse ambas copias, nuevo {branches:?}"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_snapshots_in_the_uppercase_legacy_dir() {
        let root = temp_dir("longlife-resolve");
        write_snapshot(&root.join(LEGACY_BACKUP_DIR), "2026-10-28");

        let dir = resolve_snapshot_dir(&root, "device-a/2026-10-28").unwrap();
        assert!(dir.join("events.jsonl").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn keeps_both_sources_when_legacy_device_already_exists() {
        let root = temp_dir("migrate-collision");
        let legacy = root.join(DEVICES_DIR).join("device-a");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join(EVENTS_FILE), "{\"id\":\"old\"}\n").unwrap();

        let current = root.join(DATA_DIR).join(DEVICES_DIR).join("device-a");
        fs::create_dir_all(&current).unwrap();
        fs::write(current.join(EVENTS_FILE), "{\"id\":\"new\"}\n").unwrap();

        ensure_local_layout(&root).unwrap();

        assert!(!root.join(DEVICES_DIR).exists());
        let dirs: Vec<_> = fs::read_dir(root.join(DATA_DIR).join(DEVICES_DIR))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(dirs.len(), 2, "the old device must not be discarded");
        let old = dirs
            .iter()
            .map(|entry| fs::read_to_string(entry.path().join(EVENTS_FILE)).unwrap())
            .find(|content| content.contains("\"old\""))
            .expect("legacy event preserved");
        assert!(old.contains("\"old\""));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copies_nested_tree_and_counts_files() {
        let root = temp_dir("copy");
        let source = root.join("source");
        fs::create_dir_all(source.join("a/b")).unwrap();
        fs::write(source.join("one.jsonl"), b"one\n").unwrap();
        fs::write(source.join("a/b/two.json"), b"{}").unwrap();
        fs::write(source.join(BACKUP_MARKER), b"ignore\n").unwrap();

        let destination = root.join("destination");
        let (files, bytes) = copy_dir_recursive(&source, &destination).unwrap();
        assert_eq!(files, 3);
        assert!(bytes > 0);
        assert!(destination.join("a/b/two.json").is_file());

        let (counted_files, counted_bytes) = count_dir(&destination).unwrap();
        assert_eq!(counted_files, 2, "the marker must not count as data");
        assert!(counted_bytes > 0);

        let _ = fs::remove_dir_all(root);
    }

    fn sample_event(id: &str) -> Event {
        Event {
            id: id.to_string(),
            device_id: "device-a".to_string(),
            timestamp: format!("2026-10-28T12:00:0{}Z", id.len() % 10),
            kind: "weight.logged".to_string(),
            payload: serde_json::json!({ "date": "2026-10-28", "kg": 80 }),
        }
    }

    fn write_sample_event(root: &Path, event: &Event) {
        let file_name = event_file_name(event).unwrap();
        let payload = serde_json::to_vec(event).unwrap();
        write_local_event(root, event, &file_name, &payload).unwrap();
    }

    #[test]
    fn prunes_to_seven_snapshots_in_total_across_devices() {
        let root = temp_dir("prune-global");
        let backup_root = root.join(BACKUP_DIR);
        for (device, first, last) in [("device-a", 1, 8), ("device-b", 11, 18)] {
            for day in first..=last {
                let dir = backup_root.join(device).join(format!("2026-10-{day:02}"));
                fs::create_dir_all(&dir).unwrap();
                fs::write(dir.join("events.jsonl"), b"x").unwrap();
                fs::write(dir.join(BACKUP_MARKER), b"ok\n").unwrap();
            }
        }
        // Una carpeta vacía no cuenta como copia.
        let empty = backup_root.join("device-a").join("2026-09-30");
        fs::create_dir_all(&empty).unwrap();

        prune_local_backups(&root).unwrap();
        let remaining = list_local_backups(&root, "").unwrap();
        assert_eq!(remaining.len(), BACKUP_RETENTION, "7 copies in total");
        assert!(
            remaining.iter().all(|copy| copy.id.starts_with("device-b/")),
            "only the newest device's snapshots survive: {:?}",
            remaining.iter().map(|c| c.id.as_str()).collect::<Vec<_>>()
        );
        assert_eq!(remaining.first().unwrap().date, "2026-10-12");
        assert!(empty.exists(), "an empty date folder is not a backup");
        assert!(
            !backup_root.join("device-a").join("2026-10-08").exists(),
            "the oldest copies are deleted, not hidden"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restores_from_the_centralized_snapshot_index() {
        let root = temp_dir("restore-index");
        let current = sample_event("current");
        write_sample_event(&root, &current);

        let day = root.join(BACKUP_DIR).join("device-a").join("2026-11-26");
        fs::create_dir_all(&day).unwrap();
        let missing = sample_event("only-in-snapshot");
        fs::write(
            day.join(SNAPSHOT_INDEX),
            format!("{}\n{}\n", serde_json::to_string(&current).unwrap(), serde_json::to_string(&missing).unwrap()),
        )
        .unwrap();

        let result = restore_local_snapshot(&root, "device-a/2026-11-26").unwrap();
        assert_eq!(result.source_events, 2);
        assert_eq!(result.imported, 1);
        assert_eq!(result.events[0].id, "only-in-snapshot");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn event_index_roundtrip_rejects_wrong_version_and_vault() {
        let mut index = empty_event_index("vault-a");
        index.files.push(IndexedFile {
            relative: "device-a/events/event-a.json".to_string(),
            modified: 123,
            len: 10,
            events: vec![sample_event("event-a")],
        });
        let text = serde_json::to_string(&index).unwrap();
        let parsed = parse_event_index(&text, "vault-a");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].events[0].id, "event-a");
        assert!(parse_event_index(&text, "vault-b").files.is_empty());

        let mut wrong = index;
        wrong.version = EVENT_INDEX_VERSION + 1;
        let text = serde_json::to_string(&wrong).unwrap();
        assert!(parse_event_index(&text, "vault-a").files.is_empty());
        assert!(parse_event_index("no es json", "vault-a").files.is_empty());
    }

    #[test]
    fn stores_one_file_per_event_and_deduplicates_legacy_jsonl() {
        let root = temp_dir("events");
        let event = sample_event("event-a");
        write_sample_event(&root, &event);
        write_sample_event(&root, &event);

        let device = root.join(DATA_DIR).join(DEVICES_DIR).join("device-a");
        let legacy = serde_json::to_string(&event).unwrap();
        fs::write(device.join(EVENTS_FILE), format!("{legacy}\n{legacy}\n")).unwrap();

        let events = read_local_events(&root).unwrap();
        assert_eq!(events.len(), 1, "duplicate ids are ignored");
        assert_eq!(events[0].id, "event-a");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restores_missing_events_without_overwriting_current_vault() {
        let root = temp_dir("restore");
        let current = sample_event("current");
        write_sample_event(&root, &current);

        let snapshot_dir = root
            .join(BACKUP_DIR)
            .join("device-phone")
            .join("2026-10-27");
        fs::create_dir_all(&snapshot_dir).unwrap();
        let old = sample_event("only-in-snapshot");
        fs::write(
            snapshot_dir.join(EVENTS_FILE),
            format!(
                "{}\n{}\n",
                serde_json::to_string(&current).unwrap(),
                serde_json::to_string(&old).unwrap()
            ),
        )
        .unwrap();
        fs::write(snapshot_dir.join(BACKUP_MARKER), b"ok\n").unwrap();

        let result = restore_local_snapshot(&root, "device-phone/2026-10-27").unwrap();
        assert_eq!(result.imported, 1);
        assert_eq!(result.already_present, 1);
        assert_eq!(result.source_events, 2);

        let events = read_local_events(&root).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().any(|event| event.id == "current"));
        assert!(events.iter().any(|event| event.id == "only-in-snapshot"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn retention_keeps_the_oldest_restorable_snapshot() {
        let root = temp_dir("retention-restore");
        let backup_root = root.join(BACKUP_DIR);
        // Ocho días: al podar debe desaparecer el primero y el resto debe
        // seguir siendo restaurable (CI ejecuta esta prueba en cargo test).
        for day in 1..=8 {
            let dir = backup_root.join("device-a").join(format!("2026-11-{day:02}"));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(EVENTS_FILE), b"x").unwrap();
            fs::write(dir.join(BACKUP_MARKER), b"ok\n").unwrap();
        }
        prune_local_backups(&root).unwrap();

        let deleted = backup_root.join("device-a").join("2026-11-01");
        assert!(!deleted.exists(), "the oldest snapshot is deleted, not hidden");
        let remaining = list_local_backups(&root, "device-a").unwrap();
        assert_eq!(remaining.len(), BACKUP_RETENTION);

        let oldest_kept = backup_root.join("device-a").join("2026-11-02");
        assert!(oldest_kept.is_dir(), "the oldest retained snapshot can be restored");
        let result = restore_local_snapshot(&root, "device-a/2026-11-02").unwrap();
        assert_eq!(result.source_events, 0, "placeholder file has no valid events");

        let _ = fs::remove_dir_all(root);
    }

    fn snapshot_with_manifest(root: &Path, files: &[(&str, &[u8])]) -> PathBuf {
        let dir = root.join(BACKUP_DIR).join("device-a").join("2026-10-28");
        fs::create_dir_all(&dir).unwrap();
        for (name, content) in files {
            let path = dir.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }
        let (count, bytes) = count_dir(&dir).unwrap();
        let meta = serde_json::to_vec_pretty(&snapshot_meta("device-a", count, bytes)).unwrap();
        fs::write(dir.join(SNAPSHOT_META), meta).unwrap();
        fs::write(dir.join(SNAPSHOT_INDEX), b"{\"id\":\"x\"}\n").unwrap();
        fs::write(dir.join(BACKUP_MARKER), b"ok\n").unwrap();
        dir
    }

    fn snapshot_info(dir: &Path) -> SnapshotInfo {
        local_snapshot_info(
            dir,
            "device-a/2026-10-28".to_string(),
            "2026-10-28".to_string(),
            "device-a",
            "Dispositivo",
            false,
            "device-a",
        )
        .unwrap()
        .expect("la copia debe listarse")
    }

    #[test]
    fn snapshot_counts_ignore_its_own_metadata() {
        let root = temp_dir("count-meta");
        let dir = snapshot_with_manifest(&root, &[("events/a.json", b"aaaa")]);

        let (files, bytes) = count_dir(&dir).unwrap();
        assert_eq!(files, 1, "snapshot.json, el marcador y el índice no son datos");
        assert_eq!(bytes, 4);
        let info = snapshot_info(&dir);
        assert!(!info.damaged, "la copia con índice no debe salir dañada");
        assert!(info.complete);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restores_from_index_only_snapshot() {
        let root = temp_dir("index-only");
        let day = root.join(BACKUP_DIR).join("device-a").join("2026-10-28");
        fs::create_dir_all(&day).unwrap();
        let event = sample_event("indexed-1");
        let index = format!("{}\n", serde_json::to_string(&event).unwrap());
        fs::write(day.join(SNAPSHOT_INDEX), &index).unwrap();
        fs::write(
            day.join(SNAPSHOT_META),
            serde_json::to_vec_pretty(&snapshot_meta("device-a", 1, index.len() as u64)).unwrap(),
        )
        .unwrap();
        fs::write(day.join(BACKUP_MARKER), b"ok\n").unwrap();

        let result = restore_local_snapshot(&root, "device-a/2026-10-28").unwrap();
        assert_eq!(result.imported, 1);
        assert_eq!(result.events[0].id, event.id);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ndjson_count_ignores_blank_lines() {
        assert_eq!(ndjson_count("{\"id\":\"a\"}\n\n{\"id\":\"b\"}\n"), 2);
        assert_eq!(ndjson_count(""), 0);
    }

    #[test]
    fn backup_is_stale_only_when_omega_gained_events() {
        let root = temp_dir("stale");
        let omega = root.join(DATA_DIR);
        fs::create_dir_all(omega.join("events")).unwrap();
        fs::write(omega.join("events/a.json"), b"aaaa").unwrap();

        let day = snapshot_with_manifest(&root, &[("events/a.json", b"aaaa")]);
        assert!(!local_backup_is_stale(&omega, &day).unwrap());

        // Un evento guardado después de la copia obliga a rehacerla.
        fs::write(omega.join("events/b.json"), b"bbbb").unwrap();
        assert!(local_backup_is_stale(&omega, &day).unwrap());

        // Si `omega` pierde datos, la copia no se toca: es la que protege.
        fs::remove_file(omega.join("events/b.json")).unwrap();
        fs::remove_file(omega.join("events/a.json")).unwrap();
        assert!(!local_backup_is_stale(&omega, &day).unwrap());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn syncs_new_events_into_todays_backup() {
        let root = temp_dir("sync-backup");
        let day = snapshot_with_manifest(&root, &[("devices/device-a/events/a.json", b"aaaa")]);

        let event = Event {
            id: "b".to_string(),
            device_id: "device-a".to_string(),
            timestamp: "2026-11-07T21:00:00.000Z".to_string(),
            kind: "routine.saved".to_string(),
            payload: serde_json::json!({ "id": "r" }),
        };
        let relative = Path::new(DEVICES_DIR)
            .join("device-a")
            .join(EVENTS_DIR)
            .join("b.json");
        let source = root.join(DATA_DIR).join(&relative);
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"bbbb").unwrap();

        sync_backup_event_files(&day, &root, &event, "b.json").unwrap();

        assert!(day.join(&relative).is_file(), "el evento debe llegar a longlife");
        let meta = read_local_meta(&day).expect("la copia conserva su manifiesto");
        assert_eq!(meta.files, Some(2));
        assert_eq!(meta.bytes, Some(8));
        assert!(manifest_matches(&day).unwrap());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detects_snapshots_that_do_not_match_their_manifest() {
        let root = temp_dir("integrity");
        let dir = snapshot_with_manifest(
            &root,
            &[("events/a.json", b"aaaa"), ("events/b.json", b"bbbb")],
        );

        let healthy = snapshot_info(&dir);
        assert!(healthy.complete && !healthy.damaged);
        assert_eq!(healthy.expected_files, Some(2));
        assert_eq!(healthy.expected_bytes, Some(8));

        // Sincronización a medias: el marcador llegó pero falta un archivo.
        fs::remove_file(dir.join("events/b.json")).unwrap();
        let missing = snapshot_info(&dir);
        assert!(!missing.complete, "una copia incompleta no es restaurable de fiar");
        assert!(missing.damaged);
        assert_eq!(missing.files, 1);
        assert_eq!(missing.expected_files, Some(2));

        // Un archivo extra tampoco cuadra.
        fs::write(dir.join("events/b.json"), b"bbbb").unwrap();
        fs::write(dir.join("events/c.json"), b"c").unwrap();
        assert!(!manifest_matches(&dir).unwrap());
        assert!(snapshot_info(&dir).damaged);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn snapshots_without_manifest_are_still_considered_valid() {
        let root = temp_dir("no-manifest");
        let dir = root.join(BACKUP_DIR).join("device-a").join("2026-10-28");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("events.jsonl"), b"{\"id\":\"1\"}\n").unwrap();
        fs::write(dir.join(BACKUP_MARKER), b"ok\n").unwrap();

        assert!(manifest_matches(&dir).unwrap());
        let info = snapshot_info(&dir);
        assert!(info.complete && !info.damaged);
        assert_eq!(info.expected_files, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ignores_symlinks_circular_dirs_and_oversized_files() {
        let root = temp_dir("symlinks");
        let event = sample_event("valid");
        write_sample_event(&root, &event);

        let events_dir = root
            .join(DATA_DIR)
            .join(DEVICES_DIR)
            .join("device-a")
            .join(EVENTS_DIR);

        // Archivo grande (disperso) que supera el límite de lectura.
        let huge = events_dir.join("huge.json");
        let big = fs::File::create(&huge).unwrap();
        big.set_len(MAX_LOCAL_EVENT_BYTES + 1).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            // Bucle: la carpeta de eventos se enlaza a sí misma.
            symlink(&events_dir, events_dir.join("loop")).unwrap();
            // Enlace a un archivo fuera de la estructura esperada.
            let external = root.join("external.json");
            fs::write(&external, b"{\"id\":\"external\"}").unwrap();
            symlink(&external, events_dir.join("external.json")).unwrap();
            // Un dispositivo entero enlazado tampoco se sigue.
            symlink(
                root.join(DATA_DIR).join(DEVICES_DIR).join("device-a"),
                root.join(DATA_DIR).join(DEVICES_DIR).join("linked-device"),
            )
            .unwrap();
        }

        let events = read_local_events(&root).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "valid");

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn hardens_vault_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("permissions");
        let event = sample_event("permissions");
        write_sample_event(&root, &event);

        let omega = root.join(DATA_DIR);
        let devices = omega.join(DEVICES_DIR);
        let device = devices.join("device-a");
        let events_dir = device.join(EVENTS_DIR);
        let event_file = events_dir.join("permissions.json");

        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&omega), 0o700);
        assert_eq!(mode(&devices), 0o700);
        assert_eq!(mode(&device), 0o700);
        assert_eq!(mode(&events_dir), 0o700);
        assert_eq!(mode(&event_file), 0o600);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_saf_roots_without_android() {
        let root = parse_saf_root(
            r#"{"uri":"content://provider/tree/primary%3AVault","documentTopTreeUri":"content://provider/document/primary%3AVault"}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(root.uri, "content://provider/tree/primary%3AVault");
        assert_eq!(
            root.document_top_tree_uri.as_deref(),
            Some("content://provider/document/primary%3AVault")
        );

        let legacy = parse_saf_root(r#"{"topTreeUri":"content://legacy","relativeTerms":[]}"#)
            .unwrap()
            .unwrap();
        assert_eq!(legacy.uri, "content://legacy");
        assert_eq!(parse_saf_root("content://plain").unwrap().unwrap().uri, "content://plain");
        assert!(parse_saf_root("/home/user/vault").unwrap().is_none());
        assert!(parse_saf_root("").unwrap().is_none());
    }

    #[test]
    fn event_ids_come_only_from_canonical_file_names() {
        assert_eq!(event_id_from_file_name("abc-123.json"), Some("abc-123"));
        assert_eq!(event_id_from_file_name(EVENTS_FILE), None);
        assert_eq!(event_id_from_file_name(SNAPSHOT_META), None);
        assert_eq!(event_id_from_file_name(BACKUP_MARKER), None);
        assert_eq!(event_id_from_file_name(".abc.tmp"), None);
        assert_eq!(event_id_from_file_name("notes.txt"), None);
    }

    #[test]
    fn counting_entries_uses_reported_len_and_skips_metadata() {
        let entries = vec![
            CountingEntry { name: "a.json".into(), is_dir: false, len: Some(10) },
            CountingEntry { name: "b.json".into(), is_dir: false, len: Some(32) },
            CountingEntry { name: SNAPSHOT_META.into(), is_dir: false, len: Some(999) },
            CountingEntry { name: BACKUP_MARKER.into(), is_dir: false, len: Some(999) },
            CountingEntry { name: ".leftover.tmp".into(), is_dir: false, len: Some(999) },
            CountingEntry { name: "events".into(), is_dir: true, len: None },
        ];
        assert_eq!(count_entries(&entries), (2, 42));
    }

    #[test]
    fn counting_a_week_of_snapshots_uses_only_metadata() {
        let entries: Vec<CountingEntry> = (0..7)
            .flat_map(|day| {
                (0..500).map(move |index| CountingEntry {
                    name: format!("{day}-{index}.json"),
                    is_dir: false,
                    len: Some(64),
                })
            })
            .collect();
        let (files, bytes) = count_entries(&entries);
        assert_eq!(files, 3500);
        assert_eq!(bytes, 3500 * 64);
    }

    #[test]
    fn manifest_health_reuses_precomputed_counts() {
        let meta = SnapshotMeta {
            device_id: "device".into(),
            device_label: "label".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            platform: "Linux".into(),
            app_version: "1".into(),
            files: Some(2),
            bytes: Some(42),
        };
        assert!(manifest_matches_meta(Some(&meta), 2, 42));
        assert!(!manifest_matches_meta(Some(&meta), 1, 42));
        assert!(!manifest_matches_meta(Some(&meta), 2, 41));
        assert!(manifest_matches_meta(None, 999, 999));
    }

    #[test]
    fn restore_plan_reads_only_missing_and_unique_ids() {
        let current: HashSet<String> = ["present".to_string()].into_iter().collect();
        let planned = plan_missing_ids(
            &current,
            vec!["present".into(), "missing".into(), "missing".into(), "other".into()],
        );
        assert_eq!(planned, vec!["missing", "other"]);
    }
}
