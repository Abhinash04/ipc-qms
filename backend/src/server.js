const app = require('./app');
const env = require('./config/env');

app.listen(env.PORT, () => {
  console.log(`QMS backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});
