import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

// Modelo por defecto para todas las tareas de IA (visión + razonamiento).
const MODEL = 'claude-opus-4-8';
const EXPENSE_CATEGORIES = ['supplies', 'rent', 'salary', 'utilities', 'other'];

let client = null;
function getClient() {
  if (!env.anthropicKey) {
    const err = new Error('ANTHROPIC_API_KEY no configurada');
    err.status = 503;
    err.code = 'AI_UNAVAILABLE';
    throw err;
  }
  client ??= new Anthropic({ apiKey: env.anthropicKey });
  return client;
}

// --- OCR de factura: foto → Expense estructurado -------------------------

const invoiceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    vendor: { type: 'string', description: 'Nombre del proveedor/comercio emisor' },
    date: { type: 'string', format: 'date', description: 'Fecha de la factura (YYYY-MM-DD)' },
    total: { type: 'number', description: 'Importe total a pagar' },
    currency: { type: 'string', description: 'Moneda (ej. ARS, USD)' },
    category: { type: 'string', enum: EXPENSE_CATEGORIES, description: 'Categoría de gasto sugerida' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          desc: { type: 'string' },
          qty: { type: 'number' },
          amount: { type: 'number' },
        },
        required: ['desc', 'amount'],
      },
    },
  },
  required: ['vendor', 'total', 'currency', 'category', 'items'],
};

// imageBase64: contenido de la foto en base64; mediaType: 'image/jpeg' | 'image/png' | ...
export async function ocrInvoice({ imageBase64, mediaType }) {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: invoiceSchema }, effort: 'low' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        {
          type: 'text',
          text: 'Esta es la foto de una factura/recibo de un comercio gastronómico. '
            + 'Extraé los datos como JSON estructurado. Si un dato no es legible, omitilo. '
            + 'El total debe ser el importe final a pagar. Categorizá según el tipo de gasto.',
        },
      ],
    }],
  });
  return parseJson(res);
}

// --- Categorización de un gasto ya cargado (sin foto) --------------------

const categorySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: EXPENSE_CATEGORIES },
    confidence: { type: 'number', description: 'Confianza 0..1' },
  },
  required: ['category', 'confidence'],
};

export async function categorizeExpense({ vendor, description, total }) {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 256,
    output_config: { format: { type: 'json_schema', schema: categorySchema }, effort: 'low' },
    messages: [{
      role: 'user',
      content: `Categorizá este gasto de un restaurante.\n`
        + `Proveedor: ${vendor || '(desconocido)'}\n`
        + `Detalle: ${description || '(sin detalle)'}\n`
        + `Total: ${total ?? '(desconocido)'}\n`
        + `Categorías posibles: ${EXPENSE_CATEGORIES.join(', ')}.`,
    }],
  });
  return parseJson(res);
}

// --- Forecast de ventas sobre histórico ----------------------------------

const forecastSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    forecast: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string', format: 'date' },
          expectedRevenue: { type: 'number' },
        },
        required: ['date', 'expectedRevenue'],
      },
    },
    summary: { type: 'string', description: 'Resumen en lenguaje natural para el comerciante' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['forecast', 'summary', 'confidence'],
};

// history: [{ date: 'YYYY-MM-DD', revenue: number, orders: number }], days: horizonte a proyectar
export async function forecastSales({ history, days = 7, currency = 'ARS' }) {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: forecastSchema }, effort: 'medium' },
    messages: [{
      role: 'user',
      content: `Sos analista de ventas de un restaurante. Moneda ${currency}. `
        + `A partir de este histórico diario de ventas, proyectá los próximos ${days} días. `
        + `Considerá tendencia y estacionalidad por día de la semana. `
        + `Devolvé el forecast estructurado y un resumen claro para el dueño.\n\n`
        + `Histórico (JSON):\n${JSON.stringify(history)}`,
    }],
  });
  return parseJson(res);
}

// El SDK puebla parsed_output cuando se usa output_config.format; con fallback a parsear el texto.
function parseJson(res) {
  if (res.parsed_output) return res.parsed_output;
  const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}
