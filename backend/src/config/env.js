import dotenv from 'dotenv';

dotenv.config();

const EMAIL_TRANSPORTS = { MOCK: 'mock', GMAIL: 'gmail' };

const env = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL || '',

  EMAIL_TRANSPORT: (process.env.EMAIL_TRANSPORT || EMAIL_TRANSPORTS.MOCK).toLowerCase(),

  IPC_QUERY_EMAIL: process.env.IPC_QUERY_EMAIL || 'ipc-query-mock@example.com',

  IPC_ACK_FROM_EMAIL: process.env.IPC_ACK_FROM_EMAIL || 'arnd-ipc-mock@example.com',
  IPC_ACK_FROM_NAME: process.env.IPC_ACK_FROM_NAME || 'AR&D Division',

  INQUIRER_EMAIL: process.env.INQUIRER_EMAIL || 'abhinash.pritiraj@gmail.com',
  INQUIRER_NAME: process.env.INQUIRER_NAME || 'Abhinash Pritiraj',

  GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID || '',
  GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET || '',
  GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN || '',
  GMAIL_REDIRECT_URI: process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground',
};

function validateEmailConfig(config = env) {
  const errors = [];

  if (!Object.values(EMAIL_TRANSPORTS).includes(config.EMAIL_TRANSPORT)) {
    errors.push(
      `EMAIL_TRANSPORT must be one of: ${Object.values(EMAIL_TRANSPORTS).join(', ')} (got "${config.EMAIL_TRANSPORT}")`,
    );
  }

  if (config.EMAIL_TRANSPORT === EMAIL_TRANSPORTS.GMAIL) {
    for (const key of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
      if (!config[key]) errors.push(`${key} is required when EMAIL_TRANSPORT=gmail`);
    }
  }

  if (!config.IPC_QUERY_EMAIL) errors.push('IPC_QUERY_EMAIL is required');

  return errors;
}

function assertValidEmailConfig(config = env) {
  const errors = validateEmailConfig(config);
  if (errors.length) {
    throw new Error(`Invalid email configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

export { EMAIL_TRANSPORTS, validateEmailConfig, assertValidEmailConfig };
export default env;
