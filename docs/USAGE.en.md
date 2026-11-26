# Guía de uso — Better Fitness Tracker (English)

This guide documents the interface and the new dynamic projection engine, the military composition metrics and the body-composition engine. All figures are orientation only and do not replace medical assessment.

## Language

The app installs in **English** by default; you can switch to Spanish from **Settings → Appearance → Language**. The chosen language is stored and applies on future launches.

## Settings

The **Settings** dialog uses horizontal tabs; the last tab you used is remembered on the next launch. You can switch tabs with the mouse or with the left/right arrow keys.

- **Appearance**: light/dark theme, accent color and language; also the installed format and a reminder of where to enter barcodes.
- **Vault**: vault path, app data, device, privacy/network notice, browser-mode notice and sample data (browser only).
- **Backups**: status and size of `longlife` copies, create today's copy, non-destructive restore of missing events and deletion of copies (irreversible).
- **Updates**: manual check and optional install.
- **About**: version, commit, build date, vault schema, event count and links to the repository and privacy policy.

The dialog footer lets you change the vault.

## Exercise library — descriptions

In **Training → Library**, every exercise can have a **description** (up to 2000 characters) with instructions, tips, suggested sets/reps or common mistakes, and a link to an **explanatory video** (HTTPS from YouTube, youtu.be or Vimeo). Both fields are optional and are stored with the exercise, so they survive renames and sync across devices like any other vault event.

- When adding or editing an exercise (pencil button), fill in the description and/or the link; the "Watch video" button opens it in the system browser.
- The library search also finds exercises by their description text.
- Exercises created before this version keep working: they simply have no description until you add one.

## Nutrition — food search

There is a **single search box**: a name searches your local database and, after a short delay, Open Food Facts by keyword; 6–14 digits (or a scanner ending in Enter) are treated as a barcode and looked up in the local catalog and Open Food Facts. Results show their source and kcal/macros per 100 g. Clicking a result selects it to adjust the portion; **+** adds it to the active meal. Cloud products are saved as your own foods so you can use them offline.

## Body — Projection

The **Safe range and projected progress** card now always shows the projection controls:

- **Physical activity level**: `Automatic` (deduces PAL from training minutes in the last 7 days) or a fixed level: Sedentary, Light, Moderate, High, Very high. Changing it appends the `activity.level` vault event and updates the projection immediately.
- **Average daily steps**: act as a NEAT floor — `max((PAL − 1) × BMR, (steps/1000) × 0.45 × weight)` kcal/day. They are not added to PAL because PAL already includes walking. With no steps: 6200 and 7800 steps produce different, proportional expenditure.
- **Average calories you eat**: the average intake used in the balance (TEF included). A **Use logged average** button appears when you have at least 3 recent logged days.
- **Training frequency**: sessions per week or per month; combined with the observed sessions in the last 30 days (the higher value is used).

### Daily expenditure breakdown

- **Dynamic BMR**: Katch-McArdle/Cunningham weighted average + Mifflin-St Jeor, recalculated with the simulated lean and fat mass.
- BMR uses age-specific equations outside adulthood: Schofield (10–17 y) and Porter 2023 (65+). Katch-McArdle/Cunningham remains for adults. Age also gently moderates lean-mass change and the safe rate.
- **TEF**: `10 %` of the average intake.
- **NEAT (steps or base activity)**: `max((PAL − 1) × dynamic BMR, walking expenditure)`, with a PAL factor by activity level (`sedentary: 1.15`, `light: 1.22`, `moderate: 1.30`, `high: 1.38`, `very_high: 1.46`, `auto: 1.20`). Walking is not added twice.
- **EAT training**: `sessions/wk ÷ 7 × min/session × MET × W(t)` (≈4.5 MET strength, ≈6.5 MET cardio/mixed).
- **Metabolic adaptation (AT)**: heuristic exponential adaptive thermogenesis (α ≈ 11 % of the energy imbalance, τ = 18 days; Hall 2010 uses τ ≈ 7 days).
- **Total TDEE**: `BMR + TEF + NEAT + EAT − AT`.

