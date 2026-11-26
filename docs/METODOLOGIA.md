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

- Cada método aporta un **error estándar publicado (SEE)**. La fiabilidad se deriva de él como `1 − (SEE − 3)/6`, limitada a `0.45–0.98`, y solo alimenta la confianza; el peso de cada método usa directamente `1/SEE²`. La ponderación por varianza inversa usa w_base = (1/SEE²)·(1 + 0,05·max(0, inputs − 2)); la mediana ponderada inicial y una desviación estándar robusta (MAD × 1,4826, suelo del 1,5 % de la mediana) definen la región normal, y el factor de amortiguación tipo Huber h_i = min(1, 1,5σ/|v_i − mediana|) atenúa ecuaciones atípicas sin eliminarlas del desglose.
- Los métodos se agrupan por **familia de medidas** (abdominal, cintura-cadera, cintura-altura, IMC y multi-sitio). Cada familia aporta como máximo el peso medio de sus métodos, de modo que varias ecuaciones abdominales correlacionadas no eclipsan a las de IMC o multi-sitio.
- El valor mostrado es la media ponderada por esos pesos; el rango va del mínimo al máximo de los métodos disponibles. **Heurística por edad**: las ecuaciones de IMC bajan su peso a 0,6 en menores de 18 y a 0,75 en mayores de 65 (donde la sarcopenia hace que el IMC refleje peor la grasa); en ≥65 las ecuaciones multi-sitio suben a 1,15. Es una decisión de precisión, no una ecuación publicada.
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
- **Estándar DoDI 1308.03**: la razón cintura/altura (`whtr`: óptimo < 0,50, moderado 0,50–0,55, elevado > 0,55) y el límite de % grasa por sexo (18–26 % hombres, 26–36 % mujeres). El grupo de edad se calcula para mostrarlo, pero **no modifica el límite**: el código no aplica los rangos 17–20/21–27/28–39/40+ al % grasa. Se marca `muscularOverride: true` cuando `bmi ≥ 25` pero `whtr < 0,50` y el % grasa está dentro del estándar.

## Gasto energético y macros

- BMR Mifflin-St Jeor: `10·peso + 6.25·altura − 5·edad + constante`, con `+5` hombres, `−161` mujeres y `−78` si no se especifica.
- BMR Katch-McArdle: `370 + 21.6·masa magra`.
- BMR Cunningham: `500 + 22·masa magra`.
- **Modelo energético continuo** (`computeEnergyExpenditure`): `TDEE = BMR + TEF + NEAT + EAT`:
  - **BMR dinámico**: media simple de Katch-McArdle y Cunningham cuando hay masa magra estimada; Mifflin-St Jeor solo cuando no la hay. El BMR se recalcula cada día con `L(t)`; NEAT y EAT usan `W(t) = F(t) + L(t)`.
  - **BMR por franja de edad** (`bmrAgeAdjusted`): 10–17 años usa Schofield 1985 (`17,686·W+658,2` hombres; `13,384·W+692,6` mujeres, kcal/d); ≥65 años usa Porter et al. 2023 (modelo 6, en kJ/d ÷ 4,184, con peso, altura, edad y sexo). Entre 18 y 64 se mantienen Katch/Cunningham. Las ecuaciones pediátricas y de mayores se muestran en las notas de la app.
  - **TEF (efecto térmico de los alimentos)**: `0.10 × I` (10 % de la ingesta calórica media).
  - **NEAT continuo**: el PAL declarado ya incluye caminar, así que los pasos no se suman otra vez. Se usa `NEAT = máx((PAL − 1) × BMR, pasos)`, con el factor PAL por nivel (`sedentary: 1,15`, `light: 1,22`, `moderate: 1,30`, `high: 1,38`, `very_high: 1,46`, `auto: 1,20`) y `kcal_pasos(t) = (avgSteps / 1000) × 0.45 × W(t)` (≈0,5 kcal/kg/km; sin escalones: 6200 y 7800 pasos generan gastos distintos y proporcionales).
  - **EAT continuo**: por ritmo semanal de entrenamiento, con `estimateTraining(summary, declaredPerWeek)`; por sesión `min/sesión × MET × W(t)` (≈4,5 MET en fuerza, ≈6,5 en cardio/mixto) y promediado diariamente (sesiones/sem ÷ 7).
