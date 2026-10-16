import { useEffect, useState } from 'react';
import { ApiError, api, fijarSesion, mensajeError } from '../api';
import { PinPad } from '../componentes/PinPad';
import type { Sesion, UsuarioLista } from '../tipos';
import { CLAVES, useDatos } from '../datos';
import { NOMBRE_ROL } from '../util';

function Reloj() {
  const [ahora, setAhora] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="reloj">
      <span className="reloj-hora">{ahora.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span>
      <span className="reloj-fecha">{ahora.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </div>
  );
}

export function Ingreso() {
  const { datos: usuarios, error: errorCarga, recargar } = useDatos(CLAVES.usuarios, () => api<UsuarioLista[]>('GET', '/auth/usuarios'));
  const [elegido, setElegido] = useState<UsuarioLista | null>(null);
  const [pin, setPin] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar() {
    if (!elegido) return;
    setOcupado(true);
    setError(null);
    try {
      fijarSesion(await api<Sesion>('POST', '/auth/pin', { usuarioId: elegido.id, pin }));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'PIN incorrecto' : mensajeError(e));
      setPin('');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="ingreso">
      <section className="ingreso-izq">
        <Reloj />
        <h1>¿Quién está trabajando?</h1>
        {errorCarga && (
          <div className="error-bloque">
            <p>{errorCarga}</p>
            <button className="boton" onClick={recargar}>
              Reintentar
            </button>
          </div>
        )}
        <div className="personas">
          {usuarios?.map((u) => (
            <button
              key={u.id}
              className={`persona ${elegido?.id === u.id ? 'activa' : ''}`}
              onClick={() => {
                setElegido(u);
                setPin('');
                setError(null);
              }}
            >
              <span className="persona-inicial" aria-hidden="true">
                {u.nombre.charAt(0)}
              </span>
              <span className="persona-nombre">{u.nombre}</span>
              <span className="persona-rol">{NOMBRE_ROL[u.rol]}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="ingreso-der">
        {elegido ? (
          <>
            <p className="ingreso-saludo">
              Hola, <strong>{elegido.nombre.split(' ')[0]}</strong>. Escribe tu PIN.
            </p>
            <PinPad valor={pin} onCambio={setPin} onEnviar={entrar} ocupado={ocupado} />
            <p className={`error ${error ? '' : 'invisible'}`}>{error ?? '.'}</p>
          </>
        ) : (
          <p className="ingreso-vacio">Toca tu nombre para entrar.</p>
        )}
      </section>
    </main>
  );
}
