# Checklist v0.10.2 — Estructure, skills y autor del instalador

Versión: **0.10.2**. Tag: `v0.10.2`. Fecha: **2026-11-25**.
Sin cambios funcionales: `VAULT_SCHEMA_VERSION` sigue siendo `1`.

## 1. Alcance

- [x] `docs/Estructure.md` (738 líneas): mapa técnico de Better Tracker.
- [x] `.opencode/skills/estructure`, `estilo-ui`, `guia-de-uso`, `traducciones-ui`,
  `busqueda-incremental` y `.opencode/commands/estructure-sync.md`.
- [x] Autor del instalador: `bundle.publisher = "wulflo"` en `tauri.conf.json` y
  `authors = ["wulflo"]` en `Cargo.toml` (el MSIX ya usaba `wulflo`).
- [x] Sin cambios en lógica ni en dependencias. Los 11 PR de Dependabot quedan fuera.

## 2. Verificación local

- [x] `npx tsc --noEmit` sin errores.
- [x] `npm test`: 9 archivos, 92 pruebas en verde.
- [x] `npm run build` (Vite) correcto.
- [x] `cargo check --locked --manifest-path src-tauri/Cargo.toml` correcto.
- [x] `npm run tauri dev` comprobado por el mantenedor (arranque y UI sin errores).
- [x] `node scripts/sync-version.mjs` sin diferencias posteriores.

## 3. Bump y documentación

- [x] `VERSION` = `0.10.2`.
- [x] Sincronizados: `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`,
  `Cargo.lock`, `snapcraft.yaml`, metainfo de Flatpak (Android no inicializado).
- [x] README y README.es: badge y texto de versión actual.
- [x] `docs/releases/v0.10.2.md`: notas de release.
- [x] `docs/VERSIONING.md`: fila Android, cinco claves de `latest.json` y ejemplo actual.
- [x] `docs/Estructure.md`: versión indexada 0.10.2.
- [x] `CHECKLIST_CONTINUACION.md`: sección 0.10.1 marcada y sección 0.10.2 añadida.

## 4. Release y workflows

- [x] Commit en `main`: `2d0d673 release: 0.10.2 — Estructure, skills y autor wulflo`.
- [x] Push a `main` → CI (`ci.yml`):
  https://github.com/wulflo/BetterTracker/actions/runs/45597547497
- [x] Tag `v0.10.2` pusheado → `release.yml` (CI + builds + manifiestos + publicación):
  https://github.com/wulflo/BetterTracker/actions/runs/45597576587
- [x] `package-linux.yml` lanzado a mano (`workflow_dispatch`, `publish: false`, `channel: beta`):
  https://github.com/wulflo/BetterTracker/actions/runs/45597625676
- [x] `store-msix.yml` lanzado a mano (`workflow_dispatch`):
  https://github.com/wulflo/BetterTracker/actions/runs/45597632607
- [x] Sin `gh run watch`; solo se reportan las URLs de las ejecuciones.
- Nota: el push a `main` avisó de 1 alerta de seguridad moderada en Dependabot
  (https://github.com/wulflo/BetterTracker/security/dependabot/16).

## 5. Corrección del primer intento

El CI y el Release del primer intento fallaron en `cargo-deny` por dos avisos:
`RUSTSEC-2026-0592` (`url` 2.5.8) y `RUSTSEC-2026-0594` (`cookie` 0.18.2).
No era un fallo del código de la app.

- [x] `cargo update -p url --precise 2.5.9` y `cargo update -p cookie --precise 0.18.3`.
- [x] `cargo deny check`: `advisories ok, bans ok, licenses ok, sources ok`.
- [x] Commit `69f4a3b fix(deps): update url and cookie to advisory-fixed versions`.
- [x] Tag `v0.10.2` reubicado de `2d0d673` a `69f4a3b` (force push; el release
  anterior falló antes de publicar, así que no se publicó nada con el tag viejo).
- [x] CI relanzado por el push: https://github.com/wulflo/BetterTracker/actions/runs/45598966215
- [x] Las dos ejecuciones de Release creadas justo después del force-push del tag
  (`45598971841` y `45598972980`) desaparecieron al reubicar `v0.10.2` (HTTP 404), por lo
  que se lanzó una sola ejecución definitiva desde el tag ya corregido:
  https://github.com/wulflo/BetterTracker/actions/runs/45599732912

## Notas de continuación

- Repositorio: `/home/alonso/Documentos/Repositorios/BetterTracker`.
- Si el push falla por red: repetir `git push origin main` y `git push origin v0.10.2`;
  no rehacer el bump.
- Si el release falla por firma/secreto, el draft queda creado: corregir el secreto y
  relanzar el workflow con `gh workflow run release.yml -f tag=v0.10.2`.
