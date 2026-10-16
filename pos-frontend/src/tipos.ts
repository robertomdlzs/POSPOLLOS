import type { Permiso } from './permisos';

export interface UsuarioLista {
  id: string;
  nombre: string;
  rolNombre: string;
  /** Su rol configura el restaurante: entra con correo y contraseña, no con PIN */
  conContrasena: boolean;
}

export interface Sesion {
  accessToken: string;
  refreshToken: string;
  usuario: { id: string; nombre: string; rolNombre: string; permisos: Permiso[]; sedeId: string };
}

export interface Opcion {
  id: string;
  nombre: string;
  precioExtra: string;
}

export interface GrupoModificador {
  id: string;
  nombre: string;
  min: number;
  max: number;
  opciones: Opcion[];
}

export interface Producto {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  imagenUrl: string | null;
  categoriaId: string;
  categoria: string;
  modificadores: GrupoModificador[];
}

export interface Mesa {
  id: string;
  numero: string;
  capacidad: number;
  estado: 'libre' | 'ocupada' | 'reservada' | 'inactiva';
  zona: string | null;
  pedidoAbiertoId: string | null;
}

export type TipoServicio = 'mesa' | 'mostrador' | 'domicilio' | 'para_llevar';
export type EstadoItem = 'pendiente' | 'preparando' | 'listo' | 'entregado' | 'anulado';

export interface ItemPedido {
  id: string;
  productoId: string;
  producto: string;
  cantidad: string;
  precioUnitario: string;
  extras: string;
  notas: string | null;
  estado: EstadoItem;
  enviadoCocinaEn: string | null;
  motivoAnulacion: string | null;
  modificadores: { nombre: string; precioExtra: string }[];
}

export interface Pedido {
  id: string;
  numero: string;
  tipoServicio: TipoServicio;
  estado: 'abierto' | 'en_cocina' | 'servido' | 'pagado' | 'anulado';
  mesaId: string | null;
  mesa: string | null;
  mesero: string | null;
  clienteNombre: string | null;
  clienteTelefono: string | null;
  direccionEntrega: string | null;
  items: ItemPedido[];
  totales: { subtotal: string; impuestos: string; total: string };
}

export interface PedidoResumen {
  id: string;
  numero: string;
  tipoServicio: TipoServicio;
  estado: Pedido['estado'];
  mesa: string | null;
  clienteNombre: string | null;
  creadoEn: string;
  items: number;
}

export interface ItemComanda {
  id: string;
  pedidoId: string;
  numero: string;
  tipoServicio: TipoServicio;
  mesa: string | null;
  producto: string;
  cantidad: string;
  notas: string | null;
  estado: EstadoItem;
  enviadoEn: string;
  estacionId: string | null;
  estacion: string | null;
  modificadores: string[];
}

export interface Autorizacion {
  supervisorId: string;
  pin: string;
}

export interface ResumenTurno {
  ventas: number;
  /** No llega en caja a ciegas (cajero con el turno abierto) */
  totalVentas?: string;
  propinas: string;
  anuladas: number;
  /** No llega en caja a ciegas */
  efectivo?: string;
  porMetodo: Record<string, string>;
  ingresos: string;
  egresos: string;
}

export interface Turno {
  id: string;
  caja: string;
  abierto_en: string;
  monto_inicial: string;
  /** true si quien consulta no puede ver el efectivo esperado */
  ciego: boolean;
  resumen: ResumenTurno;
}

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'daviplata' | 'otro';

export interface Venta {
  id: string;
  numeroPedido: string;
  total: string;
  cambio: string;
}
