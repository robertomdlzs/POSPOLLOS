import { io, type Socket } from 'socket.io-client';
import { BASE, obtenerSesion, refrescar } from './api';

let socket: Socket | null = null;

/** Conexión única al canal de cocina; toma el token vigente en cada reconexión */
export function canalCocina(): Socket {
  if (socket) return socket;
  const s = io(`${BASE}/cocina`, {
    auth: (cb) => cb({ token: obtenerSesion()?.accessToken }),
    transports: ['websocket'],
  });
  // Si el servidor nos saca (token vencido), renovamos y volvemos a entrar
  s.on('disconnect', async (razon) => {
    if (razon === 'io server disconnect' && (await refrescar())) s.connect();
  });
  socket = s;
  return s;
}

export function cerrarCanal() {
  socket?.disconnect();
  socket = null;
}
