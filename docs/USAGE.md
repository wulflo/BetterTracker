# Guía de uso — Better Fitness Tracker

Esta guía documenta la interfaz y los datos nuevos de la proyección dinámica, la composición militar y el motor de composición corporal. Todo es orientativo y no sustituye una valoración médica.

## Idioma

La app se instala en **inglés** por defecto; se puede cambiar a español desde **Ajustes → Apariencia → Idioma**. El idioma elegido se guarda y sigue a la app en los futuros arranques.

## Ajustes

El diálogo **Ajustes** se organiza en pestañas horizontales; la última pestaña usada se recuerda en el próximo arranque. Se puede cambiar de pestaña con el ratón o con las flechas izquierda/derecha del teclado.

- **Apariencia**: tema claro/oscuro, color de acento, **tamaño de texto** (100/110/120/130/150 %) e idioma; además, el formato instalado y el recordatorio de dónde se introduce el código de barras.
- **Bóveda**: ruta de la bóveda, datos de la app, dispositivo, **tu nombre** (saludo de la cabecera), aviso de privacidad/red, aviso de modo navegador y carga de datos de ejemplo (solo en el navegador).
- **Copias**: estado y tamaño de las copias `longlife`, creación de la copia del día, restauración no destructiva de eventos que falten y borrado de copias (irreversible).
- **Actualizaciones**: comprobación manual e instalación opcional.
- **Acerca de**: versión, commit, fecha de build, esquema de bóveda, número de eventos y enlaces al repositorio y a la política de privacidad.

Desde el pie del diálogo se puede cambiar de bóveda.

Al seleccionar la bóveda por primera vez se ofrece un campo opcional **Tu nombre**. Si se rellena, se guarda como evento `profile.saved` en esa bóveda y la cabecera muestra «Hola, *nombre*»; si se deja vacío aparece el aviso «Datos locales · sin cuentas · sin telemetría». El nombre también se puede introducir o cambiar después en **Ajustes → Bóveda → Tu nombre**.

## Biblioteca de ejercicios — descripciones

En **Entrenamiento → Biblioteca**, cada ejercicio puede llevar una **descripción** (hasta 2000 caracteres) con instrucciones, recomendaciones, series/reps sugeridas o errores comunes, y un **enlace a un vídeo explicativo** (HTTPS de YouTube, youtu.be o Vimeo). Ambos campos son opcionales y se guardan con el ejercicio, por lo que sobreviven a renombrados y se sincronizan entre dispositivos como cualquier otro evento de la bóveda.

- Al añadir o editar un ejercicio (botón de lápiz), rellena la descripción y/o el enlace; el botón «Ver vídeo» abre el enlace en el navegador del sistema.
- El buscador de la biblioteca también encuentra ejercicios por el texto de su descripción.
- Los ejercicios creados antes de esta versión siguen funcionando: simplemente no tienen descripción hasta que la añadas.

## Alimentación — búsqueda de alimentos

Hay un **único cuadro de búsqueda**: si escribes un nombre busca en tu base de datos local y, con un pequeño retardo, en Open Food Facts por palabras clave; si escribes o pegas 6–14 dígitos (o usas un lector que termina en Enter) lo trata como código de barras y consulta el catálogo local y Open Food Facts. Los resultados muestran su origen y kcal/macros por 100 g. Pulsar un resultado lo selecciona para ajustar la porción; el botón **+** lo añade a la comida activa. Los productos de la nube se guardan como alimentos propios para usarlos sin red.

## Figura corporal — Proyección

La tarjeta **Rango seguro y progreso proyectado** muestra ahora siempre y sin colapsar los controles de proyección:

- **Nivel de actividad física**: `Automático` (deduce el PAL de los minutos de entrenamiento de los últimos 7 días), o un nivel fijo: Sedentario, Ligero, Moderado, Alto, Muy alto. Al cambiarlo, el evento `activity.level` se guarda en la bóveda y la proyección se actualiza de inmediato.
- **Pasos promedio al día**: actúan como suelo del NEAT — `máx((PAL − 1) × BMR, (pasos/1000) × 0,45 × peso)` kcal/día. No se suman al PAL porque el PAL ya incluye caminar. Sin escalones: 6200 y 7800 pasos generan gastos distintos y proporcionales.
- **Calorías promedio que consumes**: la ingesta media del balance (TEF incluido). El botón **Usar media registrada** aparece cuando hay al menos 3 días de registros recientes.
- **Ritmo/frecuencia de entrenamiento**: sesiones por semana o por mes; combinada con la observada en los últimos 30 días (se usa la mayor).

