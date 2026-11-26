---
name: Guía de uso
description: Actualizar la documentación de usuario de Better Tracker cuando se añaden funciones o cambian ajustes, vistas, cálculos o flujos; usar al terminar una modificación visible para el usuario.
---

# Guía de uso — documentación del usuario

Propósito: que la guía describa **lo que la app hace ahora**, no una versión anterior.
Aplica cuando se añade una función, se cambia un ajuste (p. ej. modo de tema, idioma,
bóveda o parámetros de proyección), se renombra una etiqueta o se modifica un flujo visible.

## Checklist obligatorio

1. **Identificar el cambio visible**
   - ¿Nueva vista/pestaña? ¿Nuevo ajuste? ¿Cambió una etiqueta, una unidad o el
     comportamiento de un botón? ¿Se eliminó una opción? Anotarlo antes de tocar la guía.

2. **Actualizar ambas guías**
   - `docs/USAGE.md` (español) y `docs/USAGE.en.md` (inglés) en paralelo.
   - Mantener el mismo orden de secciones y el mismo nivel de detalle en ambos idiomas.
   - Si el texto afecta a cálculos (energía, grasa corporal, proyección, carga semanal),
     revisar que los ejemplos y las unidades coincidan con el código.

3. **Qué documentar**
   - **Panel:** qué métricas se muestran, de dónde salen y cómo se interpretan.
   - **Entrenamiento e historial:** cómo registrar series, ver el historial y borrar o
     editar eventos; formatos de fecha y unidades.
   - **Figura corporal:** método de composición, peso, medidas, silueta, proyección,
     intervalo de predicción y desglose del gasto diario.
   - **Nutrición y hábitos:** comidas, agua, macros, recetas y constantes diarias.
   - **Ajustes y bóveda:** idioma, tema/acento, ruta de la bóveda, exportación,
     actualizaciones y comportamiento append-only de los datos automáticos.
   - **Preguntas frecuentes:** privacidad/local-first, sincronización y actualizaciones.

4. **No duplicar el índice técnico**
   - Las rutas de código, comandos Tauri y claves de almacenamiento van en
     `docs/Estructure.md` (skill `Estructure`), no en la guía de uso.
   - La guía responde a «¿cómo se usa?»; el índice a «¿dónde está?».

5. **Verificación final**
   - `npx tsc --noEmit` y `npm test` si el cambio también tocó código.
   - Leer el diff de la guía: sin instrucciones obsoletas (p. ej. un rango de
     proyección que ya no es el que calcula la app).

## Referencias rápidas

| Qué | Dónde |
| :--- | :--- |
| Guía ES | `docs/USAGE.md` |
| Guía EN | `docs/USAGE.en.md` |
| Visión general y atajos | `README.md`, `README.es.md` |
| Índice técnico | `docs/Estructure.md` |
| Historial de versiones | `docs/releases/`, `docs/AVANCES.md` |
