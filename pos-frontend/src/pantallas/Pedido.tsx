import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mensajeError } from '../api';
import { useAvisar } from '../componentes/Avisos';
import { Modal } from '../componentes/Modal';
import { PedirSupervisor } from '../componentes/Supervisor';
import type { Autorizacion, ItemPedido, Opcion, Pedido as TPedido, Producto, Rol } from '../tipos';
import { NOMBRE_SERVICIO, cant, esSupervisor, pesos, puedeCobrar, useDatos, uuid } from '../util';
import { Cobro } from './Cobro';
import type { AbrirPedido } from './Mesas';

/** Una línea que la mesera agregó y todavía no se ha enviado */
interface Linea {
  clave: string;
  producto: Producto;
  cantidad: number;
  notas: string;
  opciones: Opcion[];
}

const ESTADO_ITEM: Record<ItemPedido['estado'], string> = {
  pendiente: 'En cocina',
  preparando: 'Preparando',
  listo: 'Listo',
  entregado: 'Entregado',
  anulado: 'Anulado',
};

let menuEnMemoria: Producto[] | null = null;

const precioLinea = (l: Linea) => (Number(l.producto.precio) + l.opciones.reduce((s, o) => s + Number(o.precioExtra), 0)) * l.cantidad;

interface Props {
  contexto: AbrirPedido;
  rol: Rol;
  onVolver: () => void;
  onIrCaja: () => void;
}

