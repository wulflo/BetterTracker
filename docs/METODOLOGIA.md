# Metodología

Todas las cifras son estimaciones orientativas. No son diagnóstico médico ni sustituyen una valoración profesional.

## Composición corporal

La app calcula todas las ecuaciones que tengan datos suficientes, las muestra por separado y las combina en un **consenso ponderado**. Es una referencia orientativa, no una medición de laboratorio.

### Métodos

Todas las medidas de longitud se usan en centímetros.

**Marina (Navy, Hodgdon & Beckett, 1984)**

- Hombres: `495 / (1.0324 − 0.19077·log10(cintura − cuello) + 0.15456·log10(altura)) − 450`.
- Mujeres: `495 / (1.29579 − 0.35004·log10(cintura + cadera − cuello) + 0.221·log10(altura)) − 450`.

Requiere sexo, altura, cuello y cintura; en mujeres también cadera. En hombres usa el abdomen al ombligo si está informado y, si no, la cintura.

**RFM (Relative Fat Mass, Woolcott & Bergman, 2018)**

- Hombres: `64 − 20·(altura / cintura)`.
- Mujeres: `76 − 20·(altura / cintura)`.

Solo necesita cintura y altura. Es útil cuando falta peso o cuello.

**Deurenberg (1991)**

`1.2·IMC + 0.23·edad − 10.8·sexo − 5.4`, con `sexo = 1` en hombres y `0` en mujeres.

**CUN-BAE (Gómez-Ambrosi et al., 2012)**

`−44.988 + 0.503·edad + 10.689·sexo + 3.172·IMC − 0.026·IMC² + 0.181·IMC·sexo − 0.020·IMC·edad − 0.005·IMC²·sexo + 0.00021·IMC²·edad`, con `sexo = 0` en hombres y `1` en mujeres.

**Ejército de EE. UU. (Vogel et al., 1988)**

- Hombres: `76.5·log10(abdomen − cuello) − 68.7·log10(altura) + 46.9`.
- Mujeres: `105.3·log10(peso) − 0.2·muñeca − 0.533·cuello − 1.574·antebrazo + 0.173·cadera − 0.515·altura − 35.6`, con el peso en kg.

La ecuación masculina usa el abdomen al ombligo (o la cintura si falta). La femenina necesita peso, muñeca, cuello, antebrazo, cadera y altura.

**Ejército actual, una medida (2023)**

- Hombres: `−26.97 − 0.12·peso_lb + 1.99·abdomen_pulg`.
- Mujeres: `−9.15 − 0.015·peso_lb + 1.27·abdomen_pulg`.

Solo necesita peso y abdomen al ombligo, convertidos desde kg y cm.

**Marines (Wright et al., 1980)**

- Hombres: `0.740·abdomen − 1.249·cuello + 0.985`.
- Mujeres: `1.051·brazo − 1.522·antebrazo − 0.879·cuello + 0.326·abdomen + 0.597·muslo + 0.707`.

La ecuación femenina requiere brazo, antebrazo, cuello, abdomen y muslo.

**Friedl & Vogel (1997)**

- Hombres: `0.771·(abdomen − cuello) − 0.132·altura + 4.29`.

### Métodos militares modernos

- **Fuerza Aérea de EE. UU. — hombres (Fuchs et al., 1978)**: predice el FFM desde el bíceps flexionado y la altura; SEE ≈ 3,8.
- **Fuerza Aérea de EE. UU. — mujeres (Brennen et al., 1979)**: FFM desde el antebrazo; SEE ≈ 3,9.
- **Boer (1984)**: FFM desde peso y altura (`0,407·W + 0,267·H − 19,2` en hombres; `0,252·W + 0,473·H − 48,3` en mujeres).

### Consenso y confianza

