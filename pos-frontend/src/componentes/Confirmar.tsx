import { useState } from 'react';
import { mensajeError } from '../api';
import { Modal } from './Modal';

interface Props {
  titulo: string;
  /** Qué va a pasar, en palabras del usuario: "Se desactiva Hamburguesa doble…" */
  mensaje: string;
  textoConfirmar?: string;
  /** Rojo para lo que borra o desactiva; verde para el resto */
  peligro?: boolean;
  onConfirmar: () => Promise<void>;
  onCerrar: () => void;
}

/** Pide confirmar antes de algo que no se deshace fácil, y muestra el error si falla */
export function Confirmar({ titulo, mensaje, textoConfirmar = 'Confirmar', peligro = true, onConfirmar, onCerrar }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal titulo={titulo} onCerrar={onCerrar}>
      <div className="formulario">
        <p>{mensaje}</p>
        {error && <p className="error">{error}</p>}
        <div className="fila-botones fila-botones-fin">
          <button className="boton" onClick={onCerrar} data-autofoco>
            Cancelar
          </button>
          <button
            className={`boton ${peligro ? 'boton-rojo' : 'boton-primario'}`}
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              setError(null);
              try {
                await onConfirmar();
              } catch (e) {
                setError(mensajeError(e));
                setOcupado(false);
              }
            }}
          >
            {ocupado ? 'Un momento…' : textoConfirmar}
          </button>
        </div>
      </div>
    </Modal>
  );
}
