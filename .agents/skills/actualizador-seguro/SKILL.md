---
name: Actualizador seguro
description: Verificar que la configuración de actualizaciones de Better Tracker siga siendo compatible con todos los clientes publicados (especialmente Android ≤0.10.4: el campo `signature` del manifiesto debe ser no vacío y el cliente debe aceptar firmas vacías antiguas); usar antes de publicar una release, al tocar `updater.ts`, `generate-updater-manifest.mjs`, `validate-manifest.mjs`, `release.yml`, `VERSION` o al investigar errores de «Buscar actualizaciones».
---

# Actualizador seguro — compatibilidad del manifiesto y de las claves

Propósito: impedir que un cambio aparentemente inocuo vuelva a romper la
actualización de los dispositivos ya instalados. **El actualizador no se prueba
solo con el cliente nuevo**: tiene que seguir funcionando con todos los que hay
en la calle.

> Antecedente real: hasta 0.10.4 el generador publicaba `signature: ""` en
> `android-aarch64`. El cliente de 0.10.2 validaba ese campo con
> `/^[A-Za-z0-9+/=\s]+$/`, cuyo `+` exige al menos un carácter, y mostraba
> «El manifiesto incluye una firma no válida para una APK de Android» antes de
> descargar nada. 0.10.5 corrigió **el generador y el cliente a la vez**. Un
> cambio en solo uno de los dos vuelve a romper la cadena.

---

## 1. Regla de compatibilidad

| Lado | Obligación |
| :--- | :--- |
| `latest.json` publicado | Toda entrada, incluida `android-aarch64`, lleva `signature` como string **no vacío** y base64 (`/^[A-Za-z0-9+/=\s]+$/`). La de Android es el SHA-256 de la APK, no minisign. |
| Cliente Android nuevo | `validateAsset` (`src/updater.ts`) trata `signature` vacía/`null`/ausente como «sin firma» y sigue rechazando valores no vacíos que no sean base64. Así acepta los manifests antiguos ya publicados. |
| Validación de CI | `validate-manifest.mjs` exige minisign real solo para `.deb`/`.rpm`; **nunca** para `android-aarch64`. |
| Firma | El keystore Android y la clave pública del updater no se rotan en una release de corrección. Rotar el keystore obliga a desinstalar; rotar el updater exige una release intermedia (ver `docs/RELEASE_SECRETS.md`). |

Si editas uno de estos cuatro lados, revisa los otros tres en el mismo diff.

---

## 2. Checklist antes de publicar

### 2.1 Manifiesto y código

- [ ] `scripts/generate-updater-manifest.mjs` no contiene `signature: ''` ni
      `signature: null` en `android-aarch64`; escribe el SHA-256 calculado de la APK.
- [ ] El bucle de plataformas sigue publicando las cinco claves obligatorias:
      `linux-x86_64`, `linux-deb-x86_64`, `linux-rpm-x86_64`, `windows-x86_64`,
      `android-aarch64` (`--require-all`).
- [ ] `src/updater.ts` → `validateAsset`: la rama de firma distingue
      `undefined`/`null`/string vacío de un valor inválido; hay un test en
      `src/updater.test.ts` con `signature: ''` que documenta el manifest antiguo.
- [ ] `scripts/validate-manifest.mjs` no exige firma minisign para Android.
- [ ] `.github/workflows/release.yml` ejecuta `scripts/check-updater-compat.mjs latest.json`
      justo después de generar y validar el manifiesto.
- [ ] `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` sigue siendo la clave
      pública documentada en `docs/KEYSTORES.md` (no la regeneres «por limpieza»).

### 2.2 Versión e identidad

- [ ] `VERSION` es SemVer estricto y `node scripts/sync-version.mjs` termina sin
      `MISMATCH`; `git diff` confirma que package.json, lockfiles, `tauri.conf.json`,
      Cargo, snapcraft, Flatpak y Android están alineados.
- [ ] `node scripts/sync-version.mjs --print-version-code` da un número **mayor**
      que el del release instalado (`major·1.000.000 + minor·1.000 + patch`).
- [ ] El release usa los GitHub Secrets `ANDROID_KEYSTORE_*` existentes; el
      workflow `verify-signing.sh` imprime el fingerprint `37:39:6F:...`. Si
      aparece otro certificado, **para**: rompería la continuidad de actualización.
- [ ] Existen notas en `docs/releases/vX.Y.Z.md`.

### 2.3 Comprobación ejecutable

```bash
# Manifiesto generado en local (assets de prueba o los del release):
node scripts/generate-updater-manifest.mjs assets latest.json "v$(cat VERSION)" "$(cat VERSION)" wulflo/BetterTracker --require-all
node scripts/validate-manifest.mjs latest.json
node scripts/check-updater-compat.mjs latest.json

# Manifiesto ya publicado (el que de verdad ve el móvil):
curl -fsSL https://github.com/wulflo/BetterTracker/releases/latest/download/latest.json -o /tmp/latest.json
node scripts/check-updater-compat.mjs /tmp/latest.json
```

`check-updater-compat.mjs` falla si falta una plataforma, si la URL no es de
estas releases, si el SHA-256 o el tamaño son inválidos o si **algún** `signature`
está vacío/no es base64. Es la guardia que debería haber existido antes de 0.10.5.

---

## 3. Errores conocidos y qué significan

| Síntoma en el móvil | Causa probable | Dónde mirar |
| :--- | :--- | :--- |
| «El manifiesto incluye una firma no válida para una APK de Android» | `signature: ""` en `android-aarch64` y cliente ≤0.10.4 | generador + `validateAsset` |
| «La release no incluye una APK para este dispositivo» | Falta `android-aarch64` en `latest.json` | generador, `--require-all` |
| «La URL no pertenece a las releases oficiales» | URL no HTTPS o no empieza por `https://github.com/wulflo/BetterTracker/releases/` | `validateAsset`, `assetUrl()` |
| «La huella SHA-256 no coincide» | APK servida distinta de la del manifest; descarte y no instale | `download_android_apk` en `commands.rs` |
| El instalador de Android dice «la app no está instalada» | Keystore distinto (rotación de clave) | `docs/KEYSTORES.md`, Secrets `ANDROID_*` |
| El actualizador de escritorio no reconoce la versión | `signature` ausente en alguna entrada o pubkey cambiada | `tauri.conf.json`, generador |

---

## 4. Qué NO hacer

- No «arregles» el error de firma de Android quitando la validación de SHA-256:
  es la única integridad que tiene la descarga manual.
- No pongas una firma minisign real en `android-aarch64` «para que sea más seguro»:
  Android no la verifica y los clientes antiguos solo comprobaban el formato.
- No elimines el campo `signature` del manifest: el updater de escritorio
  deserializa todas las entradas con ese campo obligatorio.
- No borres ni reemplaces `latest.json` publicado a mano; regenera desde el
  workflow con `--require-all` y valida antes de subirlo.
- No pruebes solo «con la última versión instalada». Si el cambio afecta al
  manifiesto, comprueba siempre que un cliente anterior sigue pasando
  `check-updater-compat.mjs`.

Al terminar, deja una línea de estado: **compatibilidad del updater verificada
(clientes antiguos y nuevos)** o **pendiente de verificar**, según corresponda.
