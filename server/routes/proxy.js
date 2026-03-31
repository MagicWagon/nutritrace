import { Router } from 'express';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Whitelist: only these external hosts may be proxied
const ALLOWED = ['world.openfoodfacts.org', 'search.openfoodfacts.org', 'api.nal.usda.gov'];

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const parsed = new URL(url);
    if (!ALLOWED.includes(parsed.hostname)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NutriTrace/1.0)' },
    });
    clearTimeout(timer);
    if (!response.ok) {
      logger.warn(`[proxy] upstream ${response.status} for ${url}`);
      return res.status(response.status).json({ error: `Upstream ${response.status}` });
    }
    res.json(await response.json());
  } catch(e) {
    logger.error('[proxy] fetch error:', e.message, 'url:', url);
    res.status(503).json({ error: e.message });
  }
});

export default router;
