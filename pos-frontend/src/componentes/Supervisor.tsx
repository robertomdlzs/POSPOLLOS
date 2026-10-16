import { useState } from 'react';
import { api, mensajeError } from '../api';
import type { Permiso } from '../permisos';
import type { Autorizacion } from '../tipos';
import { CLAVES, useDatos } from '../datos';
import { PinPad } from './PinPad';

interface Props {
  /** Qué se está autorizando, en palabras del usuario: "Aplicar un descuento de $4.000" */
  accion: string;
  /** Lo que tiene que poder hacer quien aprueba */
  permiso: Permiso;
  onAutorizar: (a: Autorizacion) => Promise<void>;
}

/** Alguien con el permiso escoge su nombre y escribe su PIN para aprobar una acción */
export function PedirSupervisor({ accion, permiso, onAutorizar }: Props) {
  const { datos } = useDatos(CLAVES.autorizadores(permiso), () =>
    api<{ id: string; nombre: string }[]>('GET', `/auth/autorizadores?permiso=${permiso}`),
  );
  const supervisores = datos ?? [];
  const [elegido, setElegido] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = elegido ?? (supervisores.length === 1 ? supervisores[0].id : null);

  async function enviar() {
    if (!id) return;
    setOcupado(true);
    setError(null);
    try {
      await onAutorizar({ supervisorId: id, pin });
    } catch (e) {
      setError(mensajeError(e));
      setPin('');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="supervisor">
      <p className="supervisor-accion">{accion}. Necesita la aprobación de un supervisor.</p>
      {supervisores.length > 1 && (
        <div className="fila-chips">
          {supervisores.map((s) => (
            <button key={s.id} className={`chip ${id === s.id ? 'activo' : ''}`} onClick={() => setElegido(s.id)}>
              {s.nombre}
            </button>
          ))}
        </div>
      )}
      {id ? (
        <PinPad valor={pin} onCambio={setPin} onEnviar={enviar} ocupado={ocupado} textoBoton="Aprobar" />
      ) : (
        <p className="nota">Escoge quién aprueba.</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
