const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// Sends one receipt photo to Google's Gemini API (free tier, no card
// required) and asks for strict JSON back. Throws on any failure — the
// caller decides how to surface that.
async function extractReceipt(base64Image, mediaType) {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: base64Image } },
            {
              text:
                'Esta es una foto de una boleta o recibo chileno. Extrae el monto total pagado, ' +
                'el nombre del comercio y la fecha si aparece. Responde ÚNICAMENTE con JSON válido, ' +
                'sin texto adicional ni bloques de código, con esta forma exacta: ' +
                '{"amount": <entero en pesos chilenos sin signos ni puntos, o null si no estás seguro>, ' +
                '"merchant": "<nombre del comercio, o null>", "date": "<YYYY-MM-DD, o null>"}',
            },
          ],
        },
      ],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json && json.error && json.error.message) || `Gemini request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  const candidate = json.candidates && json.candidates[0];
  const text = (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No se pudo leer una respuesta válida del modelo');
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error('La respuesta del modelo no es JSON válido');
  }
  return {
    amount: Number.isFinite(parsed.amount) ? Math.round(parsed.amount) : null,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant.trim() : null,
    date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
  };
}

module.exports = { extractReceipt };
