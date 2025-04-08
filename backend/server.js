const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('./config/db');
const apiRoutes = require('./routes/api');
const { initializeMonitoring } = require('./services/monitorService');

connectDB(); // Connect to DB, exits on fail

const app = express();

// Middleware
app.use(cors()); // Configure origins in production!
app.use(express.json());
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`); next(); }); // Basic logging

// API Routes
app.use('/api', apiRoutes);

// Root health check
app.get('/', (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || 'unknown';
    res.send(`Solana Monitor Backend Running. DB Status: ${dbStatus}`);
});

const PORT = process.env.PORT || 10000;

const startServer = async () => {
     try {
         await initializeMonitoring(); // Setup background tasks

         const server = app.listen(PORT, () => {
             console.log(`=================================================`);
             console.log(` Server running on port ${PORT}`);
             console.log(` Local: http://localhost:${PORT}`);
             console.log(`=================================================`);
         });

         const shutdown = (signal) => {
             console.info(`\n[${signal}] Received. Shutting down...`);
             server.close(async () => {
                 console.log('HTTP server closed.');
                 try { await mongoose.connection.close(); console.log('MongoDB closed.'); process.exit(0); }
                 catch (err) { console.error('MongoDB close error:', err); process.exit(1); }
             });
             setTimeout(() => { console.error('Shutdown timed out. Forcing exit.'); process.exit(1); }, 10000); // 10s timeout
         };
         process.on('SIGTERM', () => shutdown('SIGTERM'));
         process.on('SIGINT', () => shutdown('SIGINT'));
     } catch (error) { console.error("FATAL Start Error:", error); process.exit(1); }
 };

startServer(); // Start the application