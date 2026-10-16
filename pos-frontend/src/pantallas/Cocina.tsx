import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api';
import { useAvisar } from '../componentes/Avisos';
import { canalCocina } from '../socket';
import type { EstadoItem, ItemComanda } from '../tipos';
import { NOMBRE_SERVICIO, cant, minutosDesde, pitar, useDatos } from '../util';

const SIGUIENTE: Partial<Record<EstadoItem, { estado: EstadoItem; texto: string }>> = {
  pendiente: { estado: 'preparando', texto: 'Empezar' },
  preparando: { estado: 'listo', texto: 'Listo' },
  listo: { estado: 'entregado', texto: 'Entregado' },
};
const MINUTOS_ALERTA = 15;

interface Ticket {
  pedidoId: string;
  numero: string;
  titulo: string;
  enviado: string;
  items: ItemComanda[];
}

export function Cocina() {
  const avisar = useAvisar();
  const pendientes = useDatos(() => api<ItemComanda[]>('GET', '/cocina/pendientes'), []);
  const [estacion, setEstacion] = useState<string>('todas');
  const [recientes, setRecientes] = useState<Set<string>>(new Set());
  const [, setTic] = useState(0);
  const { recargar } = pendientes;

  useEffect(() => {
    const canal = canalCocina();
    const nueva = (c: { pedidoId: string }) => {
      pitar();
      setRecientes((s) => new Set(s).add(c.pedidoId));
      setTimeout(() => setRecientes((s) => { const n = new Set(s); n.delete(c.pedidoId); return n; }), 8000);
      recargar();
    };
    const anulado = (a: { producto: string }) => {
      avisar(`Anulado: ${a.producto}. No lo prepares.`, 'error');
      recargar();
    };
    canal.on('comanda.nueva', nueva);
    canal.on('item.estado', recargar);
    canal.on('item.anulado', anulado);
    canal.on('connect', recargar); // al reconectar, por si se perdió algo
    const reloj = setInterval(() => setTic((t) => t + 1), 30_000);
    return () => {
      canal.off('comanda.nueva', nueva);
      canal.off('item.estado', recargar);
      canal.off('item.anulado', anulado);
      canal.off('connect', recargar);
      clearInterval(reloj);
    };
  }, [recargar, avisar]);

  async function avanzar(items: ItemComanda[], estado: EstadoItem) {
    try {
      for (const i of items) await api('PATCH', `/cocina/items/${i.id}`, { estado });
    } catch (e) {
      avisar(mensajeError(e), 'error');
    }
    recargar();
  }

  const todos = pendientes.datos ?? [];
  const estaciones = [...new Set(todos.map((i) => i.estacion ?? 'Sin estación'))];
  const visibles = estacion === 'todas' ? todos : todos.filter((i) => (i.estacion ?? 'Sin estación') === estacion);

  const tickets: Ticket[] = [];
  for (const i of visibles) {
    let t = tickets.find((x) => x.pedidoId === i.pedidoId);
    if (!t) {
      t = {
        pedidoId: i.pedidoId,
        numero: i.numero,
        titulo: i.mesa ? `Mesa ${i.mesa}` : NOMBRE_SERVICIO[i.tipoServicio],
        enviado: i.enviadoEn,
        items: [],
      };
      tickets.push(t);
    }
    t.items.push(i);
  }

  return (
    <div className="cocina-pantalla">
      <header className="cocina-cabeza">
        <h1>Cocina</h1>
        <div className="fila-chips" role="tablist" aria-label="Estación">
          {['todas', ...estaciones].map((e) => (
            <button key={e} role="tab" aria-selected={estacion === e} className={`chip chip-oscuro ${estacion === e ? 'activo' : ''}`} onClick={() => setEstacion(e)}>
              {e === 'todas' ? 'Todas' : e}
            </button>
          ))}
        </div>
        <p className="cocina-cuenta">
          {tickets.length} {tickets.length === 1 ? 'comanda' : 'comandas'}
        </p>
      </header>

      {pendientes.error && <p className="error">{pendientes.error}</p>}
      {!pendientes.cargando && tickets.length === 0 && <p className="cocina-vacia">No hay comandas pendientes. Las nuevas aparecen aquí con un pitido.</p>}

      <div className="riel">
        {tickets.map((t) => {
          const min = minutosDesde(t.enviado);
          const porAvanzar = t.items.filter((i) => i.estado === 'pendiente' || i.estado === 'preparando');
          return (
            <article key={t.pedidoId} className={`ticket ${recientes.has(t.pedidoId) ? 'ticket-nuevo' : ''} ${min >= MINUTOS_ALERTA ? 'ticket-tarde' : ''}`}>
              <header className="ticket-cabeza">
                <h2>{t.titulo}</h2>
                <span className="ticket-num">#{t.numero}</span>
                <span className="ticket-min">{min} min</span>
              </header>
              <ul className="ticket-items">
                {t.items.map((i) => {
                  const sig = SIGUIENTE[i.estado];
                  return (
                    <li key={i.id} className={`ticket-item item-${i.estado}`}>
                      <div className="ticket-desc">
                        <span className="ticket-linea">
                          <span className="ticket-cant">{cant(i.cantidad)}×</span> {i.producto}
                        </span>
                        {i.modificadores.map((m) => (
                          <span key={m} className="ticket-mod">{m}</span>
                        ))}
                        {i.notas && <span className="ticket-nota">{i.notas}</span>}
                      </div>
                      {sig && (
                        <button className={`boton-ticket a-${sig.estado}`} onClick={() => avanzar([i], sig.estado)}>
                          {sig.texto}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {porAvanzar.length > 1 && (
                <button className="ticket-todo" onClick={() => avanzar(porAvanzar, 'listo')}>
                  Todo listo
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
