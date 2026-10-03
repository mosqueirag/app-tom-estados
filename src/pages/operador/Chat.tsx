import { useAuth } from '@/auth/contexto';
import { Conversacion } from '@/components/Conversacion';

/** Chat del operador con la administración. */
export default function ChatOperador() {
  const auth = useAuth();
  const operadorId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  if (!operadorId) return null;
  return (
    <div className="-mx-4 -mt-4 flex h-[calc(100dvh-10.5rem)] flex-col">
      <div className="fondo-marca-suave border-b border-marca-100 px-4 py-2">
        <h1 className="font-semibold">Chat con la administración</h1>
        <p className="text-xs text-slate-500">Escribí dudas o avisos. Te responden por acá.</p>
      </div>
      <Conversacion modo="operador" operadorId={operadorId} />
    </div>
  );
}
