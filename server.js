// server.js
require('dotenv').config({
  path: './.env.local'
});
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const yaml = require('yaml');
const swaggerUi = require('swagger-ui-express');
const { auth } = require('express-oauth2-jwt-bearer');

// Import database configuration
const { pool, closePool } = require('./config/database');

// Import routes
const tournamentRoutes = require('./routes/tournaments');
const teamRoutes = require('./routes/teams');
const playerRoutes = require('./routes/players');
const sessionRoutes = require('./routes/sessions');
const matchRoutes = require('./routes/matches');
const playerStatisticsRoutes = require('./routes/playerStatistics');
const teamStatisticsRoutes = require('./routes/teamStatistics');

// Import middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT Authentication middleware (optional)
const jwtCheck = auth({
  audience: process.env.AUTH0_AUDIENCE || 'https://bowling-tournament-api.com',
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL || 'https://dev-kz81v58cw0fx3buw.us.auth0.com/',
  tokenSigningAlg: 'RS256'
});

// Basic middleware
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Swagger documentation
try {
  const file = fs.readFileSync('./bowling_api_oas.yaml', 'utf8');
  const swaggerDocument = yaml.parse(file);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log('Swagger documentation available at /api-docs');
} catch (error) {
  console.warn('Could not load Swagger documentation:', error.message);
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    const result = await pool.query('SELECT NOW() as server_time, version() as postgres_version');
    const dbStatus = result.rows[0];
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date(),
      message: 'Bowling Tournament API is running',
      database: {
        connected: true,
        server_time: dbStatus.server_time,
        postgres_version: dbStatus.postgres_version.split(' ')[0]
      },
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date(),
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// API Routes
// Uncomment the line below to enforce JWT authentication on all endpoints
// app.use('/api', jwtCheck);

app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/player-statistics', playerStatisticsRoutes);
app.use('/api/team-statistics', teamStatisticsRoutes);

// Error handling middleware
app.use(errorHandler);
app.use(notFoundHandler);

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Received shutdown signal, closing HTTP server...');
  
  try {
    await closePool();
    console.log('Database connections closed.');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const server = app.listen(PORT, () => {
  console.log(`🎳 Bowling Tournament API running on port ${PORT}`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Test database connection on startup
  pool.query('SELECT NOW() as connection_time')
    .then(result => {
      console.log(`🗄️  Database connected at: ${result.rows[0].connection_time}`);
    })
    .catch(error => {
      console.error('❌ Database connection failed:', error.message);
      console.error('Please check your database configuration in .env file');
    });
});

module.exports = app;