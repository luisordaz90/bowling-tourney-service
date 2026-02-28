const logger = require('../config/logger');

const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Extract user email from auth token if available
  const userEmail = req.auth?.payload?.email || req.headers['x-user-email'] || 'anonymous';
  
  // Log incoming request
  logger.info({
    type: 'request_start',
    method: req.method,
    url: req.url,
    route: req.route?.path || req.url,
    userEmail,
    requestId: req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection?.remoteAddress,
    params: req.params,
    query: req.query,
    body: req.method !== 'GET' ? req.body : undefined
  }, `${req.method} ${req.url} - Request started`);

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body) {
    const duration = Date.now() - startTime;
    
    logger.info({
      type: 'request_complete',
      method: req.method,
      url: req.url,
      route: req.route?.path || req.url,
      userEmail,
      statusCode: res.statusCode,
      duration,
      responseSize: JSON.stringify(body).length
    }, `${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);

    return originalJson.call(this, body);
  };

  // Override res.status to capture error responses
  const originalStatus = res.status;
  res.status = function(code) {
    if (code >= 400) {
      const duration = Date.now() - startTime;
      logger.error({
        type: 'request_error',
        method: req.method,
        url: req.url,
        route: req.route?.path || req.url,
        userEmail,
        statusCode: code,
        duration
      }, `${req.method} ${req.url} - Error ${code} (${duration}ms)`);
    }
    return originalStatus.call(this, code);
  };

  next();
};

module.exports = requestLogger;