- **Frecuencia declarada**: `training.frequency` acepta sesiones por semana o por mes y se normaliza a sesiones por semana. `estimateTraining` combina la declarada con la observada en los últimos 30 días y usa la **mayor** de ambas, de modo que registrar solo 1 de 5 sesiones no subestima el gasto. Los minutos semanales observados en 7 días actúan como suelo.
- **Duración media**: sale de las sesiones registradas; solo se asumen 45 min cuando no hay ninguna. La **fuerza mensual** se estima con la proporción de sesiones de fuerza entre las registradas y, sin registros, se asumen de fuerza las sesiones declaradas.
- **Pasos diarios medios**: actúan como suelo del NEAT: `máx((PAL − 1) × BMR, (pasos/1000) × 0,45 × peso)`. No se suman al PAL para no duplicar el gasto de caminar.
- **Ingesta media** (`intake.average`): es un dato **manual**, no derivado. La proyección usa ese valor como ingesta del balance y en el TEF; si no existe, usa la media de los días con registro en 28 días (mínimo 3) o el objetivo de calorías. El atajo de la interfaz solo rellena el campo editable.
- Calorías objetivo: TDEE de referencia × `0.85` (definición), `1.10` (volumen) o `1.0` (mantenimiento). La TEF se resuelve con la ingesta final, de modo que `I = base/0,9` es la ingesta de mantenimiento: al comer menos, la TEF también baja y el déficit neto es menor que la diferencia de calorías.
- Proteína: `2.0 g/kg` en definición, `1.8 g/kg` en el resto.
- Grasa: máximo entre `0.6 g/kg` y el `24%` de las calorías.
- Carbohidratos: calorías restantes.
- Agua: `35 ml/kg` + `500 ml` por cada 60 minutos de entrenamiento semanal repartidos por día.
- Fibra: `14 g` por cada 1000 kcal.

Si faltan altura, edad o sexo, la app usa valores neutros (170 cm, 30 años, constante neutra) y lo indica en las notas.

## Proyección de peso y composición

El objetivo se calcula por composición, pero **el IMC sigue siendo una comprobación de seguridad**: si el IMC actual está fuera del rango orientativo, la app bloquea la proyección y lo explica (esto evita recomendaciones extremas; se muestra el IMC objetivo solo como referencia).

- Se fija la **masa magra objetivo** y se calcula la **masa grasa objetivo** a partir del porcentaje de grasa de referencia para sexo y edad. `peso objetivo = masa magra + masa grasa`.
- En definición la masa magra objetivo interpola suavemente del `95 %` sin fuerza al `100 %` con ≥12 sesiones/mes (`0,95 + 0,05·factor_de_fuerza`).
- En volumen se proyecta hasta un `1,5 %` extra de masa magra con fuerza frecuente; sin fuerza no se suma magra extra al objetivo, aunque el integrador reparte ≈25 % del superávit a magra y hasta ≈50 % con fuerza completa.
- El IMC objetivo se muestra como referencia; la comprobación de seguridad del párrafo anterior se aplica al IMC **actual**, no al objetivo.

La fecha y los hitos futuros salen del **integrador fisiológico diario** (Hall/Forbes + termogénesis adaptativa):

- Estado inicial de dos compartimentos (`F(0)`, `L(0)`) desde `bodyComposition`; sin composición, se asume ≈80 % de masa magra.
- Cada día (`dt = 1 día`): `TDEE(t) = BMR(t) + TEF + NEAT(t) + EAT(t) − AT(t)`; la pérdida/ganancia se particiona grasa/magra siguiendo la curva de Forbes, donde la fracción magra es `10,4/(F(t) + 10,4)` (acotada al 5–40 % sin fuerza) y se modula por la fuerza mensual:
  - En déficit, la fracción magra interpola suavemente desde Forbes (5–40 %) hasta el mínimo heurístico del 7,5 % con fuerza completa, dirigiendo el 92,5 % del déficit a la grasa. No hay salto al llegar a 12 sesiones. Se multiplica por un factor de edad heurístico: 1,3 en ≥65 (más pérdida de magra por sarcopenia), 0,85 en <18 (el crecimiento compensa), 1,0 en adultos (Heymsfield 2014).
  - En superávit, la ganancia de masa magra escala suavemente del 25 % sin fuerza al 50 % con fuerza completa, con factor de edad 0,8 en ≥65 y 1,15 en <18.
