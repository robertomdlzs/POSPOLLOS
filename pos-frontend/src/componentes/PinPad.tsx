import { useEffect } from 'react';

interface Props {
  valor: string;
  onCambio: (v: string) => void;
  onEnviar: () => void;
  ocupado?: boolean;
  textoBoton?: string;
  maximo?: number;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'] as const;

/** Teclado numérico grande para PIN; también responde al teclado físico */
export function PinPad({ valor, onCambio, onEnviar, ocupado, textoBoton = 'Entrar', maximo = 8 }: Props) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (ocupado) return;
      if (/^\d$/.test(e.key) && valor.length < maximo) onCambio(valor + e.key);
      else if (e.key === 'Backspace') onCambio(valor.slice(0, -1));
      else if (e.key === 'Enter' && valor.length >= 4) onEnviar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [valor, onCambio, onEnviar, ocupado, maximo]);

  return (
    <div className="pinpad">
      <div className="pin-puntos" aria-label={`${valor.length} dígitos escritos`}>
        {Array.from({ length: Math.max(4, valor.length) }, (_, i) => (
          <span key={i} className={i < valor.length ? 'lleno' : ''} />
        ))}
      </div>
      <div className="pin-teclas">
        {TECLAS.map((t) =>
          t === 'borrar' ? (
            <button key={t} className="tecla tecla-suave" onClick={() => onCambio(valor.slice(0, -1))} disabled={ocupado} aria-label="Borrar">
              ⌫
            </button>
          ) : t === 'ok' ? (
            <button key={t} className="tecla tecla-ok" onClick={onEnviar} disabled={ocupado || valor.length < 4}>
              {ocupado ? '…' : textoBoton}
            </button>
          ) : (
            <button key={t} className="tecla" onClick={() => valor.length < maximo && onCambio(valor + t)} disabled={ocupado}>
              {t}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
