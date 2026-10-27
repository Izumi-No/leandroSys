import 'dotenv/config';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const env = {
  port: int(process.env['PORT'], 3000),
  jwtSecret: process.env['JWT_SECRET'] ?? 'dev-secret',
  corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
};
