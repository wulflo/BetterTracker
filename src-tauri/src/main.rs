// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Process --version at the very beginning of main, before creating any
    // window or touching the network. Prints the embedded version and exits.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("{}", better_tracker_lib::version::VERSION);
        return;
    }

    configure_webkit_rendering();

    better_tracker_lib::run();
}

/// Ajusta el renderizado de WebKitGTK antes de que se inicialice GTK.
///
/// Con el driver propietario de NVIDIA, la ruta DMA-BUF/EGL de WebKitGTK puede
/// terminar en un `SIGSEGV` dentro de `libnvidia-eglcore` (visto con la serie
/// 580). El proceso web muere, la ventana deja artefactos y el compositor se
/// queda esperando fences inválidos: la app se congela y no llega a guardar.
/// En esos equipos forzamos el renderer de memoria compartida, que no toca la
/// ruta EGL de NVIDIA. Es una decisión de estabilidad: la app es un formulario,
/// no un juego, así que perder aceleración es preferible a congelar el equipo.
///
/// En AppImage sin NVIDIA se mantiene el ajuste anterior: `FORCE_SHM` evita el
/// `SIGABRT` de `WebKitWebProcess` al cerrar con la ruta EGL/DMA-BUF de Mesa.
/// Cualquier variable fijada por la persona usuaria tiene prioridad y desactiva
/// la detección automática.
#[cfg(target_os = "linux")]
fn configure_webkit_rendering() {
    if user_overrode_webkit_rendering() {
        return;
    }

    if nvidia_driver_loaded() {
        // Debe ejecutarse antes de inicializar GTK/WebKit; los procesos hijo
        // (`WebKitWebProcess`, `WebKitNetworkProcess`) heredan el entorno.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        return;
    }

    // En máquinas virtuales y equipos sin nodo de render por GPU, la ruta
    // DMA-BUF/EGL de WebKitGTK suele caer en una GPU virtual (virtio-gpu,
    // VMware SVGA, VBoxVGA…) que es mucho más lenta que el renderer de
    // memoria compartida. El resultado es una interfaz que tarda segundos en
    // repintar. En esos entornos forzamos el mismo camino SHM que ya usamos
    // con NVIDIA: se pierde aceleración, pero la app vuelve a ser usable.
    if running_in_vm() || software_rendering_only() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        if software_rendering_only() {
            // Sin nodo de render, el compositor acelerado solo añade copias de
            // textura sobre llvmpipe; desactivarlo aligera el repintado.
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        }
        return;
    }

    if std::env::var_os("APPIMAGE").is_some() {
        std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_webkit_rendering() {}

#[cfg(target_os = "linux")]
fn user_overrode_webkit_rendering() -> bool {
    [
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
        "WEBKIT_DISABLE_COMPOSITING_MODE",
        "__NV_DISABLE_EXPLICIT_SYNC",
        "LIBGL_ALWAYS_SOFTWARE",
    ]
    .iter()
    .any(|name| std::env::var_os(name).is_some())
}

/// Detecta el driver propietario de NVIDIA (no `nouveau`).
///
/// `/proc/driver/nvidia` no existe dentro de Flatpak; `/sys/class/drm` sí se
/// comparte con el sandbox, así que se consultan ambos. En portátiles híbridos
/// basta con que NVIDIA esté cargado: WebKit puede elegir su render node aunque
/// la GPU primaria sea la integrada, como ocurre en este equipo.
#[cfg(target_os = "linux")]
fn nvidia_driver_loaded() -> bool {
    if std::path::Path::new("/proc/driver/nvidia/version").exists()
        || std::path::Path::new("/sys/module/nvidia").exists()
    {
        return true;
    }

    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return false;
    };

    entries.flatten().any(|entry| {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Solo tarjetas (`card0`, `card1`…), no conectores (`card1-eDP-1`).
        if !name.starts_with("card") || name.contains('-') {
            return false;
        }
        let driver = entry.path().join("device/driver");
        std::fs::read_link(driver)
            .ok()
            .and_then(|target| target.file_name().map(|file| file == "nvidia"))
            .unwrap_or(false)
    })
}

/// Firmas de hipervisor que aparecen en DMI o en `/proc/cpuinfo`.
const VM_MARKERS: &[&str] = &[
    "qemu",
    "kvm",
    "virtualbox",
    "innotek",
    "vmware",
    "virtual machine",
    "bochs",
    "xen",
    "hyper-v",
    "microsoft corporation",
    "parallels",
    "openstack",
    "bhyve",
    "google compute engine",
    "amazon ec2",
    "digitalocean",
    "hetzner",
];

/// `true` si el texto de DMI/CPU corresponde a un hipervisor conocido.
///
/// Se separa de la lectura de ficheros para poder probarlo sin depender del
/// hardware donde corre `cargo test`.
fn text_looks_virtual(text: &str) -> bool {
    let lower = text.to_lowercase();
    VM_MARKERS.iter().any(|marker| lower.contains(marker))
}

/// Detecta máquinas virtuales por DMI, `/proc/xen` y el flag `hypervisor`.
///
/// No basta con mirar si hay `/dev/dri`: muchas VM exponen `virtio-gpu` y
/// ofrecen un nodo de render que funciona, pero a una fracción de la velocidad
/// de una GPU real. Por eso se consulta el identificador del sistema.
#[cfg(target_os = "linux")]
fn running_in_vm() -> bool {
    const DMI_FILES: &[&str] = &[
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/product_name",
        "/sys/class/dmi/id/board_vendor",
        "/sys/class/dmi/id/bios_vendor",
        "/sys/class/dmi/id/product_family",
    ];
    for file in DMI_FILES {
        if let Ok(text) = std::fs::read_to_string(file) {
            if text_looks_virtual(&text) {
                return true;
            }
        }
    }

    if std::path::Path::new("/proc/xen").exists() {
        return true;
    }
    if let Ok(kind) = std::fs::read_to_string("/sys/hypervisor/type") {
        if !kind.trim().is_empty() {
            return true;
        }
    }

    if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
        let hypervisor = cpuinfo.lines().any(|line| {
            line.starts_with("flags")
                && line
                    .split_whitespace()
                    .any(|flag| flag == "hypervisor")
        });
        if hypervisor {
            return true;
        }
    }

    false
}

/// `true` si no hay ningún nodo `renderD*`, señal de que Mesa/WebKit no tiene
/// una GPU con render offscreen y va a usar llvmpipe para todo.
#[cfg(target_os = "linux")]
fn software_rendering_only() -> bool {
    let Ok(entries) = std::fs::read_dir("/dev/dri") else {
        return true;
    };
    !entries.flatten().any(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .starts_with("renderD")
    })
}

#[cfg(all(test, target_os = "linux"))]
mod rendering_tests {
    use super::text_looks_virtual;

    #[test]
    fn detects_common_hypervisor_vendors() {
        assert!(text_looks_virtual("innotek GmbH"));
        assert!(text_looks_virtual("QEMU"));
        assert!(text_looks_virtual("VMware, Inc."));
        assert!(text_looks_virtual("VirtualBox"));
        assert!(text_looks_virtual("Microsoft Corporation"));
        assert!(text_looks_virtual("Xen"));
        assert!(text_looks_virtual("KVM"));
    }

    #[test]
    fn ignores_physical_hardware() {
        assert!(!text_looks_virtual("ASUSTeK COMPUTER INC."));
        assert!(!text_looks_virtual("Dell Inc."));
        assert!(!text_looks_virtual("LENOVO"));
        assert!(!text_looks_virtual(""));
    }
}