export function Pedido({ contexto, rol, onVolver, onIrCaja }: Props) {
  const avisar = useAvisar();
  const menu = useDatos(async () => (menuEnMemoria ??= await api<Producto[]>('GET', '/menu')), []);
  const [pedidoId, setPedidoId] = useState(contexto.pedidoId);
  const pedido = useDatos(() => (pedidoId ? api<TPedido>('GET', `/pedidos/${pedidoId}`) : Promise.resolve(null)), [pedidoId]);

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<Producto | null>(null);
  const [anulando, setAnulando] = useState<ItemPedido | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [verComanda, setVerComanda] = useState(false);
  // Misma clave en todos los reintentos: si el primer envío llegó, el servidor no duplica el pedido
  const claveCreacion = useRef(uuid());
  // Igual para cada tanda que se agrega a un pedido abierto. Si falla la red, las líneas
  // no cambian y el reintento lleva la misma clave; al editar el borrador, la tanda es otra.
  const claveLote = useRef(uuid());
  useEffect(() => {
    claveLote.current = uuid();
  }, [lineas]);

  const categorias = useMemo(() => {
    const vistas = new Map<string, string>();
    for (const p of menu.datos ?? []) vistas.set(p.categoriaId, p.categoria);
    return [...vistas];
  }, [menu.datos]);
  const catActiva = categoria ?? categorias[0]?.[0] ?? null;
  const productos = (menu.datos ?? []).filter((p) => p.categoriaId === catActiva);

  const p = pedido.datos;
  const sinEnviar = (p?.items ?? []).filter((i) => i.estado === 'pendiente' && !i.enviadoCocinaEn).length;
  const porEnviar = lineas.length + sinEnviar;
  const totalBorrador = lineas.reduce((s, l) => s + precioLinea(l), 0);
  const total = Number(p?.totales.total ?? 0) + totalBorrador;
  const activos = (p?.items ?? []).filter((i) => i.estado !== 'anulado').length;

  const titulo =
    contexto.tipoServicio === 'mesa'
      ? `Mesa ${p?.mesa ?? contexto.mesa?.numero ?? ''}`
      : (p?.clienteNombre ?? contexto.clienteNombre ?? NOMBRE_SERVICIO[contexto.tipoServicio]);

  function agregar(producto: Producto, opciones: Opcion[] = [], cantidad = 1, notas = '') {
    setLineas((ls) => {
      // Lo que no tiene opciones ni notas se agrupa en una sola línea
      const igual = !opciones.length && !notas && ls.find((l) => l.producto.id === producto.id && !l.opciones.length && !l.notas);
      if (igual) return ls.map((l) => (l === igual ? { ...l, cantidad: l.cantidad + cantidad } : l));
      return [...ls, { clave: uuid(), producto, cantidad, notas, opciones }];
    });
  }

  /** Quita una unidad de la línea simple (sin opciones ni notas) de ese producto */
  function quitarUno(prod: Producto) {
    setLineas((ls) => {
      const l = ls.find((x) => x.producto.id === prod.id && !x.opciones.length && !x.notas);
      if (!l) return ls;
      return l.cantidad > 1 ? ls.map((x) => (x === l ? { ...x, cantidad: x.cantidad - 1 } : x)) : ls.filter((x) => x !== l);
    });
  }

  function tocarProducto(prod: Producto) {
    if (prod.modificadores.length) setEligiendo(prod);
    else agregar(prod);
  }

  async function enviarACocina() {
    setEnviando(true);
    const items = lineas.map((l) => ({
      productoId: l.producto.id,
      cantidad: l.cantidad,
      notas: l.notas || undefined,
      modificadorIds: l.opciones.map((o) => o.id),
    }));
    try {
      let id = pedidoId;
      if (!id) {
        const creado = await api<TPedido>('POST', '/pedidos', {
          idempotencyKey: claveCreacion.current,
          tipoServicio: contexto.tipoServicio,
          mesaId: contexto.mesa?.id,
          clienteNombre: contexto.clienteNombre,
          clienteTelefono: contexto.clienteTelefono,
          direccionEntrega: contexto.direccionEntrega,
          items,
        });
        id = creado.id;
        setPedidoId(id);
      } else if (items.length) {
        await api('POST', `/pedidos/${id}/items`, { idempotencyKey: claveLote.current, items });
      }
      setLineas([]);
      await api('POST', `/pedidos/${id}/enviar-cocina`);
      avisar('Enviado a cocina', 'exito');
      setVerComanda(false);
    } catch (e) {
      avisar(mensajeError(e), 'error');
    } finally {
      setEnviando(false);
      pedido.recargar();
    }
  }

  /** Todo se anuló: se cierra el pedido para que la mesa no quede ocupada */
  async function cerrarVacio() {
    if (!pedidoId) return;
    setCerrando(true);
    try {
      await api('POST', `/pedidos/${pedidoId}/cerrar-vacio`);
      avisar(`${titulo}: pedido cerrado`, 'info');
      onVolver();
    } catch (e) {
      avisar(mensajeError(e), 'error');
      setCerrando(false);
    }
  }

  return (
    <div className={`pedido-pantalla ${verComanda ? 'con-comanda' : ''}`}>
      <nav className="categorias" aria-label="Categorías">
        <button className="boton boton-volver" onClick={onVolver}>
          ‹ Mesas
        </button>
        {categorias.map(([id, nombre]) => (
          <button key={id} className={`categoria ${id === catActiva ? 'activa' : ''}`} onClick={() => setCategoria(id)}>
            {nombre}
          </button>
        ))}
      </nav>

      <section className="productos" aria-label="Productos">
        {menu.error && <p className="error">{menu.error}</p>}
        {productos.map((prod) => {
          const enBorrador = lineas.filter((l) => l.producto.id === prod.id).reduce((s, l) => s + l.cantidad, 0);
          const simple = !prod.modificadores.length;
          return (
            <article key={prod.id} className={`producto ${enBorrador ? 'en-borrador' : ''}`}>
              <button className="producto-toque" onClick={() => tocarProducto(prod)} aria-label={`Agregar ${prod.nombre}`}>
                <span className="producto-foto">
                  {prod.imagenUrl ? (
                    <img src={prod.imagenUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="producto-inicial" aria-hidden="true">
                      {prod.nombre.charAt(0)}
                    </span>
                  )}
                </span>
                <span className="producto-nombre">{prod.nombre}</span>
                {prod.descripcion && <span className="producto-desc">{prod.descripcion}</span>}
              </button>
              <div className="producto-pie">
                <span className="producto-precio">{pesos(prod.precio)}</span>
                {simple && enBorrador > 0 ? (
                  <span className="producto-pasos">
                    <button onClick={() => quitarUno(prod)} aria-label={`Uno menos de ${prod.nombre}`}>
                      −
                    </button>
                    <span>{enBorrador}</span>
                    <button onClick={() => agregar(prod)} aria-label={`Uno más de ${prod.nombre}`}>
                      +
                    </button>
                  </span>
                ) : (
                  <button className="producto-agregar" onClick={() => tocarProducto(prod)} aria-label={`Agregar ${prod.nombre}`}>
                    {simple ? '+ Agregar' : enBorrador > 0 ? '+ Otra' : 'Elegir'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <aside className="comanda" aria-label="Comanda">
        <header className="comanda-cabeza">
          <div>
            <h2>{titulo}</h2>
            <p>{p ? `Pedido #${p.numero}${p.mesero ? `, tomado por ${p.mesero}` : ''}` : 'Pedido nuevo'}</p>
          </div>
          <button className="boton-icono solo-movil" onClick={() => setVerComanda(false)} aria-label="Cerrar comanda">
            ✕
          </button>
        </header>

        <ol className="comanda-lineas">
          {p?.items.map((i) => (
            <li key={i.id} className={`linea linea-${i.estado}`}>
              <span className="linea-cant">{cant(i.cantidad)}</span>
              <span className="linea-desc">
                {i.producto}
                {i.modificadores.map((m) => (
                  <small key={m.nombre}>+ {m.nombre}</small>
                ))}
                {i.notas && <small className="linea-nota">{i.notas}</small>}
                <small className="linea-estado">{i.enviadoCocinaEn ? ESTADO_ITEM[i.estado] : i.estado === 'anulado' ? 'Anulado' : 'Sin enviar'}</small>
              </span>
              <span className="linea-precio">{pesos((Number(i.precioUnitario) + Number(i.extras)) * Number(i.cantidad))}</span>
              {i.estado !== 'anulado' && (
                <button className="linea-quitar" onClick={() => setAnulando(i)} aria-label={`Anular ${i.producto}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {lineas.map((l) => (
            <li key={l.clave} className="linea linea-nueva">
              <span className="linea-pasos">
                <button
                  onClick={() => setLineas((ls) => (l.cantidad > 1 ? ls.map((x) => (x === l ? { ...x, cantidad: x.cantidad - 1 } : x)) : ls.filter((x) => x !== l)))}
                  aria-label="Uno menos"
                >
                  −
                </button>
                <span className="linea-cant">{l.cantidad}</span>
                <button onClick={() => setLineas((ls) => ls.map((x) => (x === l ? { ...x, cantidad: x.cantidad + 1 } : x)))} aria-label="Uno más">
                  +
                </button>
              </span>
              <span className="linea-desc">
                {l.producto.nombre}
                {l.opciones.map((o) => (
                  <small key={o.id}>+ {o.nombre}</small>
                ))}
                {l.notas && <small className="linea-nota">{l.notas}</small>}
              </span>
              <span className="linea-precio">{pesos(precioLinea(l))}</span>
            </li>
          ))}
        </ol>
        {!p?.items.length && !lineas.length && <p className="comanda-vacia">Toca un producto para empezar.</p>}

        <footer className="comanda-pie">
          <div className="comanda-total">
            <span>Total</span>
            <strong>{pesos(total)}</strong>
          </div>
          <button className="boton boton-cocina boton-grande" disabled={!porEnviar || enviando} onClick={enviarACocina}>
            {enviando ? 'Enviando…' : porEnviar ? `Enviar a cocina (${porEnviar})` : 'Nada nuevo por enviar'}
          </button>
          {p && activos === 0 && p.items.length > 0 && !lineas.length ? (
            <button className="boton boton-peligro boton-grande" disabled={cerrando} onClick={cerrarVacio}>
              {cerrando ? 'Cerrando…' : contexto.tipoServicio === 'mesa' ? 'Cerrar pedido y liberar la mesa' : 'Cerrar pedido'}
            </button>
          ) : puedeCobrar(rol) && (
            <button
              className="boton boton-primario boton-grande"
              disabled={!p || lineas.length > 0 || sinEnviar > 0 || activos === 0}
              onClick={() => setCobrando(true)}
              title={lineas.length || sinEnviar ? 'Envía primero lo nuevo a cocina' : undefined}
            >
              Cobrar {p && activos > 0 ? pesos(p.totales.total) : ''}
            </button>
          )}
        </footer>
      </aside>

      <button className="barra-comanda solo-movil" onClick={() => setVerComanda(true)}>
        <span>
          Ver comanda {porEnviar > 0 && `(${porEnviar} por enviar)`}
        </span>
        <strong>{pesos(total)}</strong>
      </button>

      {eligiendo && (
        <ElegirOpciones
          producto={eligiendo}
          onCerrar={() => setEligiendo(null)}
          onAgregar={(opciones, cantidad, notas) => {
            agregar(eligiendo, opciones, cantidad, notas);
            setEligiendo(null);
          }}
        />
      )}
      {anulando && p && (
        <Anular
          item={anulando}
          pedidoId={p.id}
          rol={rol}
          onCerrar={() => setAnulando(null)}
          onAnulado={() => {
            setAnulando(null);
            avisar(`${anulando.producto} anulado`, 'info');
            pedido.recargar();
          }}
        />
      )}
      {cobrando && p && (
        <Cobro
          pedido={p}
          titulo={titulo}
          rol={rol}
          onCerrar={() => setCobrando(false)}
          onIrCaja={onIrCaja}
          onCobrado={() => {
            setCobrando(false);
            onVolver();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ElegirOpciones({
  producto,
  onCerrar,
  onAgregar,
}: {
  producto: Producto;
  onCerrar: () => void;
  onAgregar: (o: Opcion[], cantidad: number, notas: string) => void;
}) {
  const [elegidas, setElegidas] = useState<Record<string, string[]>>({});
  const [cantidad, setCantidad] = useState(1);
  const [notas, setNotas] = useState('');

  const faltan = producto.modificadores.filter((g) => (elegidas[g.id]?.length ?? 0) < g.min);
  const opciones = producto.modificadores.flatMap((g) => g.opciones.filter((o) => elegidas[g.id]?.includes(o.id)));
  const precio = (Number(producto.precio) + opciones.reduce((s, o) => s + Number(o.precioExtra), 0)) * cantidad;

  function tocar(grupoId: string, max: number, opcionId: string) {
    setElegidas((e) => {
      const actual = e[grupoId] ?? [];
      if (actual.includes(opcionId)) return { ...e, [grupoId]: actual.filter((x) => x !== opcionId) };
      if (max === 1) return { ...e, [grupoId]: [opcionId] };
      if (actual.length >= max) return e;
      return { ...e, [grupoId]: [...actual, opcionId] };
    });
  }

  return (
    <Modal titulo={producto.nombre} onCerrar={onCerrar}>
      <div className="opciones">
        {producto.modificadores.map((g) => {
          const n = elegidas[g.id]?.length ?? 0;
          const regla = g.min === 1 && g.max === 1 ? 'Escoge una' : g.min > 0 ? `Escoge de ${g.min} a ${g.max}` : `Opcional, hasta ${g.max}`;
          return (
            <fieldset key={g.id} className={`grupo ${n < g.min ? 'grupo-falta' : ''}`}>
              <legend>
                {g.nombre} <span className="nota">{regla}</span>
              </legend>
              <div className="fila-chips">
                {g.opciones.map((o) => {
                  const activa = elegidas[g.id]?.includes(o.id) ?? false;
                  return (
                    <button
                      key={o.id}
                      className={`chip chip-grande ${activa ? 'activo' : ''}`}
                      aria-pressed={activa}
                      disabled={!activa && g.max > 1 && n >= g.max}
                      onClick={() => tocar(g.id, g.max, o.id)}
                    >
                      {o.nombre}
                      {Number(o.precioExtra) > 0 && <small>+{pesos(o.precioExtra)}</small>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        <label>
          Nota para cocina
          <input value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={200} placeholder="Por ejemplo: sin cebolla" />
        </label>
        <div className="opciones-pie">
          <div className="pasos" aria-label="Cantidad">
            <button onClick={() => setCantidad((c) => Math.max(1, c - 1))} aria-label="Uno menos">
              −
            </button>
            <span>{cantidad}</span>
            <button onClick={() => setCantidad((c) => Math.min(99, c + 1))} aria-label="Uno más">
              +
            </button>
          </div>
          <button className="boton boton-primario boton-grande" disabled={faltan.length > 0} onClick={() => onAgregar(opciones, cantidad, notas.trim())}>
            {faltan.length ? `Falta: ${faltan[0].nombre.toLowerCase()}` : `Agregar ${pesos(precio)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const MOTIVOS = ['Error al tomar el pedido', 'El cliente lo canceló', 'Se demoró demasiado', 'Salió mal preparado'];

function Anular({
  item,
  pedidoId,
  rol,
  onCerrar,
  onAnulado,
}: {
  item: ItemPedido;
  pedidoId: string;
  rol: Rol;
  onCerrar: () => void;
  onAnulado: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const necesitaSupervisor = !!item.enviadoCocinaEn && !esSupervisor(rol);

  async function anular(autorizacion?: Autorizacion) {
    await api('POST', `/pedidos/${pedidoId}/items/${item.id}/anular`, { motivo, autorizacion });
    onAnulado();
  }

  return (
    <Modal titulo={`Anular ${cant(item.cantidad)} ${item.producto}`} onCerrar={onCerrar}>
      <div className="formulario">
        <div className="fila-chips">
          {MOTIVOS.map((m) => (
            <button key={m} className={`chip ${motivo === m ? 'activo' : ''}`} onClick={() => setMotivo(m)}>
              {m}
            </button>
          ))}
        </div>
        <label>
          Motivo
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
        </label>
        {motivo.trim().length < 3 ? (
          <p className="nota">Escoge o escribe el motivo.</p>
        ) : necesitaSupervisor ? (
          <PedirSupervisor accion="Anular un producto que ya está en cocina" onAutorizar={anular} />
        ) : (
          <button
            className="boton boton-peligro boton-grande"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                await anular();
              } catch (e) {
                setError(mensajeError(e));
              } finally {
                setOcupado(false);
              }
            }}
          >
            Anular producto
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
