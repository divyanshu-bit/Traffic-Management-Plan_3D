import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
dotenv.config();

const { testConnection, sequelize } = require('./server/config/database');
const projectRoutes = require('./server/routes/projectRoutes');
const exportRoutes = require('./server/routes/exportRoutes');
const wazeRoutes = require('./server/routes/wazeRoutes');
const { syncWithWaze } = require('./server/services/wazeService');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  const PORT = process.env.PORT || 3000;

  // Background Task: Waze Sync
  const SYNC_INTERVAL = (Number(process.env.WAZE_SYNC_INTERVAL) || 3600) * 1000;
  const startWazeSync = () => {
    console.log(`[WAZE SYNC] Auto-sync scheduled every ${SYNC_INTERVAL / 1000} seconds.`);
    setInterval(async () => {
      try {
        await syncWithWaze();
      } catch (e: any) {
        console.error('[WAZE SYNC] Background sync failed:', e.message);
      }
    }, SYNC_INTERVAL);
  };

  // CORS Configuration
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : process.env.NODE_ENV !== 'production'
      ? [`http://localhost:${PORT}`, 'http://localhost:5173']
      : [];

  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  };

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    }
  });

  // Middleware
  app.use(cors(corsOptions));
  app.use(express.json());

  // API Routes
  app.use('/api/projects', projectRoutes);
  app.use('/api/exports', exportRoutes);
  app.use('/api/waze', wazeRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'OK', message: 'Marg Rakshak API is running' });
  });

  // Real-time Collaboration
  const projectPresence: Record<string, Record<string, unknown>> = {};

  io.on('connection', (socket) => {
    console.log(`[REALTIME] Client connected: ${socket.id}`);

    socket.on('join-project', ({ reportId, user }: { reportId: string; user: any }) => {
      if (!reportId || typeof reportId !== 'string') {
        console.warn(`[REALTIME] join-project rejected: invalid reportId from ${socket.id}`);
        return;
      }
      socket.join(reportId);
      if (!projectPresence[reportId]) projectPresence[reportId] = {};
      projectPresence[reportId][socket.id] = user;
      io.to(reportId).emit('presence-update', Object.values(projectPresence[reportId]));
    });

    socket.on('cursor-move', ({ reportId, lat, lng }: { reportId: string; lat: number; lng: number }) => {
      if (!socket.rooms.has(reportId)) return;
      socket.to(reportId).emit('peer-cursor', { socketId: socket.id, lat, lng });
    });

    socket.on('project-update', ({ reportId, updateType }: { reportId: string; updateType: string }) => {
      if (!socket.rooms.has(reportId)) return;
      socket.to(reportId).emit('peer-update', { updateType });
    });

    socket.on('disconnect', () => {
      for (const reportId in projectPresence) {
        if (projectPresence[reportId][socket.id]) {
          delete projectPresence[reportId][socket.id];
          io.to(reportId).emit('presence-update', Object.values(projectPresence[reportId]));
        }
      }
    });
  });

  // Development: Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Database Connection and Server Start
  try {
    await testConnection();
    await sequelize.sync({ alter: true });
    console.log('[DB] Database models synchronized.');

    httpServer.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`[SERVER] Running at http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
      startWazeSync();
    });
  } catch (error) {
    console.error('[SERVER] Failed to start due to database connection error:', error);
    // Still start the server if DB fails? Maybe not, but for preview we might want to see the UI
    httpServer.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`[SERVER] Running at http://localhost:${PORT} (WITHOUT DATABASE)`);
    });
  }
}

startServer().catch(err => {
  console.error('[SERVER] Global failure:', err);
  process.exit(1);
});