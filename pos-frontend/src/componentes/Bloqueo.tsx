import { useEffect, useRef, useState } from 'react';
import { ApiError, api, cerrarSesion, mensajeError } from '../api';
import { PinPad } from './PinPad';

/** Minutos sin tocar la pantalla antes de pedir el PIN otra vez */
const MINUTOS = Number(import.meta.env.VITE_MINUTOS_BLOQUEO ?? 3) || 3;
const EVENTOS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** true cuando pasaron MINUTOS sin actividad; `activo = false` lo apaga (pantalla de cocina) */
export function useInactividad(activo: boolean): [boolean, () => void] {
  const [bloqueada, setBloqueada] = useState(false);
  const ultima = useRef(Date.now());

  useEffect(() => {
    if (!activo) return;
    const tocar = () => {
      ultima.current = Date.now();
    };
    EVENTOS.forEach((e) => window.addEventListener(e, tocar, { passive: true }));
    const reloj = setInterval(() => {
      if (Date.now() - ultima.current >= MINUTOS * 60_000) setBloqueada(true);
    }, 10_000);
    return () => {
      EVENTOS.forEach((e) => window.removeEventListener(e, tocar));
      clearInterval(reloj);
    };
  }, [activo]);

  return [
    activo && bloqueada,
    () => {
      ultima.current = Date.now();
      setBloqueada(false);
    },
  ];
}

/**
 * Tapa la pantalla sin desmontar lo de abajo: el pedido a medio tomar, el
 * cobro abierto o lo que estuviera en curso sigue ahí al volver.
 */
export function Bloqueo({ nombre, onDesbloquear }: { nombre: string; onDesbloquear: () => void }) {
  const [pin, setPin] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar() {
    setOcupado(true);
    setError(null);
    try {
      await api('POST', '/auth/desbloquear', { pin });
      onDesbloquear();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'PIN incorrecto' : mensajeError(e));
      setPin('');
    } finally {
      setOcupado(false);
    }
  }

  // Las teclas no deben llegar a la pantalla de abajo (un Escape cerraría un
  // modal y un número entraría en otro teclado de PIN): se atrapan aquí primero
  const estado = useRef({ pin, ocupado, entrar });
  estado.current = { pin, ocupado, entrar };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const { pin, ocupado, entrar } = estado.current;
      if (ocupado) return;
      if (/^\d$/.test(e.key) && pin.length < 8) setPin(pin + e.key);
      else if (e.key === 'Backspace') setPin(pin.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 4) entrar();
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, []);

  return (
    <div className="bloqueo" role="dialog" aria-modal="true" aria-label="Pantalla bloqueada">
      <p className="bloqueo-titulo">Pantalla bloqueada por inactividad</p>
      <p className="ingreso-saludo">
        <strong>{nombre.split(' ')[0]}</strong>, escribe tu PIN para seguir.
      </p>
      <PinPad valor={pin} onCambio={setPin} onEnviar={entrar} ocupado={ocupado} textoBoton="Seguir" />
      <p className={`error ${error ? '' : 'invisible'}`}>{error ?? '.'}</p>
      <button className="boton boton-barra" onClick={cerrarSesion}>
        Soy otra persona
      </button>
    </div>
  );
}
