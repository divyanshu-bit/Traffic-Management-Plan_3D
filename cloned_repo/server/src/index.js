const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const { testConnection, sequelize } = require('./config/database');
const { Project, Zone, Asset } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your frontend URL
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/exports', require('./routes/exportRoutes'));
app.use('/api/waze', require('./routes/wazeRoutes'));

// ─── REAL-TIME COLLABORATION (Presense & Live Editing) ─────────────────────
const projectPresense = {}; // reportId -> { socketId -> userDetails }

io.on('connection', (socket) => {
  console.log(`[REALTIME] Client connected: ${socket.id}`);

  socket.on('join-project', ({ reportId, user }) => {
    socket.join(reportId);
    if (!projectPresense[reportId]) projectPresense[reportId] = {};
    projectPresense[reportId][socket.id] = user;
    
    // Notify room of updated presence
    io.to(reportId).emit('presense-update', Object.values(projectPresense[reportId]));
    console.log(`[REALTIME] User ${user.name} joined project ${reportId}`);
  });

  socket.on('cursor-move', ({ reportId, lat, lng }) => {
    // Broadcast cursor position to others (excluding sender)
    socket.to(reportId).emit('peer-cursor', { socketId: socket.id, lat, lng });
  });

  socket.on('project-update', ({ reportId, updateType }) => {
    // Notify peers to reload or refresh specific data
    socket.to(reportId).emit('peer-update', { updateType });
  });

  socket.on('disconnect', () => {
    // Cleanup presense
    for (const reportId in projectPresense) {
      if (projectPresense[reportId][socket.id]) {
        delete projectPresense[reportId][socket.id];
        io.to(reportId).emit('presense-update', Object.values(projectPresense[reportId]));
        break;
      }
    }
    console.log(`[REALTIME] Client disconnected: ${socket.id}`);
  });
});

// Background Task: Waze Sync
const { syncWithWaze } = require('./services/wazeService');
const SYNC_INTERVAL = (process.env.WAZE_SYNC_INTERVAL || 3600) * 1000;

const startWazeSync = () => {
  console.log(`[WAZE SYNC] Auto-sync scheduled every ${SYNC_INTERVAL/1000} seconds.`);
  setInterval(async () => {
    try {
      await syncWithWaze();
    } catch (e) {
      console.error('[WAZE SYNC] Background sync failed:', e.message);
    }
  }, SYNC_INTERVAL);
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Marg Rakshak API is running' });
});

// Start Server
const startServer = async () => {
  try {
    await testConnection();
    await sequelize.sync({ alter: true });
    console.log('Database models synchronized.');

    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      startWazeSync(); // Start background sync
    });
  } catch (error) {
    console.error('Server failed to start due to database connection error:', error);
  }
};

startServer();
