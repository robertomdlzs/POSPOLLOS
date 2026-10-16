import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { alCambiarSesion, cerrarSesion, obtenerSesion } from './api';
import { ProveedorAvisos, useAvisar } from './componentes/Avisos';
import { Bloqueo, useInactividad } from './componentes/Bloqueo';
import { clienteDatos, useTiempoReal } from './datos';
import { Caja } from './pantallas/Caja';
import { Cocina } from './pantallas/Cocina';
import { Ingreso } from './pantallas/Ingreso';
import { Mesas, type AbrirPedido } from './pantallas/Mesas';
import { Pedido } from './pantallas/Pedido';
import { cerrarCanal, canalCocina } from './socket';
import type { Rol, Sesion } from './tipos';
import { NOMBRE_ROL, cant } from './util';

type Seccion = 'mesas' | 'caja' | 'cocina';

const SECCIONES: Record<Rol, Seccion[]> = {
  mesero: ['mesas'],
  cajero: ['mesas', 'caja'],
  cocina: ['cocina'],
  supervisor: ['mesas', 'caja', 'cocina'],
  admin: ['mesas', 'caja', 'cocina'],
};
const NOMBRE_SECCION: Record<Seccion, string> = { mesas: 'Mesas', caja: 'Caja', cocina: 'Cocina' };

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

  return sesion ? <Trabajo key={sesion.usuario.id} sesion={sesion} /> : <Ingreso />;
}

function Trabajo({ sesion }: { sesion: Sesion }) {
  const avisar = useAvisar();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const { rol, nombre } = sesion.usuario;
  const secciones = SECCIONES[rol];
  const inicio = `/${secciones[0]}`;
  // La pantalla de cocina se mira más de lo que se toca: no se bloquea
  const [bloqueada, desbloquear] = useInactividad(rol !== 'cocina');
  useTiempoReal();

  // Meseros y caja se enteran cuando un plato sale de cocina
  useEffect(() => {
    if (rol === 'cocina') return;
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
  }, [rol, avisar]);

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
            {nombre} <small>{NOMBRE_ROL[rol]}</small>
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
          <Route path="/pedido/:id" element={conPermiso('mesas', <PaginaPedido rol={rol} puedeCaja={secciones.includes('caja')} />)} />
          <Route path="/caja" element={conPermiso('caja', <Caja rol={rol} />)} />
          <Route path="/cocina" element={conPermiso('cocina', <Cocina />)} />
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
function PaginaPedido({ rol, puedeCaja }: { rol: Rol; puedeCaja: boolean }) {
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
      rol={rol}
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
