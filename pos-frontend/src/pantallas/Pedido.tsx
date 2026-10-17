import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mensajeError } from '../api';
import { useAvisar } from '../componentes/Avisos';
import { Modal } from '../componentes/Modal';
import { PedirSupervisor } from '../componentes/Supervisor';
import { usePuede } from '../permisos';
import type { Autorizacion, GrupoModificador, ItemPedido, Opcion, OpcionCombo, Pedido as TPedido, Producto } from '../tipos';
import { CLAVES, invalidar, useDatos } from '../datos';
import { NOMBRE_SERVICIO, cant, pesos, uuid } from '../util';
import { Cobro } from './Cobro';
import type { AbrirPedido } from './Mesas';

/** Lo escogido en una parte de un combo, con sus propios modificadores */
interface Componente {
  seccionId: string;
  seccion: string;
  opcion: OpcionCombo;
  mods: Opcion[];
}

/** Una línea que la mesera agregó y todavía no se ha enviado */
interface Linea {
  clave: string;
  producto: Producto;
  cantidad: number;
  notas: string;
  opciones: Opcion[];
  /** Solo en los combos */
  componentes: Componente[];
}

const ESTADO_ITEM: Record<ItemPedido['estado'], string> = {
  pendiente: 'En cocina',
  preparando: 'Preparando',
  listo: 'Listo',
  entregado: 'Entregado',
  anulado: 'Anulado',
};

const sumaExtras = (opciones: { precioExtra: string }[]) => opciones.reduce((s, o) => s + Number(o.precioExtra), 0);
const extrasComponentes = (cs: Componente[]) => cs.reduce((s, c) => s + Number(c.opcion.precioExtra) + sumaExtras(c.mods), 0);
const precioLinea = (l: Linea) => (Number(l.producto.precio) + sumaExtras(l.opciones) + extrasComponentes(l.componentes)) * l.cantidad;
const valorItem = (i: ItemPedido) => (Number(i.precioUnitario) + Number(i.extras)) * Number(i.cantidad);

/** El estado de un combo es el de sus partes: listo cuando todas lo están */
function estadoDeCombo(partes: ItemPedido[]): ItemPedido['estado'] {
  const vivas = partes.filter((x) => x.estado !== 'anulado');
  if (!vivas.length) return 'anulado';
  for (const e of ['pendiente', 'preparando', 'listo'] as const) if (vivas.some((x) => x.estado === e)) return e;
  return 'entregado';
}

interface Props {
  contexto: AbrirPedido;
  /** El pedido nuevo ya existe en el servidor: para pasar a su dirección */
  onCreado?: (id: string) => void;
  onVolver: () => void;
  onIrCaja: () => void;
}