- Cada método aporta un **error estándar publicado (SEE)**. La fiabilidad se deriva de él como `1 − (SEE − 3)/6`, limitada a `0.45–0.98`, y se eleva al cuadrado para el peso. La ponderación por varianza inversa usa w_base = (1/SEE²)·(1 + 0,05·max(0, inputs − 2)); la mediana ponderada inicial y una desviación estándar robusta (MAD × 1,4826, suelo del 1,5 % de la mediana) definen la región normal, y el factor de amortiguación tipo Huber h_i = min(1, 1,5σ/|v_i − mediana|) atenúa ecuaciones atípicas sin eliminarlas del desglose.
- Los métodos se agrupan por **familia de medidas** (abdominal, cintura-cadera, cintura-altura, IMC y multi-sitio). Cada familia aporta como máximo el peso medio de sus métodos, de modo que varias ecuaciones abdominales correlacionadas no eclipsan a las de IMC o multi-sitio.
- El valor mostrado es la media ponderada por esos pesos; el rango va del mínimo al máximo de los métodos disponibles.
- La **confianza** (15–95%) combina la fiabilidad media, la cobertura de medidas, el acuerdo entre métodos y su número.
- La **cobertura** solo cuenta medidas que alguna ecuación puede aprovechar para ese sexo. Pecho y pantorrilla siguen en la silueta, pero no aumentan la cobertura porque ninguna ecuación de grasa los usa.
- Si falta el abdomen al ombligo, las ecuaciones que lo necesitan usan la cintura como aproximación; si falta la cintura, usan el abdomen.

### Derivados

- Masa grasa = peso × promedio de % grasa / 100.
- Masa magra = peso − masa grasa.
- IMC = peso / altura² (m).
- Índice cintura/cadera (WHR) y cintura/altura (WHtR).

### Clasificación militar (DoDI 1308.03 / USARIEM)

- **FFMI**: `leanMass / (altura/100)²`; **FFMI normalizado**: `FFMI + 6,1·(1,8 − altura/100)`.
- **Rango operativo USARIEM** (Potter, Looney & Friedl, 2022–2025): hombres 18,1–23,0 kg/m² (reserva magra baja ≤ 17,7, hipertrofia alta > 23,0); mujeres 15,5–18,3 (≤ 14,5, > 18,3).
- **Estándar DoDI 1308.03**: la razón cintura/altura (`whtr`: óptimo < 0,50, moderado 0,50–0,55, elevado > 0,55) y el límite de % grasa por grupo de edad (17–20, 21–27, 28–39, 40+) y sexo (18–26 % hombres, 26–36 % mujeres); se marca `muscularOverride: true` cuando `bmi ≥ 25` pero `whtr < 0,50` y el % grasa está dentro del estándar militar.

## Gasto energético y macros

- BMR Mifflin-St Jeor: `10·peso + 6.25·altura − 5·edad + constante`, con `+5` hombres, `−161` mujeres y `−78` si no se especifica.
- BMR Katch-McArdle: `370 + 21.6·masa magra`.
- BMR Cunningham: `500 + 22·masa magra`.
- **Modelo energético continuo** (`computeEnergyExpenditure`): `TDEE = BMR + TEF + NEAT + EAT`:
  - **BMR dinámico**: promedio ponderado entre Katch-McArdle/Cunningham (cuando hay masa magra estimada) y Mifflin-St Jeor (sin ella); se recalculan cada día de la proyección con `L(t)` y `F(t)`.
  - **TEF (efecto térmico de los alimentos)**: `0.10 × I` (10 % de la ingesta calórica media).
  - **NEAT continuo**: factor base no deportivo según nivel de actividad (`sedentary: 1,15`, `light: 1,22`, `moderate: 1,30`, `high: 1,38`, `very_high: 1,46`, `auto: 1,20`) × BMR dinámico, más el gasto neto continuo de caminar `kcal_pasos(t) = (avgSteps / 1000) × 0.045 × W(t)` (sin escalones: 6200 y 7800 pasos generan gastos distintos y proporcionales).
  - **EAT continuo**: por ritmo semanal de entrenamiento, con `estimateTraining(summary, declaredPerWeek)`; por sesión `min/sesión × MET × W(t)` (≈4,5 MET en fuerza, ≈6,5 en cardio/mixto) y promediado diariamente (sesiones/sem ÷ 7).