### Desglose del gasto diario

- **BMR dinámico**: promedio ponderado Katch-McArdle/Cunningham + Mifflin-St Jeor, recalculado con la masa magra y grasa simuladas.
- El BMR usa ecuaciones específicas fuera de la edad adulta: Schofield (10–17 años) y Porter 2023 (≥65). Entremedias se mantiene Katch-McArdle/Cunningham. La edad también modera suavemente la pérdida/ganancia de masa magra y el ritmo seguro.
- **TEF**: `10 %` de la ingesta media.
- **NEAT (pasos + actividad base)**: factor base no deportivo por nivel de actividad (`sedentary: 1,15`, `light: 1,22`, `moderate: 1,30`, `high: 1,38`, `very_high: 1,46`, `auto: 1,20`) × BMR dinámico + gasto de caminar.
- **EAT entreno**: `sesiones/sem ÷ 7 × min/sesión × MET × W(t)` (≈4,5 MET en fuerza, ≈6,5 en cardio/mixto).
- **Adaptación metabólica (AT)**: termogénesis adaptativa exponencial (α ≈ 11 % del desbalance, τ = 18 días).
- **TDEE total**: `BMR + TEF + NEAT + EAT − AT`.

### Intervalo de predicción

La curva de peso y los hitos se presentan dentro de un **intervalo de predicción del 90 %** (percentiles 5–95 literalmente) calculado con 81 escenarios Monte Carlo deterministas: desviaciones acotadas de BMR, NEAT, ingesta (según su origen), adaptación, partición y agua. `weightLow`/`weightHigh` y los rangos de los hitos son esos percentiles, no se ensanchan con el valor central. Los escenarios que no alcanzan un hito se cuentan aparte y no se muestran como llegadas lejanas; el valor central sigue siendo la estimación más probable.

### Evolución proyectada de composición

Debajo de la proyección, una pequeña curva muestra la evolución proyectada de la **masa grasa, la masa magra y el FFMI** a lo largo de la simulación (cada 7 días), desde el estado inicial hasta el objetivo.

## Composición corporal (métodos + militares)

La sección **Composición** combina las ecuaciones civiles (Navy/Air Force, RFM, Deurenberg, CUN-BAE, Ejército Vogel, Marines Wright, Friedl) con las ecuaciones militares modernas:

- **Fuerza Aérea de EE. UU. — hombres (Fuchs et al., 1978)**: FFM desde el bíceps flexionado.
- **Fuerza Aérea de EE. UU. — mujeres (Brennen et al., 1979)**: FFM desde el antebrazo.
- **Boer (1984)**: FFM desde peso y altura.

El consenso es una media ponderada por varianza inversa (`w_base = (1/SEE²)·(1 + 0,05·max(0, inputs − 2))`), con una mediana ponderada inicial, desviación estándar robusta (MAD × 1,4826, suelo del 1,5 % de la mediana) y amortiguación tipo Huber (`h_i = min(1, 1,5σ/|v_i − mediana|)`); ecuaciones atípicas se reducen su peso sin desaparecer del desglose.

### Indicadores militares (DoDI 1308.03 / USARIEM)

- **FFMI**: `leanMass / (altura/100)²`; **FFMI normalizado**: `FFMI + 6,1·(1,8 − altura/100)`.
- **Rango operativo USARIEM**: hombres 18,1–23,0 kg/m² (reserva magra baja ≤ 17,7, hipertrofia alta > 23,0); mujeres 15,5–18,3 (≤ 14,5, > 18,3).
- **Estándar DoDI 1308.03**: razón cintura/altura (óptimo < 0,50) + límite de % grasa por sexo (18–26 % hombres, 26–36 % mujeres). El grupo de edad se muestra, pero no cambia el límite.
- **Aviso de masa muscular**: aparece cuando el IMC ≥ 25 pero `whtr < 0,50` y el % grasa está dentro del estándar militar (la masa muscular reduce el IMC medido).

