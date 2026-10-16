import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  ancho?: 'normal' | 'ancho';
}

export function Modal({ titulo, onCerrar, children, ancho = 'normal' }: Props) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    caja.current?.querySelector<HTMLElement>('[data-autofoco], button, input, select')?.focus();
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, [onCerrar]);

  return (
    <div className="velo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={`modal modal-${ancho}`} role="dialog" aria-modal="true" aria-label={titulo} ref={caja}>
        <header className="modal-cabeza">
          <h2>{titulo}</h2>
          <button className="boton-icono" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="modal-cuerpo">{children}</div>
      </div>
    </div>
  );
}
