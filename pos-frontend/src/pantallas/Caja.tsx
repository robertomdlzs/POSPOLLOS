import { useState } from 'react';
import { ApiError, api, mensajeError } from '../api';
import { useAvisar } from '../componentes/Avisos';
import { Modal } from '../componentes/Modal';
import { PedirSupervisor } from '../componentes/Supervisor';
import type { Autorizacion, Rol, Turno } from '../tipos';
import { esSupervisor, pesos, useDatos } from '../util';

const num = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0;

const NOMBRE_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

interface Cierre {
  diferencia: string;
  turno: { monto_esperado: string; monto_contado: string };
}

export function Caja({ rol }: { rol: Rol }) {
  const avisar = useAvisar();
  // 404 significa "no hay turno abierto", que no es un error sino el punto de partida
  const turno = useDatos(async () => {
    try {
      return await api<Turno>('GET', '/caja/turnos/actual');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }, []);
  const [base, setBase] = useState('');
  const [movimiento, setMovimiento] = useState<'ingreso' | 'egreso' | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [cierre, setCierre] = useState<Cierre | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function abrir() {
    setOcupado(true);
    try {
      await api('POST', '/caja/turnos', { montoInicial: num(base) });
      avisar('Caja abierta', 'exito');
      setCierre(null);
      setBase('');
      turno.recargar();
    } catch (e) {
      avisar(mensajeError(e), 'error');
    } finally {
      setOcupado(false);
    }
  }

  if (turno.cargando && !turno.datos) return <div className="caja-pantalla" />;
  if (turno.error) return <div className="caja-pantalla"><p className="error">{turno.error}</p></div>;

  const t = turno.datos;
  if (!t) {
    return (
      <div className="caja-pantalla">
        {cierre && <ResultadoCierre cierre={cierre} />}
        <section className="tarjeta caja-abrir">
          <h1>La caja está cerrada</h1>
          <p>Cuenta el efectivo con el que empiezas el turno y escríbelo como base.</p>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              abrir();
            }}
          >
            <label>
              Base en efectivo
              <input inputMode="numeric" value={base} onChange={(e) => setBase(e.target.value)} placeholder="$0" data-autofoco />
            </label>
            <button className="boton boton-primario boton-grande" disabled={ocupado}>
              Abrir caja con {pesos(num(base))}
            </button>
          </form>
        </section>
      </div>
    );
  }

  const r = t.resumen;
  // En caja a ciegas el servidor no manda el efectivo cobrado ni el total de ventas
  const esperado = t.ciego ? null : Number(t.monto_inicial) + Number(r.efectivo) + Number(r.ingresos) - Number(r.egresos);

  return (
    <div className="caja-pantalla">
      <section className="tarjeta">
        <header className="seccion-cabeza">
          <div>
            <h1>{t.caja}</h1>
            <p className="nota">Abierta desde las {new Date(t.abierto_en).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</p>
          </div>
          <button className="boton boton-peligro" onClick={() => setCerrando(true)}>
            Cerrar caja
          </button>
        </header>

        <div className="cifras">
          {esperado === null ? (
            <div className="cifra cifra-destacada">
              <span>Cierre a ciegas</span>
              <small>Al cerrar cuentas el efectivo del cajón y el sistema lo compara con lo que debería haber.</small>
            </div>
          ) : (
            <div className="cifra cifra-destacada">
              <span>Efectivo que debe haber</span>
              <strong>{pesos(esperado)}</strong>
            </div>
          )}
          <div className="cifra">
            <span>Ventas</span>
            <strong>{r.totalVentas === undefined ? r.ventas : pesos(r.totalVentas)}</strong>
            <small>
              {r.totalVentas === undefined ? (r.ventas === 1 ? 'cuenta' : 'cuentas') : `${r.ventas} ${r.ventas === 1 ? 'cuenta' : 'cuentas'}`}
              {r.anuladas > 0 && `, ${r.anuladas} anuladas`}
            </small>
          </div>
          <div className="cifra">
            <span>Propinas</span>
            <strong>{pesos(r.propinas)}</strong>
          </div>
        </div>

        <div className="caja-detalle">
          <table className="tabla">
            <caption>{t.ciego ? 'Cobrado con otros métodos' : 'Cobrado por método'}</caption>
            <tbody>
              {Object.keys(r.porMetodo).length === 0 && (
                <tr>
                  <td colSpan={2} className="nota">
                    Todavía no hay cobros en este turno.
                  </td>
                </tr>
              )}
              {Object.entries(r.porMetodo).map(([m, v]) => (
                <tr key={m}>
                  <td>{NOMBRE_METODO[m] ?? m}</td>
                  <td>{pesos(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="tabla">
            <caption>Efectivo</caption>
            <tbody>
              <tr>
                <td>Base</td>
                <td>{pesos(t.monto_inicial)}</td>
              </tr>
              {r.efectivo !== undefined && (
                <tr>
                  <td>Cobros en efectivo</td>
                  <td>{pesos(r.efectivo)}</td>
                </tr>
              )}
              <tr>
                <td>Ingresos</td>
                <td>{pesos(r.ingresos)}</td>
              </tr>
              <tr>
                <td>Retiros</td>
                <td>−{pesos(r.egresos)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="fila-botones">
          <button className="boton" onClick={() => setMovimiento('ingreso')}>
            Registrar ingreso
          </button>
          <button className="boton" onClick={() => setMovimiento('egreso')}>
            Registrar retiro
          </button>
        </div>
      </section>

      {movimiento && (
        <Movimiento
          tipo={movimiento}
          turnoId={t.id}
          rol={rol}
          onCerrar={() => setMovimiento(null)}
          onHecho={() => {
            avisar(movimiento === 'ingreso' ? 'Ingreso registrado' : 'Retiro registrado', 'exito');
            setMovimiento(null);
            turno.recargar();
          }}
        />
      )}
      {cerrando && (
        <CerrarCaja
          turnoId={t.id}
          onCerrar={() => setCerrando(false)}
          onCerrada={(c) => {
            setCerrando(false);
            setCierre(c);
            turno.recargar();
          }}
        />
      )}
    </div>
  );
}

function ResultadoCierre({ cierre }: { cierre: Cierre }) {
  const d = Number(cierre.diferencia);
  return (
    <section className={`tarjeta resultado-cierre ${d === 0 ? 'cuadra' : 'descuadre'}`}>
      <h2>{d === 0 ? 'La caja cuadró' : d > 0 ? `Sobraron ${pesos(d)}` : `Faltaron ${pesos(-d)}`}</h2>
      <p>
        Debía haber {pesos(cierre.turno.monto_esperado)} y se contaron {pesos(cierre.turno.monto_contado)}.
      </p>
    </section>
  );
}

function CerrarCaja({ turnoId, onCerrar, onCerrada }: { turnoId: string; onCerrar: () => void; onCerrada: (c: Cierre) => void }) {
  const [contado, setContado] = useState('');
  const [observacion, setObservacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  return (
    <Modal titulo="Cerrar caja" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={async (e) => {
          e.preventDefault();
          setOcupado(true);
          try {
            onCerrada(await api<Cierre>('POST', `/caja/turnos/${turnoId}/cerrar`, { montoContado: num(contado), observacion: observacion.trim() || undefined }));
          } catch (err) {
            setError(mensajeError(err));
          } finally {
            setOcupado(false);
          }
        }}
      >
        <p>Cuenta todo el efectivo del cajón, incluida la base, y escribe el total. El sistema lo compara con lo que debería haber.</p>
        <label>
          Efectivo contado
          <input inputMode="numeric" value={contado} onChange={(e) => setContado(e.target.value)} placeholder="$0" data-autofoco required />
        </label>
        <label>
          Observación
          <input value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={300} placeholder="Opcional" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="boton boton-peligro boton-grande" disabled={ocupado || !contado}>
          Cerrar caja con {pesos(num(contado))}
        </button>
      </form>
    </Modal>
  );
}

function Movimiento({
  tipo,
  turnoId,
  rol,
  onCerrar,
  onHecho,
}: {
  tipo: 'ingreso' | 'egreso';
  turnoId: string;
  rol: Rol;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [aprobar, setAprobar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async (autorizacion?: Autorizacion) => {
    await api('POST', `/caja/turnos/${turnoId}/movimientos`, { tipo, monto: num(monto), motivo: motivo.trim(), autorizacion });
    onHecho();
  };
  const listo = num(monto) > 0 && motivo.trim().length >= 3;

  if (aprobar) {
    return (
      <Modal titulo="Aprobar retiro" onCerrar={onCerrar}>
        <PedirSupervisor accion={`Retirar ${pesos(num(monto))} de la caja`} onAutorizar={guardar} />
      </Modal>
    );
  }

  return (
    <Modal titulo={tipo === 'ingreso' ? 'Ingreso de efectivo' : 'Retiro de efectivo'} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!listo) return;
          if (tipo === 'egreso' && !esSupervisor(rol)) return setAprobar(true);
          try {
            await guardar();
          } catch (err) {
            setError(mensajeError(err));
          }
        }}
      >
        <label>
          Monto
          <input inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$0" data-autofoco />
        </label>
        <label>
          Motivo
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={200}
            placeholder={tipo === 'ingreso' ? 'Por ejemplo: cambio para la caja' : 'Por ejemplo: pago al proveedor de hielo'}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="boton boton-primario boton-grande" disabled={!listo}>
          {tipo === 'ingreso' ? `Registrar ingreso de ${pesos(num(monto))}` : `Retirar ${pesos(num(monto))}`}
        </button>
      </form>
    </Modal>
  );
}
