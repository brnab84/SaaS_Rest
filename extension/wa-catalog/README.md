# RestaurApp — Lector de catálogo de WhatsApp (extensión de Chrome)

Lee los productos del **catálogo abierto en WhatsApp Web** y los exporta a un **CSV**
con columnas `nombre, precio, categoria, descripcion`, listo para subir en
**RestaurApp → Menú → Importar CSV**.

> Funciona sobre tu propia cuenta/catálogo, en tu navegador. No envía nada a ningún
> servidor: solo genera un archivo CSV en tu PC.

## Instalar (modo desarrollador)
1. Abrí Chrome → `chrome://extensions`
2. Activá **"Modo de desarrollador"** (arriba a la derecha).
3. Clic en **"Cargar descomprimida"** y elegí esta carpeta (`extension/wa-catalog`).
4. Listo: ya queda instalada.

## Usar
1. Entrá a **https://web.whatsapp.com** e iniciá sesión.
2. Abrí el **catálogo** (el de tu negocio o el de otra cuenta que estés viendo).
3. Abajo a la derecha aparece el botón **🍽️ RestaurApp**. Tocalo.
4. Elegí:
   - **Leer visible**: toma todos los productos que estén en pantalla. Scrolleá el
     catálogo para que carguen más y volvé a tocar "Leer visible".
   - **Modo clic**: tocá cada producto que quieras agregar (de a uno). Volvé a tocar
     el botón para apagarlo.
5. Revisá/edita la lista (nombre, precio, categoría). Podés borrar los que no quieras.
6. Tocá **Descargar CSV**.
7. En RestaurApp: **Menú → Importar CSV** y subí el archivo.

## Notas y límites
- WhatsApp Web tiene el HTML **ofuscado y cambia seguido**, así que la detección usa
  heurísticas (patrones de precio + estructura). Si algún producto no se detecta con
  "Leer visible", usá **Modo clic**.
- El **CSV de RestaurApp importa nombre, precio y categoría**; la descripción se incluye
  en el archivo como referencia pero hoy no se importa por CSV.
- Si los precios salen mal, avisá con una captura del producto en WhatsApp Web para
  ajustar el patrón de moneda.