- **Frecuencia declarada**: `training.frequency` acepta sesiones por semana o por mes y se normaliza a sesiones por semana. `estimateTraining` combina la declarada con la observada en los últimos 30 días y usa la **mayor** de ambas, de modo que registrar solo 1 de 5 sesiones no subestima el gasto. Los minutos semanales observados en 7 días actúan como suelo.
- **Duración media**: sale de las sesiones registradas; solo se asumen 45 min cuando no hay ninguna. La **fuerza mensual** se estima con la proporción de sesiones de fuerza entre las registradas y, sin registros, se asumen de fuerza las sesiones declaradas.
- **Pasos diarios medios**: contribuyen NEAT continuo aditivo ((pasos/1000) × 0,045 × peso kcal/día).
- **Ingesta media** (`intake.average`): es un dato **manual**, no derivado. La proyección usa ese valor como ingesta del balance y en el TEF; si no existe, usa la media de los días con registro en 28 días (mínimo 3) o el objetivo de calorías. El atajo de la interfaz solo rellena el campo editable.
- Calorías objetivo: TDEE × `0.85` (definición), `1.10` (volumen) o `1.0` (mantenimiento).
- Proteína: `2.0 g/kg` en definición, `1.8 g/kg` en el resto.
- Grasa: máximo entre `0.6 g/kg` y el `24%` de las calorías.
- Carbohidratos: calorías restantes.
- Agua: `35 ml/kg` + `500 ml` por cada 60 minutos de entrenamiento semanal repartidos por día.
- Fibra: `14 g` por cada 1000 kcal.

Si faltan altura, edad o sexo, la app usa valores neutros (170 cm, 30 años, constante neutra) y lo indica en las notas.

## Proyección de peso y composición

El peso objetivo no se limita al IMC cuando hay composición corporal:

- Se fija la **masa magra objetivo** y se calcula la **masa grasa objetivo** a partir del porcentaje de grasa de referencia para sexo y edad. `peso objetivo = masa magra + masa grasa`.
- En definición se asume una retención de masa magra del `95%` sin fuerza registrada y del `100%` con ≥12 sesiones de fuerza al mes.
- En volumen se proyecta hasta un `1,5%` extra de masa magra con fuerza frecuente; sin fuerza, el superávit no se atribuye a músculo.
- El IMC objetivo se sigue mostrando como referencia, pero no recorta un objetivo que la composición justifica (por ejemplo, en personas con mucha masa muscular).

La fecha y los hitos futuros salen del **integrador fisiológico diario** (Hall/Forbes + termogénesis adaptativa):

- Estado inicial de dos compartimentos (`F(0)`, `L(0)`) desde `bodyComposition`; sin composición, se asume ≈80 % de masa magra.
- Cada día (`dt = 1 día`): `TDEE(t) = BMR(t) + TEF + NEAT(t) + EAT(t) − AT(t)`; la pérdida/ganancia se particiona grasa/magra siguiendo la curva de Forbes (`10,4/F(t)`) modulada por la fuerza mensual:
  - En déficit, fuerza ≥12 sesiones/mes reduce la fracción de pérdida magra hasta el mínimo fisiológico ≈5–10 %, dirigiendo el 90–95 % del déficit a la grasa.
  - En superávit, la ganancia de masa magra escala con el estímulo de fuerza (hasta ≈45–55 % del exceso entrenado; ≈20–25 % sin fuerza).
- **Termogénesis adaptativa**: `dAT/dt = (α·ΔE(t) − AT(t))/τ` con `α ≈ 0,11` (11 % del desbalance `ΔE = I − TDEE`) y `τ = 18 días`, reflejando la adaptación metabólica real en déficit o superávit sostenidos.
- **Transitorio de glucógeno/agua**: `ΔW_agua(t) = ΔW_max·(1 − e^(−t/4))`, acotado a ±1,8 kg; cada punto de la serie distingue el `scaleWeight` (peso en báscula) del `tissueWeight` (`F(t) + L(t)`).
- **Banda de incertidumbre (±1σ)**: se ejecutan las trayectorias límite (±8 % de variabilidad metabólica y de adherencia calórica) y se devuelven `weightLow`, `weightHigh`, hitos con rango realista y fechas de llegada con rango.
- El déficit/superávit sale de la ingesta media frente al TDEE simulado: un déficit de 500 kcal y uno de 800 kcal no producen el mismo ritmo, y al perder peso el gasto baja y el ritmo se frena.
- El ritmo semanal está limitado por seguridad según el peso y la fuerza mensual:
  - Definición: `0,75–1,0 %` del peso por semana según la fuerza mensual (0–12 sesiones).
  - Volumen: `0,25–0,5 %` del peso por semana según la fuerza mensual.
