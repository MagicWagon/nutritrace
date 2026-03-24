import { Router } from 'express';

const router = Router();

// Whitelist: only these external hosts may be proxied
const ALLOWED = ['world.openfoodfacts.org', 'api.nal.usda.gov'];

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const parsed = new URL(url);
    if (!ALLOWED.includes(parsed.hostname)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: 'Upstream error' });
    res.json(await response.json());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
