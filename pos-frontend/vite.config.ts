import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, /api y el WebSocket se redirigen al backend (puerto 3000, o el
// de BACKEND_URL si hace falta probar contra otro servidor).
// host: true permite abrir la app desde una tablet o celular en la misma red.
// (el tsconfig del frontend no trae los tipos de Node, por eso el acceso a process así)
const entorno = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const backend = entorno.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
});
