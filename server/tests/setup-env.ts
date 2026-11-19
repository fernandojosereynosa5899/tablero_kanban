// Configura entorno aislado antes de que config.ts cargue server/.env (dotenv no sobrescribe claves ya definidas).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-jwt-secret-minimum-32-characters-long';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:5432/unused';
process.env.MAIL_DISABLED = '1';
process.env.MAIL_NOTIFY_TO = 'notify@example.com';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
process.env.GOOGLE_REFRESH_TOKEN = '';
