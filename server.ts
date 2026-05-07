import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  const PORT = process.env.PORT || 3000;

  // FIX #1: Replaced the wildcard CORS origin ("*") with an explicit allowlist
  // driven by environment variables. A wildcard origin on a Socket.io server
  // that also serves authenticated API routes is a security risk — any website
  // could make credentialed cross-origin requests. In development the Vite dev
  // server origin is allowed automatically; in production set CORS_ORIGIN in
  // your environment (comma-separated for multiple origins).
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : process.env.NODE_ENV !== 'production'
      ? [`http://localhost:${PORT}`, 'http://localhost:5173']
      : [];

  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. server-to-server, curl)
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

  // FIX #2: Renamed projectPresense → projectPresence (typo fix).
  // Also typed the map properly so TypeScript can catch shape mismatches.
  const projectPresence: Record<string, Record<string, unknown>> = {};

  io.on('connection', (socket) => {
    console.log(`[REALTIME] Client connected: ${socket.id}`);

    socket.on('join-project', ({ reportId, user }: { reportId: string; user: unknown }) => {
      // FIX #3: Validate that reportId is a non-empty string before using it
      // as a room name. A missing or malformed reportId would create phantom
      // rooms and cause presence-update broadcasts to go to wrong clients.
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
      // FIX #4: Only broadcast cursor-move if the socket is actually in the
      // room. Without this check a malicious client could emit cursor-move for
      // any reportId and spam other users' sessions.
      if (!socket.rooms.has(reportId)) return;
      socket.to(reportId).emit('peer-cursor', { socketId: socket.id, lat, lng });
    });

    socket.on('project-update', ({ reportId, updateType }: { reportId: string; updateType: string }) => {
      if (!socket.rooms.has(reportId)) return;
      socket.to(reportId).emit('peer-update', { updateType });
    });

    socket.on('disconnect', () => {
      // Clean up presence for this socket across all rooms it was in
      for (const reportId in projectPresence) {
        if (projectPresence[reportId][socket.id]) {
          delete projectPresence[reportId][socket.id];
          io.to(reportId).emit('presence-update', Object.values(projectPresence[reportId]));
          // FIX #5: Removed the early `break` — a socket can join multiple
          // rooms (e.g. a project + a global room), so we must clean up all of
          // them, not just the first match.
        }
      }
    });
  });

  // API Routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'OK', message: 'Marg Rakshak API is running' });
  });

  // Development: Vite middleware for HMR and asset serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve the pre-built frontend
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // FIX #6: Catch-all must come after all API routes so that API 404s are
    // not silently swallowed by the SPA fallback. Moved to end of route chain.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[SERVER] Running at http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
    if (allowedOrigins.length > 0) {
      console.log(`[SERVER] CORS allowed origins: ${allowedOrigins.join(', ')}`);
    }
  });
}

startServer().catch(err => {
  console.error('[SERVER] Failed to start:', err);
  process.exit(1);
});