export function Pedido({ contexto, onCreado, onVolver, onIrCaja }: Props) {
  const puede = usePuede();
  const avisar = useAvisar();
  // El menú cambia poco: se da por fresco 5 minutos y se comparte entre pedidos
  const menu = useDatos(CLAVES.menu, () => api<Producto[]>('GET', '/menu'), { frescura: 5 * 60_000 });
  const [pedidoId, setPedidoId] = useState(contexto.pedidoId);
  const pedido = useDatos(CLAVES.pedido(pedidoId ?? 'nuevo'), () => api<TPedido>('GET', `/pedidos/${pedidoId}`), {
    habilitado: !!pedidoId,
  });

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<Producto | null>(null);
  const [armando, setArmando] = useState<Producto | null>(null);
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
  // Las partes de un combo se muestran dentro de él: no cuentan como líneas aparte
  const principales = (p?.items ?? []).filter((i) => !i.comboItemId);
  const partesDe = (id: string) => (p?.items ?? []).filter((i) => i.comboItemId === id);
  const sinEnviar = principales.filter((i) => i.estado === 'pendiente' && !i.enviadoCocinaEn).length;
  const porEnviar = lineas.length + sinEnviar;
  const totalBorrador = lineas.reduce((s, l) => s + precioLinea(l), 0);
  const total = Number(p?.totales.total ?? 0) + totalBorrador;
  const activos = principales.filter((i) => i.estado !== 'anulado').length;

  // Al abrir un pedido por su dirección no hay contexto: manda lo que diga el servidor
  const tipoServicio = p?.tipoServicio ?? contexto.tipoServicio;
  const titulo =
    tipoServicio === 'mesa'
      ? `Mesa ${p?.mesa ?? contexto.mesa?.numero ?? ''}`
      : (p?.clienteNombre ?? contexto.clienteNombre ?? NOMBRE_SERVICIO[tipoServicio]);

  function agregar(producto: Producto, opciones: Opcion[] = [], cantidad = 1, notas = '', componentes: Componente[] = []) {
    setLineas((ls) => {
      // Lo que no tiene opciones, notas ni partes se agrupa en una sola línea
      const simple = !opciones.length && !notas && !componentes.length;
      const igual = simple && ls.find((l) => l.producto.id === producto.id && !l.opciones.length && !l.notas && !l.componentes.length);
      if (igual) return ls.map((l) => (l === igual ? { ...l, cantidad: l.cantidad + cantidad } : l));
      return [...ls, { clave: uuid(), producto, cantidad, notas, opciones, componentes }];
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
    if (prod.tipo === 'combo') setArmando(prod);
    else if (prod.modificadores.length) setEligiendo(prod);
    else agregar(prod);
  }

  async function enviarACocina() {
    setEnviando(true);
    const items = lineas.map((l) => ({
      productoId: l.producto.id,
      cantidad: l.cantidad,
      notas: l.notas || undefined,
      modificadorIds: l.opciones.map((o) => o.id),
      componentes: l.componentes.length
        ? l.componentes.map((c) => ({ seccionId: c.seccionId, productoId: c.opcion.productoId, modificadorIds: c.mods.map((m) => m.id) }))
        : undefined,
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
        onCreado?.(id);
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
      invalidar(CLAVES.mesas, CLAVES.pedidos);
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
          const simple = !prod.modificadores.length && prod.tipo !== 'combo';
          return (
            <article key={prod.id} className={`producto ${enBorrador ? 'en-borrador' : ''} ${prod.agotado ? 'agotado' : ''}`}>
              <button
                className="producto-toque"
                onClick={() => tocarProducto(prod)}
                disabled={prod.agotado}
                aria-label={prod.agotado ? `${prod.nombre}: agotado` : `Agregar ${prod.nombre}`}
              >
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
                {prod.agotado ? (
                  <span className="producto-agotado">Agotado</span>
                ) : simple && enBorrador > 0 ? (
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
                    {simple ? '+ Agregar' : prod.tipo === 'combo' ? (enBorrador > 0 ? '+ Otro' : 'Armar') : enBorrador > 0 ? '+ Otra' : 'Elegir'}
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
          {principales.map((i) => {
            const partes = partesDe(i.id);
            const estado = partes.length && i.estado !== 'anulado' ? estadoDeCombo(partes) : i.estado;
            return (
            <li key={i.id} className={`linea linea-${estado}`}>
              <span className="linea-cant">{cant(i.cantidad)}</span>
              <span className="linea-desc">
                {i.producto}
                {i.modificadores.map((m) => (
                  <small key={m.nombre}>+ {m.nombre}</small>
                ))}
                {partes.map((x) => (
                  <small key={x.id} className="linea-parte">
                    {x.producto}
                    {x.modificadores.length > 0 && `: ${x.modificadores.map((m) => m.nombre).join(', ')}`}
                  </small>
                ))}
                {i.notas && <small className="linea-nota">{i.notas}</small>}
                <small className="linea-estado">{i.enviadoCocinaEn ? ESTADO_ITEM[estado] : i.estado === 'anulado' ? 'Anulado' : 'Sin enviar'}</small>
              </span>
              <span className="linea-precio">{pesos(valorItem(i) + partes.reduce((s, x) => s + valorItem(x), 0))}</span>
              {i.estado !== 'anulado' && (
                <button className="linea-quitar" onClick={() => setAnulando(i)} aria-label={`Anular ${i.producto}`}>
                  ✕
                </button>
              )}
            </li>
            );
          })}
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
                {l.componentes.map((c) => (
                  <small key={`${c.seccionId}:${c.opcion.productoId}`} className="linea-parte">
                    {c.opcion.nombre}
                    {c.mods.length > 0 && `: ${c.mods.map((m) => m.nombre).join(', ')}`}
                  </small>
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
          ) : puede('venta.cobrar') && (
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
      {armando && (
        <ArmarCombo
          combo={armando}
          onCerrar={() => setArmando(null)}
          onAgregar={(componentes, cantidad, notas) => {
            agregar(armando, [], cantidad, notas, componentes);
            setArmando(null);
          }}
        />
      )}
      {anulando && p && (
        <Anular
          item={anulando}
          pedidoId={p.id}
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
          onCerrar={() => setCobrando(false)}
          onIrCaja={onIrCaja}
          onCobrado={() => {
            // Cobrar no pasa por cocina, así que no llega aviso en tiempo real
            invalidar(CLAVES.mesas, CLAVES.pedidos, CLAVES.turno);
            setCobrando(false);
            onVolver();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Chips para escoger los modificadores de un producto, grupo por grupo */
function GruposModificadores({
  grupos,
  elegidas,
  onTocar,
}: {
  grupos: GrupoModificador[];
  elegidas: Record<string, string[]>;
  onTocar: (grupoId: string, max: number, opcionId: string) => void;
}) {
  return (
    <>
      {grupos.map((g) => {
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
                    onClick={() => onTocar(g.id, g.max, o.id)}
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
    </>
  );
}

/** Marca o desmarca una opción respetando el máximo (con máximo 1, cambia la elegida) */
function alternar(elegidas: string[], max: number, id: string) {
  if (elegidas.includes(id)) return elegidas.filter((x) => x !== id);
  if (max === 1) return [id];
  if (elegidas.length >= max) return elegidas;
  return [...elegidas, id];
}

function PieCantidad({
  cantidad,
  setCantidad,
  falta,
  precio,
  onAgregar,
}: {
  cantidad: number;
  setCantidad: (f: (c: number) => number) => void;
  falta: string | null;
  precio: number;
  onAgregar: () => void;
}) {
  return (
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
      <button className="boton boton-primario boton-grande" disabled={!!falta} onClick={onAgregar}>
        {falta ? `Falta: ${falta.toLowerCase()}` : `Agregar ${pesos(precio)}`}
      </button>
    </div>
  );
}

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
  const precio = (Number(producto.precio) + sumaExtras(opciones)) * cantidad;

  return (
    <Modal titulo={producto.nombre} onCerrar={onCerrar}>
      <div className="opciones">
        <GruposModificadores
          grupos={producto.modificadores}
          elegidas={elegidas}
          onTocar={(g, max, o) => setElegidas((e) => ({ ...e, [g]: alternar(e[g] ?? [], max, o) }))}
        />
        <label>
          Nota para cocina
          <input value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={200} placeholder="Por ejemplo: sin cebolla" />
        </label>
        <PieCantidad cantidad={cantidad} setCantidad={setCantidad} falta={faltan[0]?.nombre ?? null} precio={precio} onAgregar={() => onAgregar(opciones, cantidad, notas.trim())} />
      </div>
    </Modal>
  );
}

/**
 * Armar un combo: en cada parte se escoge entre sus opciones y, para cada
 * producto escogido, sus propios modificadores (el término de la hamburguesa).
 */
function ArmarCombo({
  combo,
  onCerrar,
  onAgregar,
}: {
  combo: Producto;
  onCerrar: () => void;
  onAgregar: (c: Componente[], cantidad: number, notas: string) => void;
}) {
  // Productos escogidos por parte, y modificadores escogidos por producto de cada parte
  const [elegidos, setElegidos] = useState<Record<string, string[]>>({});
  const [mods, setMods] = useState<Record<string, Record<string, string[]>>>({});
  const [cantidad, setCantidad] = useState(1);
  const [notas, setNotas] = useState('');

  const clave = (seccionId: string, productoId: string) => `${seccionId}:${productoId}`;
  const componentes: Componente[] = combo.secciones.flatMap((s) =>
    s.opciones
      .filter((o) => elegidos[s.id]?.includes(o.productoId))
      .map((o) => {
        const m = mods[clave(s.id, o.productoId)] ?? {};
        return { seccionId: s.id, seccion: s.nombre, opcion: o, mods: o.modificadores.flatMap((g) => g.opciones.filter((x) => m[g.id]?.includes(x.id))) };
      }),
  );
  const faltaParte = combo.secciones.find((s) => (elegidos[s.id]?.length ?? 0) < s.min);
  const faltaMod = componentes
    .map((c) => c.opcion.modificadores.find((g) => ((mods[clave(c.seccionId, c.opcion.productoId)] ?? {})[g.id]?.length ?? 0) < g.min))
    .find(Boolean);
  const precio = (Number(combo.precio) + extrasComponentes(componentes)) * cantidad;

  return (
    <Modal titulo={combo.nombre} onCerrar={onCerrar} ancho="ancho">
      <div className="opciones">
        {combo.secciones.length === 0 && <p className="nota">Este combo todavía no tiene sus partes configuradas.</p>}
        {combo.secciones.map((s) => {
          const n = elegidos[s.id]?.length ?? 0;
          const regla = s.min === 1 && s.max === 1 ? 'Escoge una' : s.min > 0 ? `Escoge de ${s.min} a ${s.max}` : `Opcional, hasta ${s.max}`;
          return (
            <fieldset key={s.id} className={`grupo parte-combo ${n < s.min ? 'grupo-falta' : ''}`}>
              <legend>
                {s.nombre} <span className="nota">{regla}</span>
              </legend>
              <div className="fila-chips">
                {s.opciones.map((o) => {
                  const activa = elegidos[s.id]?.includes(o.productoId) ?? false;
                  return (
                    <button
                      key={o.productoId}
                      className={`chip chip-grande ${activa ? 'activo' : ''}`}
                      aria-pressed={activa}
                      disabled={!activa && s.max > 1 && n >= s.max}
                      onClick={() => setElegidos((e) => ({ ...e, [s.id]: alternar(e[s.id] ?? [], s.max, o.productoId) }))}
                    >
                      {o.nombre}
                      {Number(o.precioExtra) > 0 && <small>+{pesos(o.precioExtra)}</small>}
                    </button>
                  );
                })}
              </div>
              {s.opciones
                .filter((o) => elegidos[s.id]?.includes(o.productoId) && o.modificadores.length)
                .map((o) => (
                  <div key={o.productoId} className="parte-modificadores">
                    <p className="parte-titulo">{o.nombre}</p>
                    <GruposModificadores
                      grupos={o.modificadores}
                      elegidas={mods[clave(s.id, o.productoId)] ?? {}}
                      onTocar={(g, max, x) =>
                        setMods((m) => {
                          const k = clave(s.id, o.productoId);
                          const actual = m[k] ?? {};
                          return { ...m, [k]: { ...actual, [g]: alternar(actual[g] ?? [], max, x) } };
                        })
                      }
                    />
                  </div>
                ))}
            </fieldset>
          );
        })}
        <label>
          Nota para cocina
          <input value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={200} placeholder="Por ejemplo: sin cebolla" />
        </label>
        <PieCantidad
          cantidad={cantidad}
          setCantidad={setCantidad}
          falta={combo.secciones.length === 0 ? 'Configurar el combo' : (faltaParte?.nombre ?? faltaMod?.nombre ?? null)}
          precio={precio}
          onAgregar={() => onAgregar(componentes, cantidad, notas.trim())}
        />
      </div>
    </Modal>
  );
}

const MOTIVOS = ['Error al tomar el pedido', 'El cliente lo canceló', 'Se demoró demasiado', 'Salió mal preparado'];

function Anular({
  item,
  pedidoId,
  onCerrar,
  onAnulado,
}: {
  item: ItemPedido;
  pedidoId: string;
  onCerrar: () => void;
  onAnulado: () => void;
}) {
  const puede = usePuede();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const necesitaSupervisor = !!item.enviadoCocinaEn && !puede('pedido.anular_enviado');

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
          <PedirSupervisor accion="Anular un producto que ya está en cocina" permiso="pedido.anular_enviado" onAutorizar={anular} />
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
