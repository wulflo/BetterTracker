---
name: Saneado de texto
description: Revisar y proponer el saneado de lo que se pega o escribe en campos de texto de Better Tracker (nombres, notas, descripciones de ejercicios, URLs), evitando HTML, archivos, saltos indebidos y texto excesivo; usar al añadir campos de texto o al revisar diffs que toquen inputs, textareas o inputGuard.ts.
---

# Saneado de texto — pegado y escritura seguros

Propósito: que cualquier texto que el usuario pegue o escriba llegue al estado de
React y a la bóveda **como texto plano, acotado y coherente con su campo**.
**Revisa y reporta**; no cambies código salvo petición explícita.

> La defensa actual ya está en `src/inputGuard.ts`. Esta skill complementa a
> `Traducciones UI` (etiquetas) y a `Higiene de archivos` (datos persistentes).

---

## 1. Qué hace hoy `inputGuard.ts`

- `installInputGuard()` (17) intercepta `paste` en fase de captura:
  - solo lee `clipboardData.getData('text/plain')` (descarta HTML rico, archivos e imágenes);
  - en `<input>` de una línea colapsa `\r?\n` a un espacio (25–27);
  - inserta el texto con el *native setter* y dispara `input` para que React lo vea (31–36);
  - fuera de campos de texto, `preventDefault()` (37–39).
- Bloquea `drop`, `dragover` y el menú contextual dentro de campos (42–47).
- `hardenField` (3–10) desactiva autocompletado, autocorrección, autocapitalización
  y spellcheck; un `MutationObserver` (49–58) aplica esto a campos creados por React.

**Regla:** cualquier campo nuevo queda cubierto automáticamente por el guardián global;
no hace falta duplicar el listener en el componente.

---

## 2. Checklist de revisión

### 2.1 Entrada

- [ ] ¿El campo es `<input>` / `<textarea>` de React controlado por `value`/`onChange`?
      Si es `contentEditable`, el guardián global **no** lo cubre: hay que saneado explícito.
- [ ] ¿Los saltos de línea solo se permiten en `<textarea>`? En `input` se colapsan.
- [ ] ¿Se limita la longitud con `maxLength` y se recorta también al guardar
      (un pegado enorme no debe inflar el evento de la bóveda)?
- [ ] ¿Se elimina o se normaliza el contenido de control (NUL, caracteres de dirección
      RTL/LTR invisibles, `\u200b`) que pueda romper la visualización?
- [ ] ¿Los espacios se recortan con `.trim()` antes de persistir, sin destruir
      intencionalmente sangrías en descripciones largas?

### 2.2 Tipos de campo

| Campo | Saneado esperado |
| :--- | :--- |
| Nombre de ejercicio / rutina / alimento | `trim`, una sola línea, `maxLength` razonable, sin etiquetas. |
| Notas y descripciones | `trim`, texto plano, `maxLength` (p. ej. 160 en notas, 2000 en descripciones), saltos permitidos. |
| URL de vídeo | solo HTTPS, host de allowlist (YouTube/youtu.be/Vimeo), sin `..`, sin espacios; validar en TS y en Rust. |
| Números | `input type="number"` + `Number.isFinite` + clamp; nunca `parseInt` de texto arbitrario. |
| Fechas | `YYYY-MM-DD` validado; nunca concatenar texto del usuario. |

### 2.3 Persistencia y lectura

- [ ] ¿El reductor correspondiente sanea el campo al leer eventos antiguos o
      manipulados (patrón `wellness.ts:54-78`: `note: raw.note ? String(raw.note) : ''`)?
- [ ] ¿Se evita `innerHTML`, `dangerouslySetInnerHTML` o inserción de markup en la UI?
      Todo se renderiza como texto de React.
- [ ] ¿Los enlaces se abren con `openExternal` (`links.ts`), nunca con `window.open`
      directo en la app nativa? La whitelist de Rust (`commands.rs`) es la última barrera.
- [ ] ¿El texto saneado no cambia el idioma de la interfaz: etiquetas con `tx()`/`t()`,
      contenido del usuario tal cual (ver skill `Traducciones UI`)?

### 2.4 Verificación

- [ ] Probar pegado de: texto con salto de línea en `input`, HTML (`<b>x</b>`),
      un archivo, una imagen y un texto de 10 000 caracteres.
- [ ] Comprobar que `React onChange` ve el valor pegado (el *native setter* del guardián).
- [ ] Verificar que el evento guardado en la bóveda contiene solo texto plano y
      que al recargar la app se muestra igual.
- [ ] `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` y `npm test`.

---

## 3. Formato del informe

| Campo | Riesgo | Evidencia (`archivo:línea`) | Propuesta |
| :--- | :--- | :--- | :--- |

Separa **bloqueante** (HTML/markup, URL arbitraria, desbordamiento de longitud) de
**mejora** (normalización de espacios, recorte, mensajes de error traducidos).

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Guardián global de pegado/drop | `src/inputGuard.ts` |
| Arranque del guardián | `src/main.tsx` (`boot`) |
| Campos compartidos | `src/components/Fields.tsx` (`Field`, `NumberInput`) |
| Saneado al leer eventos | `src/wellness.ts` (`reduceHabits`), `src/metrics.ts` (`reduceExercises`) |
| Enlaces seguros | `src/links.ts`, `src-tauri/src/commands.rs` (`validate_external_url`) |
| Etiquetas bilingües | `src/i18n.tsx`, skill `Traducciones UI` |
