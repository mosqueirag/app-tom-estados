import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { mensajeError } from '@/lib/consultas';

export type Consulta<T> = {
  datos: T | undefined;
  cargando: boolean;
  error: string | null;
  recargar: () => Promise<void>;
};

/** Ejecuta una función async y guarda su resultado. Se re-ejecuta cuando cambian las dependencias. */
export function useConsulta<T>(funcion: () => Promise<T>, deps: DependencyList): Consulta<T> {
  const [datos, setDatos] = useState<T>();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ejecutar = useCallback(funcion, deps);

  const recargar = useCallback(async () => {
    const id = ++ultima.current;
    setCargando(true);
    setError(null);
    try {
      const resultado = await ejecutar();
      if (id === ultima.current) setDatos(resultado);
    } catch (e) {
      if (id === ultima.current) setError(mensajeError(e));
    } finally {
      if (id === ultima.current) setCargando(false);
    }
  }, [ejecutar]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { datos, cargando, error, recargar };
}

/** Devuelve el valor recién cuando deja de cambiar por `ms` milisegundos (para búsquedas). */
export function useDemorado<T>(valor: T, ms = 300): T {
  const [demorado, setDemorado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDemorado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return demorado;
}
