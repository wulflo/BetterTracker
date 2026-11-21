# Guía de uso — Better Fitness Tracker

Esta guía documenta la interfaz y los datos nuevos de la proyección dinámica, la composición militar y el motor de composición corporal. Todo es orientativo y no sustituye una valoración médica.

## Idioma

La app se instala en **inglés** por defecto; se puede cambiar a español desde **Ajustes → Idioma**. El idioma elegido se guarda y sigue a la app en los futuros arranques.

## Figura corporal — Proyección

La tarjeta **Rango seguro y progreso proyectado** muestra ahora siempre y sin colapsar los controles de proyección:

- **Nivel de actividad física**: `Automático` (deduce el PAL de los minutos de entrenamiento de los últimos 7 días), o un nivel fijo: Sedentario, Ligero, Moderado, Alto, Muy alto. Al cambiarlo, el evento `activity.level` se guarda en la bóveda y la proyección se actualiza de inmediato.
- **Pasos promedio al día**: aportan NEAT adicional — `(pasos/1000) × 0,045 × peso` kcal/día. Sin escalones: 6200 y 7800 pasos generan gastos distintos y proporcionales.
- **Calorías promedio que consumes**: la ingesta media del balance (TEF incluido). El botón **Usar media registrada** aparece cuando hay al menos 3 días de registros recientes.
- **Ritmo/frecuencia de entrenamiento**: sesiones por semana o por mes; combinada con la observada en los últimos 30 días (se usa la mayor).

### Desglose del gasto diario

- **BMR dinámico**: promedio ponderado Katch-McArdle/Cunningham + Mifflin-St Jeor, recalculado con la masa magra y grasa simuladas.
- **TEF**: `10 %` de la ingesta media.
- **NEAT (pasos + actividad base)**: factor base no deportivo por nivel de actividad (`sedentary: 1,15`, `light: 1,22`, `moderate: 1,30`, `high: 1,38`, `very_high: 1,46`, `auto: 1,20`) × BMR dinámico + gasto de caminar.
- **EAT entreno**: `sesiones/sem ÷ 7 × min/sesión × MET × W(t)` (≈4,5 MET en fuerza, ≈6,5 en cardio/mixto).
- **Adaptación metabólica (AT)**: termogénesis adaptativa exponencial (α ≈ 11 % del desbalance, τ = 18 días).
- **TDEE total**: `BMR + TEF + NEAT + EAT − AT`.

### Banda de confianza

La curva de peso y los hitos se presentan dentro de una **banda de confianza (±8 %)**: se ejecutan las trayectorias límite de variabilidad metabólica y adherencia, y la app devuelve `weightLow`/`weightHigh` con hitos que incluyen rango realista y fechas de llegada con margen.

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
- **Estándar DoDI 1308.03**: razón cintura/altura (óptimo < 0,50) + límite de % grasa por grupo de edad (17–20, 21–27, 28–39, 40+) y sexo (18–26 % hombres, 26–36 % mujeres).
- **Aviso de masa muscular**: aparece cuando el IMC ≥ 25 pero `whtr < 0,50` y el % grasa está dentro del estándar militar (la masa muscular reduce el IMC medido).

## Proyección de peso

La proyección es un integrador fisiológico diario de dos compartimentos (Hall/Forbes + termogénesis adaptativa):

- Estado inicial de grasa y magra desde `bodyComposition`.
- Partición grasa/magra siguiendo la curva de Forbes (10,4/F), modulada por la fuerza: en déficit, fuerza ≥12 sesiones/mes reduce la pérdida magra hasta ≈5–10 %; en superávit, la ganancia de magra escala con el estímulo de fuerza.
- Termogénesis adaptativa exponencial (α ≈ 11 % del desbalance, τ = 18 días).
- Transitorio de glucógeno/agua (±1,8 kg) distinguiendo peso en báscula vs. peso de tejido.
- Banda de incertidumbre ±8 % de variabilidad metabólica y adherencia.

## Figura corporal — Silueta

El formulario de medidas: peso, altura, edad, sexo, cuello, pecho, cintura, abdomen, cadera, bíceps/antebrazo, muslo, pantorrilla y muñeca. Los campos se comportan como datos ausentes, no como cero.

## Actualizaciones

Comprobación manual desde Ajustes. No hay chequeo automático en segundo plano.

## Preguntas frecuentes

- **¿Para qué sirven los pasos?** Aportan NEAT: 6200 y 7800 pasos generan gastos distintos y proporcionales, y son aditivos al gasto del nivel de actividad.
- **¿Qué pasa si mi IMC es alto pero tengo músculo?** El sistema muestra el aviso de masa muscular (`muscularOverride`) cuando whtr es óptimo y el % grasa está dentro del estándar militar.

## Datos automáticos (eventos append-only)

`activity.level`, `steps.average`, `training.frequency`, `intake.average`, `measurement.saved`, `weight.logged`, `session.saved`, `workout.saved`, `pr.achieved` — la proyección se actualiza según lo guardado.
