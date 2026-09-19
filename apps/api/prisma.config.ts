import { defineConfig, env } from 'prisma/config';

// No .env auto-loading: callers must select the isolated fixture or approved migration job.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