- **Termogénesis adaptativa**: `dAT/dt = (α·ΔE(t) − AT(t))/τ` con `α ≈ 0,11` y `τ = 18 días`. Es una **heurística de suavizado**: Hall (2010) describe el inicio de la adaptación con τ ≈ 7 días y parámetros calibrados en el experimento de Minnesota; la magnitud atribuible a adaptación más allá del cambio de composición es discutida (Thomas 2014, Falkenhain 2025).
- **Transitorio de glucógeno/agua**: `ΔW_agua(t) = ΔW_max·(1 − e^(−t/4))`, con `ΔW_max = desbalance × 0,0025` acotado a ±1,8 kg (±720 kcal saturan el transitorio); cada punto distingue `scaleWeight` de `tissueWeight` (`F(t)+L(t)`).
- **Intervalo de predicción del 90 %**: Monte Carlo determinista con 81 escenarios y percentiles 5–95. Las perturbaciones son desviaciones típicas acotadas: BMR σ=0,06, NEAT σ=0,075, ingesta σ=0,10 manual / 0,06 registrada / 0,08 objetivo, AT σ=0,30, partición σ=0,10 y agua σ=0,75 kg. `weightLow`/`weightHigh` y los rangos de los hitos son **literalmente p5–p95** (no se ensanchan con el valor central). Los escenarios que no alcanzan un hito se cuentan en `unreachedScenarios` y no se inventan como llegadas al horizonte máximo.
- El déficit/superávit sale de la ingesta media frente al TDEE simulado: un déficit de 500 kcal y uno de 800 kcal no producen el mismo ritmo, y al perder peso el gasto baja y el ritmo se frena.
- El ritmo semanal está limitado por seguridad según el peso y la fuerza mensual:
  - Definición: `0,75–1,0 %` del **peso simulado de cada día** por semana según la fuerza mensual, reducido a 0,75× en ≥65 y 0,85× en <18.
  - Volumen: `0,25–0,5 %` del peso simulado según la fuerza mensual, con los mismos factores de edad.
- El indicador de fuerza es el número de días distintos con al menos un ejercicio de tipo `fuerza` en los últimos 30 días.
- En definición se descuenta la parte del peso perdido que podría ser masa magra con la curva de Forbes (`10,4/(F + 10,4)`): sin fuerza, entre el `60 %` y el `95 %` del cambio es grasa según la masa grasa disponible (fracción magra acotada al 5–40 %); con fuerza frecuente la pérdida magra baja suavemente hasta ≈7,5 %. Por eso la misma pérdida de grasa requiere más tiempo cuando no se entrena fuerza.
- Los pasos medios, la actividad y los minutos de entrenamiento cambian el TDEE, y con ello el déficit/superávit y las fechas de los hitos.
- La app avisa cuando la ingesta queda por debajo de la TMB, el déficit alcanza el 30 % del TDEE resuelto, el superávit alcanza el 20 % del TDEE o el ritmo debe recortarse por seguridad.
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
- Schofield, W. N. (1985). Predicting basal metabolic rate, new standards and review of previous work. *Hum Nutr Clin Nutr*.
- Porter, J. et al. (2023). Development and validation of new predictive equations for RMR of older adults ≥65 y. *AJCN* (PMC10447471).
- Fuchs, R. J. et al. (1978). Body composition prediction from biceps circumference in Air Force males.
- Brennen, M. L. et al. (1979). Body composition prediction from forearm circumference in Air Force females.
- Boer, P. (1984). Body composition from weight and height.
- Forbes, G. B. (1987/2000). Lean body mass–body fat interrelationships in humans.
- Hall, K. D. (2007). Body fat and fat-free mass interrelationships: Forbes's theory revisited. *Br J Nutr*.
- Hall, K. D. (2010). Predicting metabolic adaptation, body weight change, and energy intake in humans. *Am J Physiol Endocrinol Metab*.
- Heymsfield, S. B. et al. (2014). Weight loss composition is one-fourth fat-free mass: a critical review and critique. *Obes Rev*.
- Thomas, D. et al. (2014). Effect of dietary adherence on the body weight plateau. *AJCN*.
- Falkenhain, K. et al. (2025). Energy expenditure, metabolic adaptation, physical activity and energy intake following weight loss. *Eur J Clin Nutr*.
- U.S. Department of Defense (DoDI 1308.03) y Potter/Looney/Friedl (USARIEM), estándares de composición y FFMI.
