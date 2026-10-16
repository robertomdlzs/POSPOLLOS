import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tipo = 'info' | 'exito' | 'error' | 'listo';
interface Aviso {
  id: number;
  texto: string;
  tipo: Tipo;
}

const Ctx = createContext<(texto: string, tipo?: Tipo) => void>(() => undefined);
export const useAvisar = () => useContext(Ctx);

let siguiente = 1;

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const avisar = useCallback((texto: string, tipo: Tipo = 'info') => {
    const id = siguiente++;
    setAvisos((a) => [...a.slice(-3), { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'error' ? 7000 : 4500);
  }, []);

  return (
    <Ctx.Provider value={avisar}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <button
            key={a.id}
            className={`aviso aviso-${a.tipo}`}
            onClick={() => setAvisos((x) => x.filter((y) => y.id !== a.id))}
          >
            {a.texto}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}
