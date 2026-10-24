import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/pottery-wheel/',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
