import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { alCambiarSesion, cerrarSesion, obtenerSesion } from './api';
import { ProveedorAvisos, useAvisar } from './componentes/Avisos';
import { Bloqueo, useInactividad } from './componentes/Bloqueo';
import { EstadoVacio } from './componentes/EstadoVacio';
import { clienteDatos, useTiempoReal } from './datos';
import { Admin } from './pantallas/admin/Admin';
import { Caja } from './pantallas/Caja';
import { Cocina } from './pantallas/Cocina';
import { Ingreso } from './pantallas/Ingreso';
import { Mesas, type AbrirPedido } from './pantallas/Mesas';
import { Pedido } from './pantallas/Pedido';
import { cerrarCanal, canalCocina } from './socket';
import { ProveedorPermisos, type Permiso } from './permisos';
import type { Sesion } from './tipos';
import { cant } from './util';

type Seccion = 'mesas' | 'caja' | 'cocina' | 'admin';

/** Cada sección se ve si el rol tiene su permiso, en este orden */
const SECCIONES: { seccion: Seccion; permiso: Permiso; nombre: string }[] = [
  { seccion: 'mesas', permiso: 'pedido.tomar', nombre: 'Mesas' },
  { seccion: 'caja', permiso: 'caja.operar', nombre: 'Caja' },
  { seccion: 'cocina', permiso: 'cocina.operar', nombre: 'Cocina' },
];
const PERMISOS_ADMIN: Permiso[] = ['menu.editar', 'salon.editar', 'usuario.editar', 'rol.editar', 'config.editar'];
const NOMBRE_SECCION: Record<Seccion, string> = {
  ...(Object.fromEntries(SECCIONES.map((s) => [s.seccion, s.nombre])) as Record<Exclude<Seccion, 'admin'>, string>),
  admin: 'Administración',
};

/** Lo que viaja en el estado de la navegación al abrir un pedido */
interface EstadoPedido {
  contexto: AbrirPedido;
  /** Identifica esta apertura: se conserva cuando el pedido nuevo pasa a tener id */
  clave: number;
}

export function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={clienteDatos}>
        <ProveedorAvisos>
          <Raiz />
        </ProveedorAvisos>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

function Raiz() {
  const [sesion, setSesion] = useState<Sesion | null>(obtenerSesion());
  const navegar = useNavigate();
  useEffect(() => alCambiarSesion(setSesion), []);

  // Al salir, el canal en tiempo real se cierra, la caché se vacía (lo que vio
  // un usuario no lo hereda el siguiente) y quien entre empieza en su inicio
  useEffect(() => {
    if (!sesion) {
      cerrarCanal();
      clienteDatos.clear();
      navegar('/', { replace: true });
    }
  }, [sesion, navegar]);

  return sesion ? (
    <ProveedorPermisos permisos={sesion.usuario.permisos}>
      <Trabajo key={sesion.usuario.id} sesion={sesion} />
    </ProveedorPermisos>
  ) : (
    <Ingreso />
  );
}

