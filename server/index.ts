/**
 * Inventory — Inventory Management Module
 *
 * Entry point. Single Azure App Service hosts both the API and the React frontend.
 * Backend mounts all /api routes behind a facility-context middleware.
 * Frontend static files served from ./public (populated at deploy time from client/dist).
 */

import 'dotenv/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { facilityContext } from './middleware/facility-context';
import { rateLimit } from './middleware/rate-limit';
import { registerAuthRoutes } from './routes/auth';
import { registerItemsRoutes } from './routes/items';
import { registerStorageLocationRoutes } from './routes/storage-locations';
import { registerAllergenRoutes } from './routes/allergens';
import { registerAllergenDetectionRoutes } from './routes/allergen-detection';
import { registerUsdaRoutes } from './routes/usda';
import { registerVendorRoutes } from './routes/vendors';
import { registerImportRoutes } from './routes/import';
import { registerReceivingRoutes } from './routes/receiving';
import { log } from './utils/logger';

// ── Startup environment validation ─────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const RECOMMENDED_ENV = ['ANTHROPIC_API_KEY', 'USDA_API_KEY'];

function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const missing: string[] = [];

  for (const key of REQUIRED_ENV) {
    const val = process.env[key];
    if (!val || val.trim().length === 0) missing.push(key);
  }

  if (missing.length > 0) {
    const msg = `[FATAL] Missing required environment variables: ${missing.join(', ')}`;
    console.error(msg);
    if (isProd) process.exit(1);
    log.warn(msg + ' — non-production, continuing with reduced functionality');
  }

  for (const key of RECOMMENDED_ENV) {
    const val = process.env[key];
    if (!val || val.trim().length === 0) {
      log.warn(`${key} is not set — the related feature will be unavailable`);
    }
  }

  if (process.env.DEMO_MODE === 'true') {
    if (isProd) {
      log.warn('DEMO_MODE=true is set in production. Demo auto-login is LIVE.');
    } else {
      log.event('DEMO_MODE enabled — demo auto-login endpoint is active');
    }
  }
}

validateEnv();

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins, credentials: false }));
app.use(express.json({ limit: '10mb' })); // larger for file imports

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, name: 'apiLimit' });
app.use('/api', apiLimiter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'Inventory', version: '0.1.0', timestamp: new Date().toISOString() });
});

app.use('/api', facilityContext);

registerAuthRoutes(app);
registerItemsRoutes(app);
registerStorageLocationRoutes(app);
registerAllergenRoutes(app);
registerAllergenDetectionRoutes(app);
registerUsdaRoutes(app);
registerVendorRoutes(app);
registerImportRoutes(app);
registerReceivingRoutes(app);

app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  }
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) {
      res
        .status(200)
        .send(
          '<html><body><h1>Inventory API</h1><p>Backend is running. In dev: run <code>cd client &amp;&amp; npm run dev</code> and visit <a href="http://localhost:5173">http://localhost:5173</a>.</p></body></html>',
        );
    }
  });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const errorId = Math.random().toString(36).slice(2, 10);
  log.error(err, { errorId, method: req.method, path: req.path });
  res.status(500).json({ error: 'Internal server error', errorId });
});

app.listen(PORT, () => {
  log.event(`Inventory server listening on port ${PORT}`);
  log.event(`CORS origins: ${corsOrigins.join(', ')}`);
  log.event(`Static frontend: ${publicDir}`);
});
