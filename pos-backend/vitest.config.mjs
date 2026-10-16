import { defineConfig } from 'vitest/config';

// Pruebas unitarias: no tocan la base de datos. config.ts exige estas variables
// al importarse, así que se fijan aquí con valores de prueba.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    env: {
      DATABASE_URL: 'postgres://prueba:prueba@localhost:1/no-se-usa',
      JWT_SECRET: 'secreto-solo-para-pruebas-unitarias-0123456789',
      ACCESS_TTL_SECONDS: '900',
    },
  },
});
