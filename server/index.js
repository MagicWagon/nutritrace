import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import proxyRoutes  from './routes/proxy.js';
import foodsRoutes  from './routes/foods.js';
import mealsRoutes  from './routes/meals.js';
import diaryRoutes  from './routes/diary.js';
import uploadRoutes from './routes/upload.js';

// Initialise DB (runs schema + seeds admin user)
import './db.js';

const app  = express();
const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '10mb' }));

// Serve uploaded images
const uploadsPath = process.env.UPLOADS_PATH || './uploads';
app.use('/uploads', express.static(uploadsPath));

// API routes
app.use('/api/proxy',  proxyRoutes);
app.use('/api/foods',  foodsRoutes);
app.use('/api/meals',  mealsRoutes);
app.use('/api/diary',  diaryRoutes);
app.use('/api/upload', uploadRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve Svelte frontend (production build)
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback — all non-API routes return index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`NutriTrace running on port ${PORT}`));
