import type { ReactNode } from 'react';

/** Lo que se ve cuando una lista no tiene nada: qué falta y, si aplica, cómo empezar */
export function EstadoVacio({ titulo, texto, accion }: { titulo: string; texto?: string; accion?: ReactNode }) {
  return (
    <div className="estado-vacio">
      <p className="estado-vacio-titulo">{titulo}</p>
      {texto && <p className="nota">{texto}</p>}
      {accion}
    </div>
  );
}
