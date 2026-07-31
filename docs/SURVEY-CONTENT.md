# Product Salary Compass — Survey content & flow

Documento de referencia con **todos los pasos y el contenido textual** del survey de Salary Compass.
Fuente: `salary-compass/index.html`. Toda la copy va en inglés (como en producción); las anotaciones de estructura están en español.

El flujo tiene dos partes:

1. **Salary Comparison tool** (formulario inicial de la landing, pasos 1–5) → muestra el resultado.
2. **Full Survey modal** (capítulos 0–4) → desbloquea el dashboard y captura el email.

---

## PARTE 1 — Salary Comparison tool (landing form)

**Hero**
- Badge: `Portugal 2026`
- H1: *How many PMs earn more or less **than you**?*
- Subtitle: *Enter your salary details and instantly see where you stand in the Portugal PM compensation benchmark.*

Banner de error (si falta algo): *Please fix the following before comparing your salary:*

### Step 1 — Annual base salary
- **Label:** What's your annual base salary?
- **Hint:** Gross annual base salary in EUR, before bonus, equity or perks.
- **Input:** number, EUR, placeholder `e.g. 45000` (required)
- **Toggle opcional:** `+ Add total compensation`
  - **Label:** Total yearly compensation
  - **Hint:** Base + bonus, equity and recurring perks.
  - **Input:** number, EUR, placeholder `e.g. 52000`

### Step 2 — Role level
- **Label:** What's your role level?
- **Hint:** Select your current product management role
- **Opciones (select):**
  - Associate / Junior PM (`APM`)
  - Product Manager (`PM`)
  - Senior PM (`Senior PM`)
  - Lead / Principal PM (`Lead PM`)
  - Director / Head of Product (`Director of Product`)
  - VP / CPO (`VP of Product`)

### Step 3 — Years of experience
- **Label:** Years of experience in PM?
- **Hint:** Total years working in product management
- **Input:** number, sufijo `yrs`, placeholder `e.g. 4`, min 0 / max 50 (required)

### Step 4 — District
- **Label:** Where are you based?
- **Hint:** Select your district
- **Opciones (select, distritos de Portugal):** Aveiro · Beja · Braga · Bragança · Castelo Branco · Coimbra · Évora · Faro · Guarda · Leiria · Lisboa · Portalegre · Porto · Santarém · Setúbal · Viana do Castelo · Vila Real · Viseu · Açores · Madeira

### Step 5 — Perception
- **Label:** What % of PMs do you think earn less than you?
- **Hint:** Your best guess — we'll compare it to the real data
- **Input:** slider 0–100%

**CTA:** `Compare My Salary`
**Nota legal:** *Responses are anonymous and used for statistical purposes only.*

### Resultados (tras enviar)
- Eyebrow: *Your result*
- Bloque de salario + contexto dinámico
- *Your position in the Portugal PM benchmark* — barra de distribución (Lower salaries → Higher salaries)
- (Si añadió total comp) badge **Total Compensation** + *Your total compensation position in the Portugal PM benchmark* (Lower compensation → Higher compensation)

---

## PARTE 2 — Full Survey modal

### Barra de progreso (segmentos de capítulo)
`About you` → `Compensation` → `Transparency` → `Done`

### Títulos dinámicos del header del modal
Por capítulo:
- **0:** (sin título)
- **1:** `Step 1 / 3` — About your company
- **2:** `Step 2 / 3` — Strengths & perks
- **3:** `Step 3 / 3` — Transparency
- **4:** `Last step` — Where should we send your dashboard?

Por sub-step (cuando aplica, sobrescribe lo anterior):
- **1-0:** `About you · Step 1 of 3` — You & your company
- **1-1:** `About you · Step 2 of 3` — Your work setup
- **1-2:** `About you · Step 3 of 3` — Your company
- **2-0:** `Compensation · Step 1 of 2` — What your company values & offers
- **2-1:** `Compensation · Step 2 of 2` — Put rough numbers on it

> Nota: el capítulo 4 (email) **solo se muestra si el email no se capturó antes**. Total de preguntas visibles mostradas al usuario: **13** (excluye condicionales de bonus/equity).

Diálogo de salida (si intenta cerrar): *Leave and lose your progress?* / *Your answers aren't saved yet. If you exit now, you'll have to start over.* — botones `Keep going` / `Exit anyway`.

---

### Chapter 0 — Intro / Locked dashboard

- **Headline:** Unlock the Dashboard.
- **Body:** The numbers most product people never get to see.
- **Preview borrosa (decorativa, datos ilustrativos):**
  - *Top-paying industries:* Fintech €82k · Web3 €78k · SaaS €73k
  - *By company stage:* Startup €58k · Scale-up €72k · Corporate €66k
  - *Remote vs office:* +18% (Remote vs Office)
  - *Gender pay gap:* −7% (same role, level & exp.) · −18% (all roles)
  - *And many more*
- **CTA:** `Start →`
- **Disclaimer:** Figures shown are illustrative examples, not real data.

---

### Chapter 1 — About your company (3 sub-steps)

#### Sub-step 1-0 · You & your company

**Q · How do you identify?** (chips)
- Woman · Man · Non-binary · Prefer not to say

**Q · Current industry** (select)
- AdTech & marketing · AI · Banking & insurance · Biotech · Climate & energy · Crypto & Web3 · Cybersecurity · Data · Developer tools · E-commerce · Education · Fintech · Gaming · Hardware & IoT · Health · HR tech · Logistics · Marketplaces · Media · Mobility · PropTech · Public services · Retail · SaaS B2B · SaaS B2C · Social impact · Telecom · Travel · Other
- *(condicional "Other"):* Please specify your industry

