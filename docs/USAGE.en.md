# Guía de uso — Better Fitness Tracker (English)

This guide documents the interface and the new dynamic projection engine, the military composition metrics and the body-composition engine. All figures are orientation only and do not replace medical assessment.

## Language

The app installs in **English** by default; you can switch to Spanish from **Settings → Language**. The chosen language is stored and applies on future launches.

## Body — Projection

The **Safe range and projected progress** card now always shows the projection controls:

- **Physical activity level**: `Automatic` (deduces PAL from training minutes in the last 7 days) or a fixed level: Sedentary, Light, Moderate, High, Very high. Changing it appends the `activity.level` vault event and updates the projection immediately.
- **Average daily steps**: contribute extra NEAT — `(steps/1000) × 0.045 × weight` kcal/day. With no steps: 6200 and 7800 steps produce different, proportional expenditure.
- **Average calories you eat**: the average intake used in the balance (TEF included). A **Use logged average** button appears when you have at least 3 recent logged days.
- **Training frequency**: sessions per week or per month; combined with the observed sessions in the last 30 days (the higher value is used).

### Daily expenditure breakdown

- **Dynamic BMR**: Katch-McArdle/Cunningham weighted average + Mifflin-St Jeor, recalculated with the simulated lean and fat mass.
- **TEF**: `10 %` of the average intake.
- **NEAT (steps + base activity)**: non-sport base factor by activity level (`sedentary: 1.15`, `light: 1.22`, `moderate: 1.30`, `high: 1.38`, `very_high: 1.46`, `auto: 1.20`) × dynamic BMR + walking expenditure.
- **EAT training**: `sessions/wk ÷ 7 × min/session × MET × W(t)` (≈4.5 MET strength, ≈6.5 MET cardio/mixed).
- **Metabolic adaptation (AT)**: exponential adaptive thermogenesis (α ≈ 11 % of the energy imbalance, τ = 18 days).
- **Total TDEE**: `BMR + TEF + NEAT + EAT − AT`.

### Confidence band

The weight curve and milestones are shown within a **confidence band (±8 %)**: limit trajectories of metabolic variability and adherence are executed, and the app returns `weightLow`/`weightHigh` with milestones that include realistic ranges and estimated arrival dates with ranges.

### Projected evolution

Below the projection, a small curve shows the projected evolution of **fat mass, lean mass and FFMI** over the simulation (every 7 days), from the initial state to the goal.

## Body composition (methods + military)

The **Composition** section combines civil equations (Navy/Air Force, RFM, Deurenberg, CUN-BAE, Army (Vogel), Marines (Wright), Friedl) with modern military equations:

- **U.S. Air Force — men (Fuchs et al., 1978)**: FFM from the flexed bicep.
- **U.S. Air Force — women (Brennen et al., 1979)**: FFM from the forearm.
- **Boer (1984)**: FFM from weight and height.

The consensus is a precision-weighted average (`w_base = (1/SEE²)·(1 + 0.05·max(0, inputs − 2))`) with a weighted median, robust standard deviation (MAD × 1.4826, floor 1.5 % of the median) and Huber damping (`h_i = min(1, 1.5σ/|v_i − median|)`); outlier equations are damped without being removed from the breakdown.

### Military indicators (DoDI 1308.03 / USARIEM)

- **FFMI**: `leanMass / (height/100)²`; **Normalized FFMI**: `FFMI + 6.1·(1.8 − height/100)`.
- **USARIEM operational ranges**: men 18.1–23.0 kg/m² (low lean reserve ≤ 17.7, high hypertrophy > 23.0); women 15.5–18.3 (≤ 14.5, > 18.3).
- **DoDI 1308.03 standard**: waist/height ratio (optimal < 0.50) + body fat limit by age group (17–20, 21–27, 28–39, 40+) and sex (18–26 % men, 26–36 % women).
- **Muscular warning**: appears when BMI ≥ 25 but `whtr < 0.50` and the % fat is within the military standard (muscle mass lowers measured BMI).

## Weight projection

The projection is a daily physiological integrator of two compartments (Hall/Forbes + adaptive thermogenesis):

- Initial fat and lean mass from `bodyComposition`.
- Fat/lean partition following the Forbes curve (10.4/F), modulated by strength: in deficit, ≥12 strength sessions/month reduce lean loss to ≈5–10 %; in surplus, lean gain scales with the strength stimulus.
- Exponential adaptive thermogenesis (α ≈ 11 % of the imbalance, τ = 18 days).
- Glycogen/water transient (±1.8 kg) distinguishing scale weight vs. tissue weight.
- ±8 % uncertainty band of metabolic and adherence variability.

## Body figure — Silhouette

Measurement form: weight, height, age, sex, neck, chest, waist, abdomen, hip, bicep/forearm, thigh, calf and wrist. Fields behave as missing data rather than zero.

## Updates

Manual check from Settings. No automatic background check.

## Frequently asked

- **What do the steps do?** They contribute NEAT: 6200 and 7800 steps produce different, proportional expenditure, additive to the activity-level expenditure.
- **What if my BMI is high but I have muscle?** The app shows the muscular warning (`muscularOverride`) when whtr is optimal and % fat is within the military standard.

## Automatic data (append-only vault events)

`activity.level`, `steps.average`, `training.frequency`, `intake.average`, `measurement.saved`, `weight.logged`, `session.saved`, `workout.saved`, `pr.achieved` — the projection updates as they are saved.
