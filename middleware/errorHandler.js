const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  logger.error({ err, url: req.originalUrl, method: req.method }, err.message);
  res.status(status).json({ error: err.message || 'Internal server error' });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: 'Route not found' });
};

module.exports = {
  errorHandler,
  notFoundHandler
};