**Q · Type of company** (select)
- Startup · Scale-up · Corporate · Agency · Consultancy · Government · Non-profit · Own business · Other
- *(condicional "Other"):* Please specify the type of company

#### Sub-step 1-1 · Your work setup

**Q · What is the size of your organisation?** (chips)
- 1-10 · 11-50 · 51-100 · 101-500 · 501-1000 · 1001-5000 · >5000

**Q · Company's policy** (chips)
- Fully remote · Hybrid · Remote (office optional) · On-site
- *(condicional "Hybrid"):* Days in office → número + `per week` / `per month`
- *(condicional "Fully remote"):* Does your company have an office in the country you are based? → Yes / No

#### Sub-step 1-2 · Your company

**Q · What best describes your current employment arrangement in this role?** (select)
- Full-time employee · Part-time employee · Fixed-term employee · Contractor · Consultant · Freelancer · Founder · Intern · Other
- *(condicional "Other"):* Please specify your employment arrangement

**Q · Which company do you work for?** *(optional)* — input de texto, placeholder `Company name`

**Q · Where is your company headquarter located?** (select de países, lista completa mundial A–Z, incluye `Other`)
- *(condicional "Other"):* Please specify the country

---

### Chapter 2 — Strengths & perks (2 sub-steps)

#### Sub-step 2-0 · What your company values & offers

**Q · Which of your strengths does your company value most?** *(Pick up to 3)* (chips, multi)
- Product vision · Prioritization · Data · Discovery · Stakeholders · Tech depth · Execution · Leadership · Storytelling · Design taste · Growth · Domain expertise · AI fluency · Other
- *(condicional "Other"):* Please specify your other strength — *Press Enter to add*

**Q · If any, what perks does your organisation offer?** *(optional)* (chips, multi)
- Health insurance · Equity (RSUs, stock options…) · Performance bonus · Wellness / Gym · Home office stipend · Learning budget · Extra PTO · Meal allowance · Pension / Retirement · Other
- *(condicional "Other"):* Please specify your other perks — *Press Enter to add*

#### Sub-step 2-1 · Put rough numbers on it
Campos condicionales que aparecen según los perks seleccionados arriba:

| Perk seleccionado | Label | Unidad | Placeholder |
|---|---|---|---|
| Performance bonus | Annual bonus | EUR / yr | e.g. 5000 |
| Equity (RSUs, stock options…) | Equity grant value | EUR total | e.g. 10000 |
| Wellness / Gym | Wellness / Gym stipend | EUR / month | e.g. 50 |
| Home office stipend | Home office stipend | EUR / year | e.g. 600 |
| Learning budget | Learning budget | EUR / year | e.g. 1500 |
| Meal allowance | Meal allowance | EUR / day | e.g. 8 |
| Pension / Retirement | Pension / Retirement employer contribution | EUR / year | e.g. 2000 |

---

### Chapter 3 — Transparency (escala Likert 1–5)

**Q1 · Is the company transparent in terms of career path and compensation for PMs?**
- Anclas: `Strongly disagree` (1) → `Strongly agree` (5)

**Q2 · Currently, do you feel your salary is adequate to your experience and skills?**
- Anclas: `Not at all` (1) → `Completely` (5)

**Q3 · Thinking about your most recent salary discussion for your current role, were you comfortable negotiating your salary?**
- Anclas: `Very uncomfortable` (1) → `Very comfortable` (5)

---

### Chapter 4 — Email capture *(solo si el email no fue capturado antes)*

- **Label:** Your email — input email, placeholder `you@email.com`
- **Checkbox 1 (checked):** Send me Product Salary Compass reports periodically.
- **Checkbox 2 (checked):** I want to receive tools like this, community perks, and Product event updates.
- **CTA:** `Get my dashboard →`

**Navegación del modal (footer):** `← Back` · `Continue →` · `Submit`

---

## Estado de éxito (tras enviar el survey)

- Confetti: `✦ ✦ ✦`
- Eyebrow: *Contributor #— of 500*
- **Headline:** You moved the needle.
- **Impacto:** *Counter just jumped — → — of 500. Every share gets us closer to publishing the full dashboard.*
- **Tarjeta para compartir:**
  - Logo The Impostor PM
  - Percentil grande (`p--`)
  - *My PM salary in Portugal. Check where you land.*
  - `impostor.pm/salary-compass`
- **Compartir:** LinkedIn · WhatsApp · X (Twitter) · Copy link · More options… + `Download PNG`
- **Secundario:** `← Back to my results`

---

## Newsletter pop-up modal (independiente del survey)

- **Headline:** Don't feel like an impostor.
- **Body:** Get tools like this, PM salary insights and community perks straight to your inbox.
- **Input:** email, placeholder `you@email.com`
- **CTA:** `Subscribe`
- **Éxito:** *You're in.* / *Check your inbox to confirm your subscription.*

---

## Notas de implementación relevantes

- **Auto-advance:** los chips de selección única avanzan solos (~600 ms); los multi-select y campos de texto no.
- **Contador (`COUNTER_METRIC`):** fuente de verdad = `surveys`, meta `COUNTER_GOAL = 500`. Se puede cambiar a `submissions` si el número de surveys es demasiado bajo para motivar.
- **Total de preguntas mostradas:** `TOTAL_QS_DISPLAY = 13` (excluye condicionales bonus/equity-grant).
- **Test mode:** `?test=1` bloquea escrituras al backend y silencia analítica.
- **Persistencia:** las respuestas se envían a un webhook de Google Sheets; el email también a `impostor.pm/api/salary-compass-email`.
- **Capítulo 4 condicional:** si el email ya se capturó en el flujo de comparación, el último capítulo es el 3 y se omite la captura de email.
