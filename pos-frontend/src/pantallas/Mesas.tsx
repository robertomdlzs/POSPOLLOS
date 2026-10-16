import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../componentes/Modal';
import { canalCocina } from '../socket';
import type { Mesa, PedidoResumen, TipoServicio } from '../tipos';
import { NOMBRE_SERVICIO, minutosDesde, useDatos } from '../util';

export interface AbrirPedido {
  pedidoId?: string;
  tipoServicio: TipoServicio;
  mesa?: Mesa;
  clienteNombre?: string;
  clienteTelefono?: string;
  direccionEntrega?: string;
}

const ESTADO_PEDIDO: Record<string, string> = {
  abierto: 'Tomando pedido',
  en_cocina: 'En cocina',
  servido: 'Servido',
};

export function Mesas({ onAbrir }: { onAbrir: (a: AbrirPedido) => void }) {
  const mesas = useDatos(() => api<Mesa[]>('GET', '/mesas'), []);
  const pedidos = useDatos(() => api<PedidoResumen[]>('GET', '/pedidos'), []);
  const [nuevoSinMesa, setNuevoSinMesa] = useState(false);
  const { recargar: rMesas } = mesas;
  const { recargar: rPedidos } = pedidos;

  // Se actualiza con lo que pasa en cocina y, por si acaso, cada 20 segundos
  useEffect(() => {
    const refrescar = () => {
      rMesas();
      rPedidos();
    };
    const canal = canalCocina();
    canal.on('comanda.nueva', refrescar);
    canal.on('item.estado', refrescar);
    const t = setInterval(refrescar, 20_000);
    return () => {
      canal.off('comanda.nueva', refrescar);
      canal.off('item.estado', refrescar);
      clearInterval(t);
    };
  }, [rMesas, rPedidos]);

  const porId = new Map((pedidos.datos ?? []).map((p) => [p.id, p]));
  const zonas = new Map<string, Mesa[]>();
  for (const m of mesas.datos ?? []) {
    const z = m.zona ?? 'Salón';
    zonas.set(z, [...(zonas.get(z) ?? []), m]);
  }
  const sinMesa = (pedidos.datos ?? []).filter((p) => p.tipoServicio !== 'mesa');
  const libres = (mesas.datos ?? []).filter((m) => m.estado === 'libre').length;

  return (
    <div className="mesas-pantalla">
      <section className="salon">
        <header className="seccion-cabeza">
          <h1>Mesas</h1>
          {mesas.datos && (
            <p className="nota">
              {libres} libres de {mesas.datos.length}
            </p>
          )}
        </header>
        {mesas.error && <p className="error">{mesas.error}</p>}
        {[...zonas].map(([zona, lista]) => (
          <div key={zona} className="zona">
            {zonas.size > 1 && <h2>{zona}</h2>}
            <div className="mesas">
              {lista.map((m) => {
                const p = m.pedidoAbiertoId ? porId.get(m.pedidoAbiertoId) : undefined;
                return (
                  <button
                    key={m.id}
                    className={`mesa mesa-${m.estado} ${p ? `pedido-${p.estado}` : ''}`}
                    onClick={() => onAbrir({ tipoServicio: 'mesa', mesa: m, pedidoId: m.pedidoAbiertoId ?? undefined })}
                  >
                    <span className="mesa-numero">{m.numero}</span>
                    <span className="mesa-detalle">
                      {p ? (
                        <>
                          {ESTADO_PEDIDO[p.estado] ?? p.estado}
                          <br />
                          {minutosDesde(p.creadoEn)} min
                        </>
                      ) : m.estado === 'libre' ? (
                        `${m.capacidad} puestos`
                      ) : (
                        m.estado
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <aside className="sin-mesa">
        <header className="seccion-cabeza">
          <h2>Sin mesa</h2>
          <button className="boton boton-primario" onClick={() => setNuevoSinMesa(true)}>
            Nuevo pedido
          </button>
        </header>
        {sinMesa.length === 0 ? (
          <p className="nota">Los pedidos para llevar, de mostrador y domicilios aparecen aquí.</p>
        ) : (
          <ul className="lista-pedidos">
            {sinMesa.map((p) => (
              <li key={p.id}>
                <button
                  className="pedido-fila"
                  onClick={() => onAbrir({ pedidoId: p.id, tipoServicio: p.tipoServicio, clienteNombre: p.clienteNombre ?? undefined })}
                >
                  <span className="pedido-fila-titulo">
                    #{p.numero} {p.clienteNombre ?? NOMBRE_SERVICIO[p.tipoServicio]}
                  </span>
                  <span className="nota">
                    {NOMBRE_SERVICIO[p.tipoServicio]}, {ESTADO_PEDIDO[p.estado] ?? p.estado.toLowerCase()}, {minutosDesde(p.creadoEn)} min
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {nuevoSinMesa && (
        <NuevoSinMesa
          onCerrar={() => setNuevoSinMesa(false)}
          onCrear={(a) => {
            setNuevoSinMesa(false);
            onAbrir(a);
          }}
        />
      )}
    </div>
  );
}

function NuevoSinMesa({ onCerrar, onCrear }: { onCerrar: () => void; onCrear: (a: AbrirPedido) => void }) {
  const [tipo, setTipo] = useState<TipoServicio>('para_llevar');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const faltaDireccion = tipo === 'domicilio' && !direccion.trim();

  return (
    <Modal titulo="Pedido sin mesa" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (faltaDireccion) return;
          onCrear({
            tipoServicio: tipo,
            clienteNombre: nombre.trim() || undefined,
            clienteTelefono: telefono.trim() || undefined,
            direccionEntrega: tipo === 'domicilio' ? direccion.trim() : undefined,
          });
        }}
      >
        <div className="fila-chips" role="radiogroup" aria-label="Tipo de pedido">
          {(['para_llevar', 'mostrador', 'domicilio'] as TipoServicio[]).map((t) => (
            <button type="button" key={t} role="radio" aria-checked={tipo === t} className={`chip ${tipo === t ? 'activo' : ''}`} onClick={() => setTipo(t)}>
              {NOMBRE_SERVICIO[t]}
            </button>
          ))}
        </div>
        <label>
          Nombre del cliente
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Opcional" data-autofoco />
        </label>
        {tipo === 'domicilio' && (
          <>
            <label>
              Teléfono
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={30} inputMode="tel" />
            </label>
            <label>
              Dirección de entrega
              <input value={direccion} onChange={(e) => setDireccion(e.target.value)} maxLength={250} required />
            </label>
          </>
        )}
        <button className="boton boton-primario boton-grande" disabled={faltaDireccion}>
          Tomar pedido
        </button>
      </form>
    </Modal>
  );
}
