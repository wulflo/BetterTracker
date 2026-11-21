# Checklist v0.10.1 — predictor de peso e intervalo científico

Estado de continuidad para retomar si se corta la conexión. Marcar cada punto
solo cuando esté verificado.

## 1. Revisión con datos reales

- [x] Localizar la bóveda real: `/home/alonso/Descargas/Salud/omega`.
- [x] Leer los 184 eventos y extraer la última medida:
  - Hombre, 24 años, 178 cm, 120 kg, cintura 115, cuello 48, abdomen 111.
  - Composición: 29,7 % grasa, 35,6 kg grasa, 84,4 kg masa magra, IMC 37,9.
- [x] Extraer entradas reales de la proyección:
  - Actividad `moderate` (último evento), 10 000 pasos/día, ingesta media
    2 500 kcal/día, frecuencia 4 sesiones/semana, 0 sesiones de fuerza en
    30 días, objetivo `cut`.
- [x] Ejecutar `projectBody` con esos datos y revisar TDEE, ritmo, ETA e hitos.
- [x] Comparar el resultado con los valores de referencia de la literatura
  (BMR Mifflin/Katch, PAL, coste de caminar, Forbes, tope de ritmo).
- [x] Guardar la salida final en `/tmp/realdata-final.json` (y `/tmp/realdata.json`).

Resultado final con datos reales:

- TDEE ≈ 3 439 kcal/día; BMR ≈ 2 275; NEAT ≈ 682; déficit ≈ 939 kcal/día (27 %).
- Ritmo ≈ 0,87 kg/semana (limitado por el tope seguro de 0,72 % del peso).
- Objetivo 91,1 kg en ≈ 33 semanas; ETA central `2027-07-12`.
- Intervalo del 90 % en la ETA: ≈ 87,8–103,6 kg.
- Fechas de llegada del 90 %: `2027-07-03`–`2028-05-13`.

## 2. Correcciones detectadas y aplicadas

- [x] **NEAT duplicaba el BMR**: `TDEE = BMR + TEF + NEAT + EAT` y el NEAT usaba
  `factor PAL × BMR`. Ahora usa `(PAL − 1) × BMR`.
- [x] **Pasos duplicaban el PAL**: el PAL ya incluye caminar. Ahora
  `NEAT = max((PAL − 1) × BMR, gasto de pasos)`.
- [x] **Coste de caminar 10× bajo**: pasa de `0,045` a `0,45 kcal/kg/1000 pasos`
  (≈0,5 kcal/kg/km con 1 000 pasos ≈ 0,75 km).
- [x] **Curva de Forbes mal aplicada**: la fracción magra es
  `10,4 / (F + 10,4)`, no `10,4 / F`; se acota a 5–40 % sin fuerza.
- [x] **Hitos incoherentes con la trayectoria**: la grasa y la masa magra de los
  hitos salen del integrador, no de una interpolación lineal al objetivo.
- [x] **Banda que colapsaba al llegar al objetivo**: los escenarios de
  incertidumbre ya no se detienen en el objetivo; se evalúan en la misma fecha.
- [x] **Banda ±8 % sin base estadística**: sustituida por un intervalo de
  predicción del 90 % (percentiles 5–95) con Monte Carlo determinista (81
  escenarios) sobre:
  - BMR ±10 % (SEE de Mifflin/Cunningham).
  - PAL/NEAT ±12 %.
  - Ingesta ±10 % manual/objetivo, ±6 % registrada.
  - Termogénesis adaptativa α ±50 %.
  - Partición Forbes ±20 %.
  - Agua ±1,5 kg.
- [x] Las fechas de llegada por percentil se calculan sobre los escenarios
  completos y siempre contienen la fecha central.

## 3. Pruebas

- [x] `metrics.test.ts`: actualizadas las expectativas de NEAT y pasos.
- [x] `bodyRange.test.ts`: prueba nueva de que el intervalo del 90 % contiene el
  valor central, no colapsa y contiene los hitos.
- [x] `npm test` completo: 9 archivos, 92 pruebas en verde.
- [x] `npx tsc --noEmit` sin errores.
- [x] `npm run build` correcto.
- [x] Eliminado el test temporal `src/zz-realdata.test.ts`.

## 4. Documentación

- [x] `docs/METODOLOGIA.md`: NEAT con `max`, 0,045 → 0,45, Forbes y el intervalo.
- [x] `docs/USAGE.md` y `docs/USAGE.en.md`: banda ±8 % → intervalo del 90 %.
- [x] `DECISIONES.md`: actualizada la sección de proyección.
- [x] `CHECKLIST_CONTINUACION.md`: añadida la release 0.10.1 al final.
- [x] `docs/releases/v0.10.1.md`: notas de release.

## 5. Bump a 0.10.1

- [x] `VERSION` = `0.10.1`.
- [x] `node scripts/sync-version.mjs` ejecutado y verificado:
  - `package.json`, `package-lock.json`.
  - `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
  - `snapcraft.yaml`, `packaging/flatpak/com.bettertracker.desktop.metainfo.xml`.
- [x] `README.md`: badge y texto de versión actual.
- [x] `README.es.md`: badge y texto de versión actual.
- [x] `grep -rn "0.9.21"` sin referencias activas (solo notas históricas).

## 6. Release y workflows

- [x] Revisar `git diff` y `git status`; sin artefactos ni `dist/`.
- [x] Commit en `main`: `6a757f3 release: 0.10.1 — fix energy model and add
  90% prediction interval`.
- [x] Push a `main` → CI lanzado:
  https://github.com/wulflo/BetterTracker/actions/runs/44879408038
- [x] Tag `v0.10.1` creado y pusheado → Release lanzada (llama a CI y a
  Linux packages): https://github.com/wulflo/BetterTracker/actions/runs/44879413858
- [x] `store-msix` no se lanzó (solo `workflow_dispatch` manual).
- [x] Sin `gh run watch`; solo se reportaron las URLs.

## Notas de continuación

- Repositorio: `/home/alonso/Documentos/Repositorios/BetterTracker`.
- Rama de trabajo: `main`.
- Si el push falla por red: repetir `git push origin main` y luego
  `git push origin v0.10.1`; no rehacer el bump.
- Si hay que revalidar el modelo con datos reales: recrear un test temporal que
  lea la bóveda y llame a `projectBody`, y borrarlo antes de commitear.
