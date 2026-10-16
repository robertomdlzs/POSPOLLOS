import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ApiError, mensajeError } from '../api';

// ---------------------------------------------------------------------------
// Estado del formulario
// ---------------------------------------------------------------------------

export type Errores<T> = Partial<Record<keyof T & string, string>>;

/**
 * Valores, errores por campo y envío. `validar` corre en el navegador antes de
 * enviar; si el servidor responde 400, cada mensaje de class-validator
 * ("precio must not be less than 0") se pone en su campo cuando empieza con
 * el nombre de uno, y el resto queda como error general.
 */
export function useFormulario<T extends Record<string, unknown>>(inicial: T, validar?: (v: T) => Errores<T>) {
  const [valores, setValores] = useState<T>(inicial);
  const [errores, setErrores] = useState<Errores<T>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar =
    <K extends keyof T & string>(campo: K) =>
    (valor: T[K]) => {
      setValores((v) => ({ ...v, [campo]: valor }));
      setErrores((e) => (e[campo] ? { ...e, [campo]: undefined } : e));
    };

  async function enviar(accion: (v: T) => Promise<void>) {
    const locales = validar?.(valores) ?? {};
    setGeneral(null);
    if (Object.values(locales).some(Boolean)) {
      setErrores(locales);
      return;
    }
    setEnviando(true);
    try {
      await accion(valores);
    } catch (e) {
      const { porCampo, resto } = repartirErrores(e, Object.keys(valores));
      setErrores(porCampo as Errores<T>);
      setGeneral(resto);
    } finally {
      setEnviando(false);
    }
  }

  return { valores, errores, general, enviando, cambiar, enviar, setValores, reiniciar: () => setValores(inicial) };
}

function repartirErrores(e: unknown, campos: string[]) {
  const porCampo: Record<string, string> = {};
  if (!(e instanceof ApiError) || e.status !== 400) return { porCampo, resto: mensajeError(e) };
  const sueltos: string[] = [];
  for (const m of e.message.split('. ')) {
    const campo = campos.find((c) => m === c || m.startsWith(`${c} `));
    if (campo && !porCampo[campo]) porCampo[campo] = m.slice(campo.length).trim() || 'Valor no válido';
    else sueltos.push(m);
  }
  return { porCampo, resto: sueltos.length ? sueltos.join('. ') : null };
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

interface Envoltura {
  etiqueta: string;
  error?: string;
  ayuda?: ReactNode;
}

function Envolver({ id, etiqueta, error, ayuda, children }: Envoltura & { id: string; children: ReactNode }) {
  return (
    <div className={`campo ${error ? 'campo-con-error' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {error ? (
        <p className="campo-error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        ayuda && (
          <p className="nota" id={`${id}-ayuda`}>
            {ayuda}
          </p>
        )
      )}
    </div>
  );
}

type PropsCampo = Envoltura & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { onCambio: (v: string) => void };

/** Campo de texto con etiqueta, ayuda y error unidos por aria */
export function Campo({ etiqueta, error, ayuda, onCambio, ...input }: PropsCampo) {
  const id = useId();
  return (
    <Envolver id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : ayuda ? `${id}-ayuda` : undefined}
        onChange={(e) => onCambio(e.target.value)}
        {...input}
      />
    </Envolver>
  );
}

type PropsSelector = Envoltura &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
    opciones: { valor: string; texto: string }[];
    vacio?: string;
    onCambio: (v: string) => void;
  };

/** Lista desplegable nativa: en la tablet abre el selector del sistema, que es el más cómodo */
export function Selector({ etiqueta, error, ayuda, opciones, vacio, onCambio, ...select }: PropsSelector) {
  const id = useId();
  return (
    <Envolver id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <select
        id={id}
        className="selector"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onCambio(e.target.value)}
        {...select}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </Envolver>
  );
}

/** Interruptor de sí/no (activo, agotado, controla stock…) */
export function Interruptor({
  etiqueta,
  activo,
  onCambio,
  ayuda,
  disabled,
}: {
  etiqueta: string;
  activo: boolean;
  onCambio: (v: boolean) => void;
  ayuda?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="interruptor-fila">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={activo}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        className={`interruptor ${activo ? 'encendido' : ''}`}
        onClick={() => onCambio(!activo)}
        disabled={disabled}
      >
        <span className="interruptor-perilla" aria-hidden="true" />
      </button>
      <label htmlFor={id} className="interruptor-etiqueta">
        {etiqueta}
        {ayuda && (
          <span className="nota" id={`${id}-ayuda`}>
            {ayuda}
          </span>
        )}
      </label>
    </div>
  );
}
