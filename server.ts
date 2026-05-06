import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import dotenv from 'dotenv';

// Load env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = process.env.PORT || 3000;

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Bridges to existing backend logic
  // We need to handle the fact that existing routes use require()
  // Since we are running with tsx/esm, we can still use dynamic import or just keep the server folder as is if we can.
  
  // For now, let's try to mock or include the routes.
  // The user project has a full backend in /server.
  // We'll point the routes there.
  
  // --- REAL-TIME COLLABORATION (from original server/index.js) ---
  const projectPresense: any = {}; 
  io.on('connection', (socket) => {
    console.log(`[REALTIME] Client connected: ${socket.id}`);
    socket.on('join-project', ({ reportId, user }: any) => {
      socket.join(reportId);
      if (!projectPresense[reportId]) projectPresense[reportId] = {};
      projectPresense[reportId][socket.id] = user;
      io.to(reportId).emit('presense-update', Object.values(projectPresense[reportId]));
    });
    socket.on('cursor-move', ({ reportId, lat, lng }: any) => {
      socket.to(reportId).emit('peer-cursor', { socketId: socket.id, lat, lng });
    });
    socket.on('project-update', ({ reportId, updateType }: any) => {
      socket.to(reportId).emit('peer-update', { updateType });
    });
    socket.on('disconnect', () => {
      for (const reportId in projectPresense) {
        if (projectPresense[reportId][socket.id]) {
          delete projectPresense[reportId][socket.id];
          io.to(reportId).emit('presense-update', Object.values(projectPresense[reportId]));
          break;
        }
      }
    });
  });

  // API Routes
  // We'll try to import the existing routes if possible, or just add a health check for now
  app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Marg Rakshak API is running' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
