import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import env from './config/env.js';
import apiRoutes from './routes/index.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL }));
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));
}
app.use(express.json());

app.use('/api/v1', apiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
