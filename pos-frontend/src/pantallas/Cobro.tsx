import { useRef, useState } from 'react';
import { ApiError, api, mensajeError } from '../api';
import { useAvisar } from '../componentes/Avisos';
import { Modal } from '../componentes/Modal';
import { PedirSupervisor } from '../componentes/Supervisor';
import { usePuede } from '../permisos';
import type { Autorizacion, MetodoPago, Pedido, Venta } from '../tipos';
import { leerPesos, pesos, restarPesos, uuid } from '../util';

const METODOS: { id: MetodoPago; nombre: string }[] = [
  { id: 'efectivo', nombre: 'Efectivo' },
  { id: 'tarjeta', nombre: 'Tarjeta' },
  { id: 'nequi', nombre: 'Nequi' },
  { id: 'daviplata', nombre: 'Daviplata' },
  { id: 'transferencia', nombre: 'Transferencia' },
];

interface Pago {
  clave: string;
  metodo: MetodoPago;
  monto: string;
  recibido: string;
  referencia: string;
}

const num = leerPesos;
const redondear100 = (n: number) => Math.round(n / 100) * 100;

interface Props {
  pedido: Pedido;
  titulo: string;
  onCerrar: () => void;
  onCobrado: () => void;
  onIrCaja: () => void;
}

export function Cobro({ pedido, titulo, onCerrar, onCobrado, onIrCaja }: Props) {
  const puede = usePuede();
  const avisar = useAvisar();
  const bruto = Number(pedido.totales.total);
  const [propinaModo, setPropinaModo] = useState<'no' | '10' | 'otra'>('no');
  const [propinaOtra, setPropinaOtra] = useState('');
  const [descuento, setDescuento] = useState('');
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [pidiendoSupervisor, setPidiendoSupervisor] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<{ texto: string; sinTurno?: boolean } | null>(null);
  const [venta, setVenta] = useState<Venta | null>(null);
  // Una sola clave por intento de cobro: reintentar no cobra dos veces
  const clave = useRef(uuid());

  const desc = Math.min(num(descuento), bruto);
  const propina = propinaModo === '10' ? redondear100(bruto * 0.1) : propinaModo === 'otra' ? num(propinaOtra) : 0;
  const total = restarPesos(bruto, desc - propina);

  // Si no han tocado los pagos, todo va en efectivo por el total
  const lista: Pago[] = pagos.length ? pagos : [{ clave: 'auto', metodo: 'efectivo', monto: String(total), recibido: '', referencia: '' }];
  const pagado = lista.reduce((s, p) => s + num(p.monto), 0);
  const diferencia = restarPesos(total, pagado);
  const cambio = lista
    .filter((p) => p.metodo === 'efectivo' && p.recibido)
    .reduce((s, p) => s + Math.max(0, num(p.recibido) - num(p.monto)), 0);
  const recibidoCorto = lista.some((p) => p.metodo === 'efectivo' && p.recibido && num(p.recibido) < num(p.monto));
  const listo = diferencia === 0 && !recibidoCorto && total > 0;

  function editar(clave: string, cambio: Partial<Pago>) {
    setPagos((ps) => (ps.length ? ps : lista).map((p) => (p.clave === clave ? { ...p, ...cambio } : p)));
  }

  function agregarMetodo() {
    const base = pagos.length ? pagos : lista;
    setPagos([...base, { clave: uuid(), metodo: 'tarjeta', monto: String(Math.max(0, diferencia)), recibido: '', referencia: '' }]);
  }

  async function cobrar(autorizacion?: Autorizacion) {
    if (desc > 0 && !autorizacion && !puede('venta.descuento')) {
      setPidiendoSupervisor(true);
      return;
    }
    setOcupado(true);
    setError(null);
    try {
      const v = await api<Venta>('POST', '/ventas/cobrar', {
        idempotencyKey: clave.current,
        pedidoId: pedido.id,
        descuento: desc || undefined,
        propina: propina || undefined,
        autorizacion,
        pagos: lista
          .filter((p) => num(p.monto) > 0)
          .map((p) => ({
            metodo: p.metodo,
            monto: num(p.monto),
            recibido: p.metodo === 'efectivo' && p.recibido ? num(p.recibido) : undefined,
            referencia: p.referencia.trim() || undefined,
          })),
      });
      setVenta(v);
      setPidiendoSupervisor(false);
    } catch (e) {
      // Un error de supervisor lo muestra el teclado de PIN; los demás, aquí
      if (autorizacion && e instanceof ApiError && e.status === 403) throw e;
      const texto = mensajeError(e);
      setError({ texto, sinTurno: texto.includes('turno abierto') });
      setPidiendoSupervisor(false);
    } finally {
      setOcupado(false);
    }
  }

  if (venta) {
    return (
      <Modal titulo={`${titulo}: cobrado`} onCerrar={onCobrado}>
        <div className="cobrado">
          <p className="cobrado-total">{pesos(venta.total)}</p>
          {Number(venta.cambio) > 0 ? (
            <p className="cobrado-cambio">
              Devuelve <strong>{pesos(venta.cambio)}</strong> de cambio
            </p>
          ) : (
            <p className="nota">Sin cambio.</p>
          )}
          <button
            className="boton boton-primario boton-grande"
            data-autofoco
            onClick={() => {
              avisar(`${titulo} cobrado`, 'exito');
              onCobrado();
            }}
          >
            Listo
          </button>
        </div>
      </Modal>
    );
  }

  if (pidiendoSupervisor) {
    return (
      <Modal titulo="Aprobar descuento" onCerrar={() => setPidiendoSupervisor(false)}>
        <PedirSupervisor accion={`Descuento de ${pesos(desc)} en ${titulo.toLowerCase()}`} permiso="venta.descuento" onAutorizar={cobrar} />
      </Modal>
    );
  }

  return (
    <Modal titulo={`Cobrar ${titulo.toLowerCase()}`} onCerrar={onCerrar} ancho="ancho">
      <div className="cobro">
        <section className="cobro-cuenta">
          <dl className="cuenta">
            <div>
              <dt>Consumo</dt>
              <dd>{pesos(bruto)}</dd>
            </div>
            <div>
              <dt>
                <label htmlFor="descuento">Descuento</label>
              </dt>
              <dd>
                <input id="descuento" inputMode="numeric" value={descuento} onChange={(e) => setDescuento(e.target.value)} placeholder="$0" />
              </dd>
            </div>
            <div>
              <dt>Propina</dt>
              <dd className="fila-chips">
                <button className={`chip ${propinaModo === 'no' ? 'activo' : ''}`} onClick={() => setPropinaModo('no')}>
                  Sin propina
                </button>
                <button className={`chip ${propinaModo === '10' ? 'activo' : ''}`} onClick={() => setPropinaModo('10')}>
                  10% ({pesos(redondear100(bruto * 0.1))})
                </button>
                <button className={`chip ${propinaModo === 'otra' ? 'activo' : ''}`} onClick={() => setPropinaModo('otra')}>
                  Otra
                </button>
                {propinaModo === 'otra' && (
                  <input inputMode="numeric" value={propinaOtra} onChange={(e) => setPropinaOtra(e.target.value)} placeholder="$0" aria-label="Valor de la propina" autoFocus />
                )}
              </dd>
            </div>
            <div className="cuenta-total">
              <dt>Total a cobrar</dt>
              <dd>{pesos(total)}</dd>
            </div>
          </dl>
          {desc > 0 && !puede('venta.descuento') && <p className="nota">El descuento lo aprueba un supervisor al cobrar.</p>}
        </section>

        <section className="cobro-pagos">
          <h3>Cómo paga</h3>
          {lista.map((p) => (
            <div key={p.clave} className="pago">
              <div className="fila-chips">
                {METODOS.map((m) => (
                  <button key={m.id} className={`chip ${p.metodo === m.id ? 'activo' : ''}`} onClick={() => editar(p.clave, { metodo: m.id })}>
                    {m.nombre}
                  </button>
                ))}
                {lista.length > 1 && (
                  <button className="chip chip-quitar" onClick={() => setPagos(lista.filter((x) => x !== p))} aria-label="Quitar este pago">
                    Quitar
                  </button>
                )}
              </div>
              <div className="pago-campos">
                <label>
                  Monto
                  <input inputMode="numeric" value={p.monto} onChange={(e) => editar(p.clave, { monto: e.target.value })} />
                </label>
                {p.metodo === 'efectivo' ? (
                  <label>
                    Recibido
                    <input inputMode="numeric" value={p.recibido} onChange={(e) => editar(p.clave, { recibido: e.target.value })} placeholder="Para calcular el cambio" />
                  </label>
                ) : (
                  <label>
                    Referencia
                    <input value={p.referencia} onChange={(e) => editar(p.clave, { referencia: e.target.value })} placeholder="Voucher o comprobante" />
                  </label>
                )}
              </div>
              {p.metodo === 'efectivo' && (
                <div className="fila-chips billetes">
                  {[num(p.monto), 50_000, 100_000].filter((v, i, a) => v > 0 && v >= num(p.monto) && a.indexOf(v) === i).map((v) => (
                    <button key={v} className="chip" onClick={() => editar(p.clave, { recibido: String(v) })}>
                      {v === num(p.monto) ? 'Exacto' : pesos(v)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button className="boton boton-suave" onClick={agregarMetodo}>
            Dividir con otro método
          </button>

          <div className="cobro-estado">
            {diferencia > 0 && <p className="falta">Faltan {pesos(diferencia)}</p>}
            {diferencia < 0 && <p className="falta">Sobran {pesos(-diferencia)}: ajusta los montos</p>}
            {recibidoCorto && <p className="falta">El efectivo recibido no alcanza</p>}
            {listo && cambio > 0 && (
              <p className="cambio">
                Cambio: <strong>{pesos(cambio)}</strong>
              </p>
            )}
          </div>

          {error && (
            <div className="error-bloque">
              <p>{error.sinTurno ? 'La caja está cerrada. Ábrela para poder cobrar.' : error.texto}</p>
              {error.sinTurno && (
                <button className="boton" onClick={onIrCaja}>
                  Ir a la caja
                </button>
              )}
            </div>
          )}

          <button className="boton boton-primario boton-grande" disabled={!listo || ocupado} onClick={() => cobrar()}>
            {ocupado ? 'Cobrando…' : `Cobrar ${pesos(total)}`}
          </button>
        </section>
      </div>
    </Modal>
  );
}
