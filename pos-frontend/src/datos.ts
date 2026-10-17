import { QueryClient, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, mensajeError } from './api';
import { canalCocina } from './socket';

/**
 * Caché de lo que viene del servidor. Cada recurso tiene su clave; cuando algo
 * cambia (por el WebSocket o por una acción propia) se invalida esa clave y
 * todas las pantallas que la usan se actualizan solas.
 */
export const clienteDatos = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Un 401/403/404 no se arregla reintentando; un corte de red, sí
      retry: (fallos, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && fallos < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const CLAVES = {
  usuarios: ['usuarios'],
  autorizadores: (permiso: string) => ['autorizadores', permiso],
  menu: ['menu'],
  mesas: ['mesas'],
  pedidos: ['pedidos'],
  pedido: (id: string) => ['pedido', id],
  turno: ['turno'],
  cocina: ['cocina'],
  admin: {
    usuarios: ['admin', 'usuarios'],
    usuario: (id: string) => ['admin', 'usuarios', id],
    roles: ['admin', 'roles'],
    categorias: ['admin', 'categorias'],
    productos: ['admin', 'productos'],
    producto: (id: string) => ['admin', 'productos', id],
    grupos: ['admin', 'grupos'],
    estaciones: ['admin', 'estaciones'],
    permisos: ['admin', 'permisos'],
    sedes: ['admin', 'sedes'],
  },
} as const;

interface Opciones {
  /** false mientras falte algo para poder cargar (por ejemplo, un pedido sin id) */
  habilitado?: boolean;
  /** Cuánto tiempo los datos se dan por frescos, en ms */
  frescura?: number;
  /** Recarga periódica, en ms, por si se perdió algún aviso en tiempo real */
  cada?: number;
}

/** Datos del servidor con estado de carga y error, guardados en la caché común */
export function useDatos<T>(clave: QueryKey, cargar: () => Promise<T>, opciones: Opciones = {}) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: clave,
    queryFn: cargar,
    enabled: opciones.habilitado ?? true,
    staleTime: opciones.frescura,
    refetchInterval: opciones.cada,
  });
  return {
    datos: (q.data ?? null) as T | null,
    error: q.error ? mensajeError(q.error) : null,
    cargando: q.isPending && (opciones.habilitado ?? true),
    recargar: () => cliente.invalidateQueries({ queryKey: clave }),
  };
}

/** Marca como viejo un recurso para que todas las pantallas que lo muestran lo pidan de nuevo */
export const invalidar = (...claves: QueryKey[]) =>
  Promise.all(claves.map((queryKey) => clienteDatos.invalidateQueries({ queryKey })));

/**
 * Escucha lo que pasa en cocina e invalida lo que cambió. Un solo lugar para
 * todas las pantallas, en vez de que cada una recargue por su cuenta.
 */
export function useTiempoReal() {
  useEffect(() => {
    const canal = canalCocina();
    const deItems = (e: { pedidoId?: string }) =>
      invalidar(CLAVES.cocina, CLAVES.pedidos, CLAVES.mesas, ...(e.pedidoId ? [CLAVES.pedido(e.pedidoId)] : []));
    // Al reconectar pudo perderse algún evento: se refresca todo
    const reconectado = () => clienteDatos.invalidateQueries();
    canal.on('comanda.nueva', deItems);
    canal.on('item.estado', deItems);
    canal.on('item.anulado', deItems);
    canal.on('connect', reconectado);
    // Cambió el menú (un precio, un producto nuevo, un agotado): las tablets lo recargan
    const menu = () => invalidar(CLAVES.menu, CLAVES.admin.productos);
    canal.on('menu.cambio', menu);
    return () => {
      canal.off('menu.cambio', menu);
      canal.off('comanda.nueva', deItems);
      canal.off('item.estado', deItems);
      canal.off('item.anulado', deItems);
      canal.off('connect', reconectado);
    };
  }, []);
}
