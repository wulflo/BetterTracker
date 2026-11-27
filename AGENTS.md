# Instrucciones para agentes — Better Tracker

**Regla obligatoria:** antes de editar cualquier archivo de este proyecto, leer
`docs/Estructure.md` y seguir el protocolo de `.agents/skills/estructure/SKILL.md`.

1. Usar el mapa de `docs/Estructure.md` para localizar el símbolo por **nombre**
   (los números de línea son aproximados) y confirmarlo con `grep` en el código.
2. Después de cada cambio, actualizar **solo** las secciones y filas afectadas de
   `docs/Estructure.md`, conservando el formato de tablas y las líneas aproximadas.
3. Cargar además la skill de dominio que corresponda: `boveda-android-saf` y
   `android-review` para bóveda/Android, `estilo-ui` y `critica-visual` para
   interfaz, `guia-de-uso` para cambios visibles al usuario.
4. No borrar ni compactar datos del usuario (`omega/`, `longlife/`).
