import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import env from './config/env.js';
import apiRoutes from './routes/index.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
// `credentials: true` is what lets the browser send the httpOnly session
// cookie across the dev origin boundary (5173 → 5000). It requires an explicit
// origin — a wildcard is rejected by the browser alongside credentials.
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
// Gzip JSON responses when the client advertises Accept-Encoding. The default
// filter already skips images and anything below 1 kB; attachment streams set
// their own Content-Type and are handled by the same filter.
app.use(compression());
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));
}
app.use(express.json());
app.use(cookieParser());

app.use('/api/v1', apiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
