const express = require('express');
const cors = require('cors');
const tournamentRoutes = require('./routes/tournaments');
const teamRoutes = require('./routes/teams');
const playerRoutes = require('./routes/players');
const sessionRoutes = require('./routes/sessions');
//const leagueDayRoutes = require('./routes/leagueDays');
const matchRoutes = require('./routes/matches');
const playerStatisticsRoutes = require('./routes/playerStatistics');
const teamStatisticsRoutes = require('./routes/teamStatistics');
// const scoreRoutes = require('./routes/scores');
// const statisticsRoutes = require('./routes/statistics');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { auth } = require('express-oauth2-jwt-bearer');
const fs = require("fs")
//import { parse } from 'yaml'
const yaml = require('yaml');
const swaggerUi = require('swagger-ui-express');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const jwtCheck = auth({
  audience: 'https://bowling-tournament-api.com',
  issuerBaseURL: 'https://dev-kz81v58cw0fx3buw.us.auth0.com/',
  tokenSigningAlg: 'RS256'
});

app.use(express.json());
app.use(cors());

const file  = fs.readFileSync('./bowling_api_oas.yaml', 'utf8');
const swaggerDocument = yaml.parse(file);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    message: 'Bowling Tournament API is running'
  });
});

// Routes
// enforce on all endpoints
//app.use(jwtCheck);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('api/sessions', sessionRoutes);
app.use('api/matches', matchRoutes);
app.use('api/player-statistics', playerStatisticsRoutes);
app.use('api/team-statistics', teamStatisticsRoutes);
//app.use('/api/league-days', leagueDayRoutes);
// app.use('/api/scores', scoreRoutes);
// app.use('/api/statistics', statisticsRoutes);

// Error handling
app.use(errorHandler);
app.use(notFoundHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Bowling Tournament API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;