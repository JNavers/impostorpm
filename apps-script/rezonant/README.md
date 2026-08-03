# TIPM × Rezonant — Apps Script setup

Backend para `rezonant/index.html`. Recibe el POST del formulario, guarda en Google Sheet y dispara emails vía Resend.

## 1. Crear el Apps Script

1. Abre <https://script.google.com/> → **New project**.
2. Renombra el proyecto a `TIPM × Rezonant landing`.
3. Borra el contenido por defecto de `Code.gs` y pega el contenido de este `Code.gs`.
4. Guarda (`⌘+S`).

## 2. Configurar Resend API key

1. En el editor del script: **Project Settings** (⚙️ icono lateral) → **Script properties** → **Add script property**.
2. Property: `RESEND_API_KEY` · Value: `re_...` (tu API key de Resend).
3. Guarda.

> Verifica primero que `general@impostor.pm` (o el dominio `impostor.pm`) esté como sender verificado en Resend. Si no, los emails fallarán con 422.

## 3. Conceder permisos

1. En el editor, abre `Code.gs`.
2. En el dropdown de funciones (top bar) selecciona `_testMember`.
3. Cambia `YOUR_OWN_EMAIL@example.com` por tu email real (temporalmente).
4. Click ▶️ **Run** → Google pedirá permisos:
   - Google Sheets (escribir filas)
   - External requests (llamar Resend)
   - Script Properties (leer la API key)
   Acepta todos.
5. Revisa tu inbox — deberías recibir el email "Your 3,000 Rezonant credits".
6. Revisa la Google Sheet — deberías ver una fila nueva en la pestaña `Members`.
7. Repite con `_testSignup` para validar la rama B (welcome + credits, dos emails, fila en `Signups`).
8. **Importante**: revierte el `YOUR_OWN_EMAIL@example.com` cuando termines de testear.

## 4. Deploy como Web App

1. Click **Deploy** (top right) → **New deployment**.
2. Engranaje al lado de "Select type" → **Web app**.
3. Description: `v1`.
4. **Execute as**: `Me (tu cuenta)`.
5. **Who has access**: `Anyone`.
6. Click **Deploy**.
7. Google pedirá permisos otra vez (acepta).
8. Copia la **Web app URL** — se ve así: `https://script.google.com/macros/s/AKfycb.../exec`.

## 5. Pegar la URL en el frontend

Abre `rezonant/index.html` y reemplaza:

```js
const WEBHOOK_URL = '[APPS_SCRIPT_WEBHOOK_URL]';
```

por la URL del paso 4:

```js
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

## 6. Probar end-to-end

1. Abre <http://localhost:8765/rezonant/> (o la URL de producción tras desplegar).
2. Completa el flow "Not yet" con un email real.
3. Verifica:
   - Llega email "You just got a seat" con botón Join Slack.
   - Llega email "Your 3,000 Rezonant credits are ready" con botón Claim my credits.
   - Aparece una fila en la pestaña `Signups` de la Google Sheet con todos los campos.
4. Repite con la rama "Yes, I'm a member" con un email distinto.
   - Llega solo el email de Rezonant credits.
   - Aparece fila en la pestaña `Members`.

## Cómo actualizar el script en el futuro

Cuando edites `Code.gs`:
1. Pega el código actualizado en el editor de Apps Script.
2. **Deploy** → **Manage deployments** → selecciona el deployment activo → ✏️ Edit → **Version: New version** → **Deploy**.
3. La URL del Web App **no cambia** entre versiones.

## Troubleshooting

- **`RESEND_API_KEY not set`** → falta el paso 2.
- **`Resend failed: 422`** → el `FROM_EMAIL` no está verificado en Resend, o el destinatario está en sandbox-only mode.
- **El POST no escribe en la sheet** → revisa que `SHEET_ID` en `Code.gs` matchee el de tu doc; revisa que el deployment esté "Who has access: Anyone".
- **CORS error en el browser** → es esperado con Apps Script; usamos `mode: 'no-cors'` en el fetch del frontend, así el browser no bloquea aunque la respuesta no sea legible.

## Estructura de la Google Sheet

El script crea automáticamente dos pestañas si no existen:

- **Signups** (rama B): `timestamp, firstname, lastname, email, country, city, linkedin, company, experience, role, motivation, source, consent`
- **Members** (rama A): `timestamp, email`
