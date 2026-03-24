import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes   from './routes/auth.js';
import foodsRoutes  from './routes/foods.js';
import mealsRoutes  from './routes/meals.js';
import diaryRoutes  from './routes/diary.js';
import uploadRoutes from './routes/upload.js';

// Initialise DB (runs schema + seeds admin user)
import './db.js';

const app  = express();
const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));

// Serve uploaded images as static files
const uploadsPath = process.env.UPLOADS_PATH || './uploads';
app.use('/uploads', express.static(uploadsPath));

// Routes
app.use('/api/auth',   authRoutes);
app.use('/api/foods',  foodsRoutes);
app.use('/api/meals',  mealsRoutes);
app.use('/api/diary',  diaryRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`NutriTrace API running on port ${PORT}`));