## Proyección de peso

La proyección es un integrador fisiológico diario de dos compartimentos (Hall/Forbes + termogénesis adaptativa):

- Estado inicial de grasa y magra desde `bodyComposition`.
- Partición grasa/magra siguiendo la curva de Forbes (`10,4/(F + 10,4)`), modulada por la fuerza: en déficit, la fracción magra se acota al 5–40 % y con fuerza ≥12 sesiones/mes baja hasta ≈5–10 %; en superávit, la ganancia de magra escala con el estímulo de fuerza.
- Termogénesis adaptativa exponencial (α ≈ 11 % del desbalance, τ = 18 días).
- Transitorio de glucógeno/agua (±1,8 kg) distinguiendo peso en báscula vs. peso de tejido.
- Intervalo de predicción del 90 % (percentiles 5–95) con Monte Carlo sobre BMR, PAL, ingesta, adaptación, partición y agua.

## Figura corporal — Silueta

Figura corporal se organiza en pestañas: **Medidas** (formulario y registro rápido de peso), **Composición** (indicadores, silueta y consenso de ecuaciones) y **Proyección** (tendencia y simulación).

**Alimentación** tiene tres pestañas: **Ingesta** (macros, FoodLog y activación del registro automático), **Agua** (contador, objetivo y límites) y **Recetas** (50 platos, botón «Rotar recetas» para ver otros tres y etiquetas de alérgenos). Todas las recetas son sin gluten ni frutos secos; cuando llevan lácteos, huevo, soja, pescado, marisco o sésamo se indican como alérgenos. Ya no hay pestañas Resumen ni Recordatorios: los recordatorios están en Hábitos.

El formulario de medidas: peso, altura, edad, sexo, cuello, pecho, cintura, abdomen, cadera, bíceps/antebrazo, muslo, pantorrilla y muñeca. Los campos se comportan como datos ausentes, no como cero.

La silueta adaptable **sigue el sexo ya seleccionado en el formulario de medidas** (no hay un segundo selector) y ajusta su forma a las circunferencias registradas. Es solo ilustrativa: no tiene nodos arrastrables; las medidas se introducen en centímetros en el formulario. Si el sexo no está especificado, usa rangos neutros y lo indica.

## Actualizaciones

Comprobación manual desde **Ajustes → Actualizaciones**. No hay chequeo automático en segundo plano.

## Preguntas frecuentes

- **¿Para qué sirven los pasos?** Aportan un suelo de NEAT: 6200 y 7800 pasos generan gastos distintos y proporcionales. **No se suman** al PAL, porque el PAL ya incluye caminar.
- **¿Qué pasa si mi IMC es alto pero tengo músculo?** El sistema muestra el aviso de masa muscular (`muscularOverride`) cuando whtr es óptimo y el % grasa está dentro del estándar militar.

## Datos automáticos (eventos append-only)

`activity.level`, `steps.average`, `training.frequency`, `intake.average`, `measurement.saved`, `weight.logged`, `session.saved`, `workout.saved`, `pr.achieved` — la proyección se actualiza según lo guardado.

## Hábitos y registro automático de ingesta

Los hábitos se clasifican como **saludables**, **fuertes**, **adicciones** o **malos**. Los adictivos y malos restan puntos cuando se registran como hechos, y «no hacerlos» cuenta como cumplimiento; las pestañas **Todos / Fuertes / Adicciones y malos** filtran la lista. Los recordatorios viven aquí.

En **Alimentación → Ingesta** puedes activar **Registrar ingesta de hoy**: guarda automáticamente los macros del día cada vez que cambian. Si hay al menos **5 días activos en los últimos 30**, Historial muestra la media y **Figura corporal** usa esa media en lugar de la ingesta manual para la proyección.

En **Historial → Nutrición** puedes **registrar fechas pasadas**, **corregir las calorías** de un día y **cancelar o reactivar** el registro de cualquier día de los últimos 30. Como los eventos son append-only, el último registro de cada fecha es el que cuenta.