### Confidence band

The weight curve and milestones are shown within a **90 % prediction interval** (literally the 5th–95th percentiles) from 81 deterministic Monte Carlo scenarios: bounded variation in BMR, NEAT, intake (depending on its source), adaptation, partition and water. `weightLow`/`weightHigh` and milestone ranges are those percentiles, not widened with the central value. Scenarios that never reach a milestone are counted separately instead of being shown as distant arrivals; the central value remains the most likely estimate.

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
- **DoDI 1308.03 standard**: waist/height ratio (optimal < 0.50) + body fat limit by sex (18–26 % men, 26–36 % women). The age group is shown but does not change the limit.
- **Muscular warning**: appears when BMI ≥ 25 but `whtr < 0.50` and the % fat is within the military standard (muscle mass lowers measured BMI).

## Weight projection

The projection is a daily physiological integrator of two compartments (Hall/Forbes + adaptive thermogenesis):

- Initial fat and lean mass from `bodyComposition`.
- Fat/lean partition following the Forbes curve (`10.4/(F + 10.4)`), modulated by strength: in deficit, the lean fraction is capped at 5–40 % and ≥12 strength sessions/month reduce lean loss to ≈5–10 %; in surplus, lean gain scales with the strength stimulus.
- Exponential adaptive thermogenesis (heuristic α ≈ 11 % of the imbalance, τ = 18 days; Hall 2010 uses τ ≈ 7 days).
- Glycogen/water transient (±1.8 kg) distinguishing scale weight vs. tissue weight.
- 90 % prediction interval (5th–95th percentiles) from Monte Carlo over BMR, PAL, intake, adaptation, partition and water.

## Body figure — Silhouette

Body figure is organised into tabs: **Data & measurements** (form and quick weight log), **Composition** (indicators, silhouette and equation consensus) and **Projection** (trend and simulation).

**Nutrition** has three tabs: **Intake** (macros, FoodLog and the automatic logging switch), **Water** (counter, target and limits) and **Recipes** (50 dishes, a “Rotate recipes” button for another three, and allergen labels). All recipes are gluten- and nut-free; dairy, egg, soy, fish, shellfish or sesame are labelled as allergens. The Summary and Reminders tabs are gone: reminders now live in Habits.

Measurement form: weight, height, age, sex, neck, chest, waist, abdomen, hip, bicep/forearm, thigh, calf and wrist. Fields behave as missing data rather than zero.

The adaptive silhouette **follows the sex already selected in the measurement form** (there is no second switch): its shape and the draggable node ranges change accordingly. Drag nodes outwards to increase a circumference; if sex is unspecified, the silhouette uses neutral ranges and says so.

## Updates

Manual check from **Settings → Updates**. No automatic background check.

## Frequently asked

- **What do the steps do?** They set a NEAT floor: 6200 and 7800 steps produce different, proportional expenditure. They are not added on top of the activity-level expenditure because the PAL already includes walking.
- **What if my BMI is high but I have muscle?** The app shows the muscular warning (`muscularOverride`) when whtr is optimal and % fat is within the military standard.

## Automatic data (append-only vault events)

`activity.level`, `steps.average`, `training.frequency`, `intake.average`, `measurement.saved`, `weight.logged`, `session.saved`, `workout.saved`, `pr.achieved` — the projection updates as they are saved.

## Habits and automatic intake logging

Habits are classified as **healthy**, **strong**, **addictive** or **bad**. Addictive and bad habits subtract points when logged as done, and *not* doing them counts as compliance; the **All / Strong / Addictions & bad** tabs filter the list. Reminders live here.

In **Nutrition → Intake** you can enable **Log today's intake**: it saves the day's macros automatically whenever they change. With at least **5 active days in the last 30**, History shows the average and **Body figure** uses that average instead of manual intake for the projection.

In **History → Nutrition** you can **backfill past dates**, **correct a day’s calories** and **cancel or re-enable** any day in the last 30. Events are append-only, so the latest entry for each date wins.
