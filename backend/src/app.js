import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import env from './config/env.js';
import apiRoutes from './routes/index.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

// Behind a reverse proxy the client address is in X-Forwarded-For, and without
// this Express reports the proxy's address instead: `secure` cookies are then
// judged against a plaintext hop, and every rate-limit bucket collapses onto
// one key. `1` — trust one proxy — rather than `true`, which trusts any number
// of hops and lets a caller forge the header.
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

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
// Above Express's 100 kB default because POST /queries/reset carries a whole
// seed state, and a hydration-sized body is legitimate here. Still a ceiling:
// without one, an unauthenticated POST can make the process buffer without
// limit, since the body is parsed before any route's verifyToken runs.
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/**
 * Rate limiting — step 1 of the chain in .claude/backend-rules.md.
 *
 * Disabled under test: the suite fires hundreds of requests at these routes in
 * seconds and would trip the limiter rather than assert what it came to assert.
 */
if (env.NODE_ENV !== 'test') {
  // Sign-in is the credential-guessing surface. It is deliberately far tighter
  // than the general limit, and counts only failures so a working session's
  // reloads never lock its owner out.
  app.use(
    '/api/v1/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many sign-in attempts. Try again later.' },
    }),
  );

  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests. Slow down.' },
    }),
  );
}

app.use('/api/v1', apiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
