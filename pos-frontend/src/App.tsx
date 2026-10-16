import { useEffect, useState } from 'react';
import { alCambiarSesion, cerrarSesion, obtenerSesion } from './api';
import { ProveedorAvisos, useAvisar } from './componentes/Avisos';
import { Bloqueo, useInactividad } from './componentes/Bloqueo';
import { Caja } from './pantallas/Caja';
import { Cocina } from './pantallas/Cocina';
import { Ingreso } from './pantallas/Ingreso';
import { Mesas, type AbrirPedido } from './pantallas/Mesas';
import { Pedido } from './pantallas/Pedido';
import { cerrarCanal, canalCocina } from './socket';
import type { Rol, Sesion } from './tipos';
import { NOMBRE_ROL, cant } from './util';

type Vista = { tipo: 'mesas' } | { tipo: 'pedido'; contexto: AbrirPedido; clave: number } | { tipo: 'caja' } | { tipo: 'cocina' };

const SECCIONES: Record<Rol, ('mesas' | 'caja' | 'cocina')[]> = {
  mesero: ['mesas'],
  cajero: ['mesas', 'caja'],
  cocina: ['cocina'],
  supervisor: ['mesas', 'caja', 'cocina'],
  admin: ['mesas', 'caja', 'cocina'],
};
const NOMBRE_SECCION = { mesas: 'Mesas', caja: 'Caja', cocina: 'Cocina' };

export function App() {
  const [sesion, setSesion] = useState<Sesion | null>(obtenerSesion());
  useEffect(() => alCambiarSesion(setSesion), []);

  // Al cambiar de usuario, el canal en tiempo real se abre de nuevo con su token
  useEffect(() => {
    if (!sesion) cerrarCanal();
  }, [sesion]);

  return <ProveedorAvisos>{sesion ? <Trabajo key={sesion.usuario.id} sesion={sesion} /> : <Ingreso />}</ProveedorAvisos>;
}

function Trabajo({ sesion }: { sesion: Sesion }) {
  const avisar = useAvisar();
  const { rol, nombre } = sesion.usuario;
  const secciones = SECCIONES[rol];
  const [vista, setVista] = useState<Vista>({ tipo: secciones[0] });
  // La pantalla de cocina se mira más de lo que se toca: no se bloquea
  const [bloqueada, desbloquear] = useInactividad(rol !== 'cocina');

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

  const seccionActiva = vista.tipo === 'pedido' ? 'mesas' : vista.tipo;

  return (
    <div className={`app ${vista.tipo === 'cocina' ? 'tema-cocina' : ''}`}>
      <header className="barra">
        <nav className="barra-nav" aria-label="Secciones">
          {secciones.map((s) => (
              <button key={s} className={`barra-tab ${seccionActiva === s ? 'activa' : ''}`} onClick={() => setVista({ tipo: s })} aria-current={seccionActiva === s}>
                {NOMBRE_SECCION[s]}
              </button>
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
        {vista.tipo === 'mesas' && <Mesas onAbrir={(contexto) => setVista({ tipo: 'pedido', contexto, clave: Date.now() })} />}
        {vista.tipo === 'pedido' && (
          <Pedido
            key={vista.clave}
            contexto={vista.contexto}
            rol={rol}
            onVolver={() => setVista({ tipo: 'mesas' })}
            onIrCaja={() => setVista(secciones.includes('caja') ? { tipo: 'caja' } : { tipo: 'mesas' })}
          />
        )}
        {vista.tipo === 'caja' && <Caja rol={rol} />}
        {vista.tipo === 'cocina' && <Cocina />}
      </main>
      {bloqueada && <Bloqueo nombre={nombre} onDesbloquear={desbloquear} />}
    </div>
  );
}