function Trabajo({ sesion }: { sesion: Sesion }) {
  const avisar = useAvisar();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const { nombre, rolNombre, permisos } = sesion.usuario;
  const administra = PERMISOS_ADMIN.some((p) => permisos.includes(p));
  const secciones: Seccion[] = [...SECCIONES.filter((s) => permisos.includes(s.permiso)).map((s) => s.seccion), ...(administra ? ['admin' as const] : [])];
  const inicio = secciones.length ? `/${secciones[0]}` : '/sin-secciones';
  const soloCocina = secciones.length === 1 && secciones[0] === 'cocina';
  const toma = permisos.includes('pedido.tomar');
  // La pantalla de cocina se mira más de lo que se toca: no se bloquea
  const [bloqueada, desbloquear] = useInactividad(!soloCocina);
  useTiempoReal();

  // Quienes toman pedidos se enteran cuando un plato sale de cocina
  useEffect(() => {
    if (!toma) return;
    const canal = canalCocina();
    const alListo = (e: { estado: string; producto?: string; cantidad?: string; mesa?: string | null; numero?: string }) => {
      if (e.estado !== 'listo' || !e.producto) return;
      const donde = e.mesa ? `la mesa ${e.mesa}` : `el pedido #${e.numero}`;
      avisar(`Listo para ${donde}: ${cant(e.cantidad ?? 1)} ${e.producto}`, 'listo');
    };
    canal.on('item.estado', alListo);
    return () => {
      canal.off('item.estado', alListo);
    };
  }, [toma, avisar]);

  /** Solo deja ver la sección si el rol la tiene; si no, lo lleva a su inicio */
  const conPermiso = (s: Seccion, elemento: ReactNode) => (secciones.includes(s) ? elemento : <Navigate to={inicio} replace />);

  const abrirPedido = (contexto: AbrirPedido) =>
    navegar(`/pedido/${contexto.pedidoId ?? 'nuevo'}`, { state: { contexto, clave: Date.now() } satisfies EstadoPedido });

  return (
    <div className={`app ${pathname.startsWith('/cocina') ? 'tema-cocina' : ''}`}>
      <header className="barra">
        <nav className="barra-nav" aria-label="Secciones">
          {secciones.map((s) => (
            // Un pedido es parte de Mesas: la pestaña sigue marcada mientras se toma
            <NavLink
              key={s}
              to={`/${s}`}
              className={({ isActive }) => `barra-tab ${isActive || (s === 'mesas' && pathname.startsWith('/pedido')) ? 'activa' : ''}`}
            >
              {NOMBRE_SECCION[s]}
            </NavLink>
          ))}
        </nav>
        <div className="barra-usuario">
          <span>
            {nombre} <small>{rolNombre}</small>
          </span>
          <button className="boton boton-barra" onClick={cerrarSesion}>
            Cambiar de usuario
          </button>
        </div>
      </header>

      <main className="contenido">
        <Routes>
          <Route path="/" element={<Navigate to={inicio} replace />} />
          <Route path="/mesas" element={conPermiso('mesas', <Mesas onAbrir={abrirPedido} />)} />
          <Route path="/pedido/:id" element={conPermiso('mesas', <PaginaPedido puedeCaja={secciones.includes('caja')} />)} />
          <Route path="/caja" element={conPermiso('caja', <Caja />)} />
          <Route path="/cocina" element={conPermiso('cocina', <Cocina />)} />
          <Route path="/admin/*" element={conPermiso('admin', <Admin />)} />
          <Route
            path="/sin-secciones"
            element={
              secciones.length ? (
                <Navigate to={inicio} replace />
              ) : (
                <div className="admin-pantalla">
                  <EstadoVacio titulo="Tu rol no tiene secciones" texto="Pídele a quien administra el restaurante que te asigne un rol con permisos." />
                </div>
              )
            }
          />
          <Route path="*" element={<Navigate to={inicio} replace />} />
        </Routes>
      </main>
      {bloqueada && <Bloqueo nombre={nombre} onDesbloquear={desbloquear} />}
    </div>
  );
}

/**
 * /pedido/nuevo llega con el contexto (mesa, cliente) en el estado de la
 * navegación; /pedido/:id se puede abrir directo o recargar, porque el pedido
 * se carga del servidor.
 */
function PaginaPedido({ puedeCaja }: { puedeCaja: boolean }) {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const estado = useLocation().state as EstadoPedido | null;

  // Un pedido nuevo sin contexto (por ejemplo, al recargar) no sabe de qué mesa es
  if (id === 'nuevo' && !estado) return <Navigate to="/mesas" replace />;
  const contexto: AbrirPedido = id === 'nuevo' ? estado!.contexto : { tipoServicio: 'mesa', ...estado?.contexto, pedidoId: id };

  return (
    <Pedido
      // La misma apertura conserva la pantalla aunque el pedido nuevo pase a tener id
      key={estado?.clave ?? id}
      contexto={contexto}
      onCreado={(nuevoId) =>
        navegar(`/pedido/${nuevoId}`, {
          replace: true,
          state: { contexto: { ...contexto, pedidoId: nuevoId }, clave: estado?.clave ?? Date.now() } satisfies EstadoPedido,
        })
      }
      onVolver={() => navegar('/mesas')}
      onIrCaja={() => navegar(puedeCaja ? '/caja' : '/mesas')}
    />
  );
}
