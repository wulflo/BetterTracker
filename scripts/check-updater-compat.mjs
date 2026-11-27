#!/usr/bin/env node
// Verifica que `latest.json` siga siendo consumible por TODOS los clientes
// Android publicados, no solo por el más reciente.
//
// Los clientes hasta 0.10.4 validaban `signature` con /^[A-Za-z0-9+/=\s]+$/,
// que exige al menos un carácter. Cuando el generador publicó `signature: ""`
// en `android-aarch64`, esos clientes mostraban «El manifiesto incluye una
// firma no válida para una APK de Android» y nunca descargaban la APK.
// Android no usa minisign: el actualizador comprueba el SHA-256 publicado y el
// sistema verifica la firma del APK al instalar.
//
// Uso: node scripts/check-updater-compat.mjs [latest.json]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] ?? 'latest.json');
const REPO_PREFIX = 'https://github.com/wulflo/BetterTracker/releases/';
const REQUIRED_PLATFORMS = [
  'linux-x86_64',
  'linux-deb-x86_64',
  'linux-rpm-x86_64',
  'windows-x86_64',
  'android-aarch64',
];
const OLD_CLIENT_SIGNATURE = /^[A-Za-z0-9+/=\s]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

let manifest;
try {
  manifest = JSON.parse(readFileSync(target, 'utf8'));
} catch (error) {
  console.error(`No se pudo leer ${target} como JSON: ${error.message}`);
  process.exit(1);
}

const errors = [];
const error = (message) => errors.push(message);

if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  error('/: el manifiesto debe ser un objeto JSON');
} else {
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    error('/version: se espera SemVer estricto X.Y.Z');
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    error('/platforms: falta el objeto de plataformas');
  } else {
    for (const key of REQUIRED_PLATFORMS) {
      if (!platforms[key]) error(`/platforms/${key}: falta esta plataforma`);
    }
    for (const [key, entry] of Object.entries(platforms)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        error(`/platforms/${key}: entrada no válida`);
        continue;
      }
      // El plugin de escritorio deserializa todas las entradas con `signature`.
      if (
        typeof entry.signature !== 'string' ||
        !entry.signature.trim() ||
        !OLD_CLIENT_SIGNATURE.test(entry.signature)
      ) {
        error(
          `/platforms/${key}/signature: vacía o no base64. Rompe el updater de escritorio y, en Android, la comprobación de los clientes ≤0.10.4`,
        );
      }
    }

    const android = platforms['android-aarch64'];
    if (android) {
      if (typeof android.url !== 'string' || !android.url.startsWith(REPO_PREFIX)) {
        error('/platforms/android-aarch64/url: no pertenece a las releases oficiales');
      }
      if (typeof android.sha256 !== 'string' || !SHA256_HEX.test(android.sha256)) {
        error('/platforms/android-aarch64/sha256: se esperan 64 hexadecimales en minúsculas');
      }
      if (!Number.isSafeInteger(android.size) || android.size <= 0) {
        error('/platforms/android-aarch64/size: tamaño positivo obligatorio');
      }
    }
  }
}

if (errors.length) {
  console.error('Compatibilidad del updater FALLIDA:');
  for (const message of errors) console.error(`  ${message}`);
  process.exit(1);
}
console.log(
  `Compatibilidad del updater OK (${manifest.version}, ${REQUIRED_PLATFORMS.length} plataformas, ` +
    'firma no vacía en todas las entradas)',
);
