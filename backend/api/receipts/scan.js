const { withCors } = require('../../lib/cors');
const { requireUser } = require('../../lib/auth');
const { extractReceipt } = require('../../lib/gemini');

const MAX_BASE64_LENGTH = 6_000_000; // ~4.5MB decoded, the Vercel Node function body cap

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'El escaneo de recibos no está configurado todavía.' });
  }

  const { image, mediaType } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'missing_image' });
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return res.status(413).json({ error: 'image_too_large' });
  }
  const safeMediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(mediaType) ? mediaType : 'image/jpeg';

  try {
    const result = await extractReceipt(image, safeMediaType);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'scan_failed', message: err.message });
  }
};
