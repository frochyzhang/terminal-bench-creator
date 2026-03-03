import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
  encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef',
  tasksDir: resolve(__dirname, '../../tasks'),
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'tb_station',
    user: process.env.POSTGRES_USER || 'tbuser',
    password: process.env.POSTGRES_PASSWORD || 'tbpassword',
  },
};