- El indicador de fuerza es el número de días distintos con al menos un ejercicio de tipo `fuerza` en los últimos 30 días.
- En definición se descuenta la parte del peso perdido que podría ser masa magra: sin fuerza se asume que solo el `75%` del cambio es grasa; con fuerza frecuente, hasta el `100%`. Por eso la misma pérdida de grasa requiere más tiempo cuando no se entrena fuerza.
- Los pasos medios, la actividad y los minutos de entrenamiento cambian el TDEE, y con ello el déficit/superávit y las fechas de los hitos.
- La app avisa cuando la ingesta queda por debajo de la TMB, el déficit supera ~30 % del TDEE, el superávit alcanza el 20 % del TDEE o el ritmo debe recortarse por seguridad.
- Las fechas de los hitos y de llegada incluyen siempre el año; las duraciones largas se muestran en meses o años en lugar de semanas sueltas.

El **borrado individual** de una sesión, entrenamiento o marca se guarda como evento `training.deleted` con el id del evento y, cuando existe, el id del payload. La bóveda no se reescribe: la fila deja de mostrarse y deja de contar en la proyección y en las alertas.

## Saciedad dual

Es una heurística de dos vías, en escala 0–100:

- **Presión gástrica**: `50·fibra/objetivo + 30·agua/objetivo + 20·proteína/objetivo`.
- **Señal bioquímica**: `45·proteína/objetivo + 35·fibra/objetivo + 20·grasa/objetivo`.
- **Combinada**: promedio de ambas.

Se clasifica como equilibrada (≥55/≥55), presión baja/bioquímica alta, presión alta/bioquímica baja o ambas bajas. Los objetivos salen de los macros y el agua calculados. No modela hormonas reales; solo orienta hábitos.

## Fuerza

- 1RM Epley: `peso·(1 + reps/30)`, para hasta 12 repeticiones.
- 1RM Brzycki: `peso·36/(37 − reps)`, para menos de 37 repeticiones.

La interfaz usa Epley para las estimaciones visibles. Con muchas repeticiones la estimación pierde fiabilidad.

## Carga por zonas

Cada zona tiene rangos semanales de series y minutos, y horas de recuperación (`src/zones.ts`). La app suma series, minutos y volumen de los últimos 7 días y avisa cuando:

- se superan las series o minutos recomendados;
- se vuelve a cargar una zona antes de la recuperación indicada;
- el total semanal supera 600 minutos.

Los rangos son heurísticas de programación, no prescripciones individuales.

## Mesociclos y recordatorios

- Los planes pueden tener mesociclos de varias semanas con deload opcional.
- Los recordatorios se comprueban cada 30 segundos mientras la app está abierta y usan notificaciones del sistema si el usuario las concede. No se programan en el sistema operativo ni se envían a ningún servidor.

## Fuentes

- Hodgdon, J. E. & Beckett, M. B. (1984). Prediction of percent body fat for U.S. Navy men and women.
- Woolcott, O. O. & Bergman, R. N. (2018). Relative fat mass (RFM) as a new estimator of whole-body fat percentage.
- Deurenberg, P. et al. (1991). Body mass index as a measure of body fatness.
- Gómez-Ambrosi, J. et al. (2012). Body mass index classification misses subjects with increased cardiometabolic risk factors.
- Vogel, J. A. et al. (1988). Prediction of body fatness from anthropometry in U.S. Army men and women.
- Wright, H. F. et al. (1980). Prediction of percent body fat in U.S. Marine Corps men and women.
- Friedl, K. E. & Vogel, J. A. (1997). Validity of percent body fat predicted from circumferences.
- U.S. Army (2023). One-site body-fat estimation (AR 600-9).
- Mifflin, M. D. et al. (1990). A new predictive equation for resting energy expenditure.
- Katch, F. I. & McArdle, W. D. (1973). Prediction of body density from simple anthropometric measurements.
- Cunningham, J. J. (1980). A reanalysis of the factors influencing basal metabolic rate in normal adults.
- Epley, B. (1985). Poundage chart.
- Brzycki, M. (1993). Strength testing: predicting a one-rep max from reps-to-fatigue.
