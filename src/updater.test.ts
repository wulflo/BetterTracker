import { describe, expect, it } from 'vitest';
import { isNewerVersion, updaterUnavailableReason, validateAsset } from './updater';

describe('detección de versiones', () => {
  it('detecta la actualización de 0.9.3 a 0.9.4', () => {
    expect(isNewerVersion('0.9.4', '0.9.3')).toBe(true);
    expect(isNewerVersion('0.9.3', '0.9.4')).toBe(false);
  });

  it('compara componentes numéricos, no cadenas', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.9.10', '0.9.9')).toBe(true);
  });

  it('ignora prefijos v y sufijos de revisión', () => {
    expect(isNewerVersion('v0.9.4', '0.9.3')).toBe(true);
    expect(isNewerVersion('0.9.4-1', '0.9.4')).toBe(false);
    expect(isNewerVersion('0.9.4+linux', '0.9.4')).toBe(false);
  });

  it('trata versiones incompletas como ceros', () => {
    expect(isNewerVersion('1', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.9', '0.9.0')).toBe(false);
  });
});

describe('actualizaciones gestionadas por la tienda', () => {
  it('explica que MSIX se actualiza desde Microsoft Store', () => {
    expect(updaterUnavailableReason('msix', 'es')).toContain('Microsoft Store');
    expect(updaterUnavailableReason('msix', 'en')).toContain('Microsoft Store');
  });
});

describe('validación del manifiesto de actualizaciones', () => {
  const apk = {
    url: 'https://github.com/wulflo/BetterTracker/releases/download/v0.10.4/app.apk',
    sha256: 'a'.repeat(64),
    size: 12_345,
  };

  it('acepta la firma vacía que publica la release para la APK', () => {
    // Hasta 0.10.4 el generador publicaba `signature: ""` en android-aarch64
    // porque el updater de escritorio exige ese campo; Android no usa minisign.
    // El cliente nuevo debe seguir aceptando esos manifests ya publicados.
    const asset = validateAsset({ ...apk, signature: '' }, 'una APK de Android');
    expect(asset.signature).toBeUndefined();
    expect(asset.sha256).toBe(apk.sha256);
  });

  it('acepta firma ausente o nula como «sin firma»', () => {
    expect(validateAsset(apk, 'una APK de Android').signature).toBeUndefined();
    expect(validateAsset({ ...apk, signature: null }, 'una APK de Android').signature).toBeUndefined();
    expect(validateAsset({ ...apk, signature: '   ' }, 'una APK de Android').signature).toBeUndefined();
  });

  it('conserva una firma base64 válida', () => {
    expect(validateAsset({ ...apk, signature: 'RUQHQUJDREVGRw==\n' }, 'un paquete').signature).toBe(
      'RUQHQUJDREVGRw==',
    );
  });

  it('rechaza firmas con caracteres que no son base64', () => {
    expect(() => validateAsset({ ...apk, signature: 'firma: no válida' }, 'una APK de Android')).toThrow(
      /firma no válida/,
    );
    expect(() => validateAsset({ ...apk, signature: 'abc-def_' }, 'una APK de Android')).toThrow(
      /firma no válida/,
    );
  });
});
