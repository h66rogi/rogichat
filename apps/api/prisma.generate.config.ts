import { defineConfig } from 'prisma/config';

// Client generation is offline and needs no runtime/migration credential or .env.
export default defineConfig({ schema: 'prisma/schema.prisma' });
