const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status).json({ error: err.message });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: 'Route not found' });
};

module.exports = {
  errorHandler,
  notFoundHandler
};