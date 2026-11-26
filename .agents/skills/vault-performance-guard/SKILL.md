---
name: vault-performance-guard
description: Audita SinNotas para evitar código muerto, duplicación y lecturas completas de bóvedas grandes. Ejecutar antes de cerrar cualquier PR o cambio en el manejo de archivos, índices, búsqueda o flashcards.
---

# Reglas de Auditoría de Rendimiento y Limpieza (SinNotas)

## 1. Prohibición de lectura masiva de bóveda (Large Vault Safety)
- **Nunca** leer todo el directorio de notas en memoria (`readDir` recursivo + lectura completa de contenido) en el hilo principal ni al iniciar la app.
- Toda búsqueda, listado o extracción de flashcards debe operar mediante:
  - Carga diferida (*lazy loading*) por archivo activo o vista visible (virtualización de listas).
  - Índices incrementales o consultas paginadas/filtradas desde Rust/SQLite antes de cruzar el puente IPC hacia el WebView.
- Verificar que los eventos del sistema de archivos (*file watchers*) tengan *debounce* y actualicen únicamente el nodo modificado, sin reconstruir toda la bóveda.

## 2. Detección de código remanente y duplicado
Antes de dar por finalizada cualquier tarea, ejecuta en terminal y corrige lo encontrado:
1. **Frontend (TS/Vite):**
   - `npx knip` (detecta archivos huérfanos, funciones exportadas sin uso y dependencias muertas).
   - `npx jscpd src/` (detecta bloques de código duplicado mayores al 3%).
2. **Backend (Rust/Tauri):**
   - `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
   - Verificar que no queden comandos `#[tauri::command]` registrados en `invoke_handler` que ya no se llamen desde el frontend.

## 3. Checklist obligatorio antes de responder al usuario
- [ ] ¿Se introdujo algún `Promise.all` sobre una lista sin acotar de archivos de la bóveda? (Si es así, reemplazar por procesamiento por lotes o delegar a Rust).
- [ ] ¿Quedaron funciones antiguas, tipos obsoletos o estilos CSS sin usar tras el refactor?
- [ ] ¿El cambio mantiene fluida la app tanto en escritorio como en Android con WebView limitado?
