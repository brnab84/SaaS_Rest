# RestaurApp — Importar catálogo de WhatsApp (extensión de Chrome)

Lee los productos del **catálogo abierto en WhatsApp Web** y los **importa directo a tu
cuenta de RestaurApp**: nombre, precio, descripción, categoría e **imagen**. Sin CSV.

> Usa tu propia sesión: un "bridge" corre en la pestaña de RestaurApp y copia tu token a
> la extensión. No envía datos a terceros; solo crea productos en tu cuenta.

## Instalar
1. Descargá el .zip desde la app: **Menú → 🧩 Extensión WhatsApp → Descargar extensión**.
2. Descomprimilo en una carpeta.
3. Chrome → `chrome://extensions` → activá **Modo de desarrollador**.
4. **Cargar descomprimida** → elegí la carpeta.

## Usar
1. Dejá **RestaurApp abierta y con sesión iniciada** en una pestaña (la extensión usa esa sesión).
2. Abrí **https://web.whatsapp.com** y abrí el **catálogo**.
3. Botón **🍽️ RestaurApp** (abajo a la derecha).
   - **Leer visible**: toma los productos en pantalla (scrolleá para cargar más).
   - **Modo clic**: tocá cada producto de a uno.
4. Revisá/edita la lista (nombre, precio, categoría).
5. **Importar a RestaurApp** → crea los productos en tu Menú (sube las imágenes a tu cuenta).

## Notas y límites
- WhatsApp Web tiene el HTML **ofuscado y cambia seguido**; la detección es heurística.
  Si algún producto no sale con "Leer visible", usá **Modo clic**.
- Si no aparece "Conectado a tu sesión", abrí/logueate en RestaurApp en otra pestaña.
- Las imágenes que WhatsApp sirve sin permiso de origen cruzado pueden no importarse; el
  producto igual se crea (sin foto). Avisá con una captura para ajustar.
- Respeta el **límite de productos de tu plan** (si lo superás, frena con aviso).

## Desarrollo
El paquete se versiona desde `extension/wa-catalog/manifest.json`. Para regenerar el .zip
descargable: `powershell -ExecutionPolicy Bypass -File scripts/build-ext.ps1`
(genera `public/downloads/restaurapp-wa-catalog-v<version>.zip` + `ext-version.json`).
