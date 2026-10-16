import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, /api y el WebSocket se redirigen al backend en el puerto 3000.
// host: true permite abrir la app desde una tablet o celular en la misma red.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
