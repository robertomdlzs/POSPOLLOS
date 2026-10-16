import { useEffect, useId, useState } from 'react';

const MB = 1024 * 1024;

interface Props {
  etiqueta: string;
  /** Foto que ya tiene guardada, si tiene */
  actual?: string | null;
  /** El archivo elegido, o null si se quitó */
  onCambio: (archivo: File | null) => void;
  maximoMb?: number;
}

/**
 * Elegir una foto tocando o arrastrándola, con vista previa antes de guardar.
 * Solo valida tipo y peso; el servidor la redimensiona (tarea 1.3.2).
 */
export function CargaImagen({ etiqueta, actual, onCambio, maximoMb = 5 }: Props) {
  const id = useId();
  const [previa, setPrevia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);

  // La URL temporal de la vista previa se libera al cambiarla o al salir
  useEffect(() => () => void (previa && URL.revokeObjectURL(previa)), [previa]);

  function elegir(archivo: File | undefined) {
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) return setError('Eso no es una imagen.');
    if (archivo.size > maximoMb * MB) return setError(`La foto pesa más de ${maximoMb} MB.`);
    setError(null);
    setPrevia(URL.createObjectURL(archivo));
    onCambio(archivo);
  }

  const mostrada = previa ?? actual ?? null;

  return (
    <div className="campo">
      <span className="campo-etiqueta" id={`${id}-etiqueta`}>
        {etiqueta}
      </span>
      <label
        htmlFor={id}
        className={`carga-imagen ${encima ? 'encima' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          elegir(e.dataTransfer.files[0]);
        }}
      >
        {mostrada ? <img src={mostrada} alt="" /> : <span className="nota">Toca para elegir una foto o arrástrala aquí</span>}
        <input
          id={id}
          type="file"
          accept="image/*"
          className="solo-lector"
          aria-labelledby={`${id}-etiqueta`}
          onChange={(e) => {
            elegir(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {mostrada && (
        <button
          type="button"
          className="chip chip-quitar"
          onClick={() => {
            setPrevia(null);
            onCambio(null);
          }}
        >
          Quitar foto
        </button>
      )}
      {error && <p className="campo-error">{error}</p>}
    </div>
  );
}
