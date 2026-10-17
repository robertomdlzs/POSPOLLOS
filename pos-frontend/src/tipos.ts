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

/** Un producto que se puede escoger en una parte de un combo */
export interface OpcionCombo {
  productoId: string;
  nombre: string;
  precioExtra: string;
  modificadores: GrupoModificador[];
}

/** Una parte de un combo ("Plato fuerte", "Bebida") */
export interface SeccionCombo {
  id: string;
  nombre: string;
  min: number;
  max: number;
  opciones: OpcionCombo[];
}

export interface Producto {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  imagenUrl: string | null;
  /** Se acabó durante el servicio: se muestra tachado y no se puede pedir */
  agotado: boolean;
  tipo: 'simple' | 'combo';
  /** Solo en los combos */
  secciones: SeccionCombo[];
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
  /** Si es parte de un combo, el ítem del combo y la parte en que se escogió */
  comboItemId: string | null;
  comboSeccion: string | null;
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
  /** Nombre del combo del que es parte, si lo es */
  combo: string | null;
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

// ------------------------------------------------------- panel de administración

export interface Pagina<T> {
  datos: T[];
  siguiente: string | null;
}

export interface SedeRol {
  sedeId: string;
  sede: string;
  rolId: string;
  rol: string;
}

export interface UsuarioAdmin {
  id: string;
  nombre: string;
  email: string | null;
  activo: boolean;
  tienePin: boolean;
  tieneContrasena: boolean;
  roles: SedeRol[];
}

export interface RolAdmin {
  id: string;
  nombre: string;
  descripcion: string | null;
  /** Clave de los roles de fábrica; null en los creados por el restaurante */
  clave: string | null;
  permisos: Permiso[];
  usuarios: number;
  editable: boolean;
}

export interface PermisoCatalogo {
  codigo: Permiso;
  grupo: string;
  descripcion: string;
}

export interface Sede {
  id: string;
  nombre: string;
}

export type TipoImpuesto = 'impoconsumo' | 'iva' | 'exento';

export interface CategoriaAdmin {
  id: string;
  nombre: string;
  orden: number;
  activa: boolean;
  productos: number;
}

export interface ProductoAdmin {
  id: string;
  nombre: string;
  descripcion: string | null;
  /** Precio general */
  precio: string;
  tipoImpuesto: TipoImpuesto;
  tasaImpuesto: string;
  controlaStock: boolean;
  activo: boolean;
  orden: number;
  imagenUrl: string | null;
  categoriaId: string;
  categoria: string;
  estacionId: string | null;
  estacion: string | null;
  /** Precio propio en la sede de la sesión, si tiene */
  precioSede: string | null;
  disponible: boolean;
  agotado: boolean;
  grupoIds: string[];
  /** Ya aparece en algún pedido: no se puede borrar, solo desactivar */
  vendido: boolean;
  tipo: 'simple' | 'combo';
  secciones: SeccionComboAdmin[];
}

export interface SeccionComboAdmin {
  id: string;
  nombre: string;
  min: number;
  max: number;
  opciones: { productoId: string; producto: string; precioExtra: string }[];
}

export interface OpcionAdmin {
  id: string;
  nombre: string;
  precioExtra: string;
  activo: boolean;
}

export interface GrupoAdmin {
  id: string;
  nombre: string;
  min: number;
  max: number;
  orden: number;
  opciones: OpcionAdmin[];
  productos: number;
}

export interface Estacion {
  id: string;
  nombre: string;
}
