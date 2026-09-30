// Tipos de la base de datos (mismo formato que `supabase gen types typescript`).
// Si cambiás las migraciones, podés regenerarlos con:
//   npx supabase gen types typescript --project-id TU_PROYECTO > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Rol = 'admin' | 'operador';
export type MotivoConflicto = 'ya_leida' | 'periodo_cerrado' | 'reemplazada';
export type EstadoSincronizacion = 'sincronizada' | 'conflicto' | 'rechazada';

type Tabla<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Perfil = {
  id: string;
  nombre: string;
  email: string | null;
  usuario: string | null;
  rol: Rol;
  activo: boolean;
  created_at: string;
};

export type Cuenta = {
  id: string;
  numero_cuenta: string;
  titular: string;
  direccion: string;
  medidor: string;
  ultima_lectura: number | null;
  fecha_ultima_lectura: string | null;
  ultimo_consumo: number | null;
  activa: boolean;
  ruta: string;
  operador_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Periodo = {
  id: string;
  nombre: string;
  fecha_inicio: string;
  fecha_cierre: string | null;
  activo: boolean;
  cerrado_por: string | null;
  created_at: string;
};

export type Configuracion = {
  id: number;
  umbral_consumo_anomalo: number;
  updated_at: string;
};

export type Lectura = {
  id: string;
  cuenta_id: string;
  periodo_id: string;
  operador_id: string;
  lectura_anterior: number | null;
  lectura_actual: number | null;
  consumo: number | null;
  observacion: string | null;
  sin_lectura: boolean;
  fecha_lectura: string;
  sincronizado_at: string;
  corregida_por: string | null;
  corregida_at: string | null;
};

export type LecturaCorreccion = {
  id: number;
  lectura_id: string;
  corregida_por: string | null;
  corregida_at: string;
  lectura_actual_anterior: number | null;
  lectura_actual_nueva: number | null;
  sin_lectura_anterior: boolean | null;
  sin_lectura_nueva: boolean | null;
  observacion_anterior: string | null;
  observacion_nueva: string | null;
};

export type LecturaConflicto = {
  id: string;
  cuenta_id: string;
  periodo_id: string;
  operador_id: string;
  lectura_actual: number | null;
  observacion: string | null;
  sin_lectura: boolean;
  fecha_lectura: string;
  motivo: MotivoConflicto;
  lectura_existente_id: string | null;
  created_at: string;
  resuelto: boolean;
  resolucion: 'descartada' | 'reemplaza' | null;
  resuelto_por: string | null;
  resuelto_at: string | null;
};

export type VLectura = {
  id: string;
  periodo_id: string;
  periodo_nombre: string;
  cuenta_id: string;
  numero_cuenta: string;
  titular: string;
  direccion: string;
  medidor: string;
  operador_id: string;
  operador_nombre: string | null;
  lectura_anterior: number | null;
  lectura_actual: number | null;
  consumo: number | null;
  ultimo_consumo: number | null;
  observacion: string | null;
  sin_lectura: boolean;
  fecha_lectura: string;
  sincronizado_at: string;
  corregida_por: string | null;
  corregida_por_nombre: string | null;
  corregida_at: string | null;
  alerta_menor_anterior: boolean;
  alerta_consumo_anomalo: boolean;
  alerta_sin_lectura: boolean;
  ruta: string;
};

export type VRuta = {
  ruta: string;
  cuentas: number;
  sin_asignar: number;
  pendientes: number;
  operador_id: string | null;
  operador_nombre: string | null;
  repartida: boolean;
};

export type SuscripcionPush = {
  id: number;
  perfil_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
};

export type VOperador = Pick<Perfil, 'id' | 'nombre' | 'email' | 'usuario' | 'rol' | 'activo' | 'created_at'> & {
  lecturas_periodo_activo: number;
  lecturas_total: number;
  ultima_lectura_at: string | null;
  conflictos_pendientes: number;
};

export type VConflicto = {
  id: string;
  periodo_id: string;
  periodo_nombre: string;
  periodo_activo: boolean;
  cuenta_id: string;
  numero_cuenta: string;
  titular: string;
  direccion: string;
  medidor: string;
  operador_id: string;
  operador_nombre: string | null;
  lectura_actual: number | null;
  sin_lectura: boolean;
  observacion: string | null;
  fecha_lectura: string;
  motivo: MotivoConflicto;
  created_at: string;
  resuelto: boolean;
  resolucion: 'descartada' | 'reemplaza' | null;
  resuelto_at: string | null;
  existente_id: string | null;
  existente_lectura_actual: number | null;
  existente_sin_lectura: boolean | null;
  existente_observacion: string | null;
  existente_fecha_lectura: string | null;
  existente_operador_nombre: string | null;
};

/** Lectura tal como la manda el celular a sincronizar_lecturas. */
export type LecturaParaSincronizar = {
  id: string;
  cuenta_id: string;
  periodo_id: string;
  lectura_actual: number | null;
  observacion: string | null;
  sin_lectura: boolean;
  fecha_lectura: string;
};

export type ResumenPeriodo = {
  periodo_id: string;
  nombre: string;
  activo: boolean;
  fecha_inicio: string;
  fecha_cierre: string | null;
  cuentas_activas: number;
  lecturas: number;
  con_lectura: number;
  sin_lectura: number;
  pendientes: number;
  alertas_menor_anterior: number;
  alertas_consumo_anomalo: number;
  conflictos_pendientes: number;
  cuentas_actualizadas?: number;
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: '12' };
  public: {
    Tables: {
      perfiles: Tabla<Perfil, Pick<Perfil, 'id' | 'nombre'> & Partial<Perfil>>;
      cuentas: Tabla<Cuenta, Pick<Cuenta, 'numero_cuenta'> & Partial<Cuenta>>;
      periodos: Tabla<Periodo, Pick<Periodo, 'nombre'> & Partial<Periodo>>;
      configuracion: Tabla<Configuracion, Partial<Configuracion>>;
      lecturas: Tabla<
        Lectura,
        Pick<Lectura, 'id' | 'cuenta_id' | 'periodo_id' | 'operador_id' | 'fecha_lectura'> &
          Partial<Omit<Lectura, 'consumo'>>,
        Partial<Omit<Lectura, 'consumo'>>
      >;
      lecturas_correcciones: Tabla<LecturaCorreccion, never, never>;
      lecturas_conflictos: Tabla<
        LecturaConflicto,
        Pick<LecturaConflicto, 'id' | 'cuenta_id' | 'periodo_id' | 'operador_id' | 'fecha_lectura'> &
          Partial<LecturaConflicto>
      >;
      suscripciones_push: Tabla<SuscripcionPush, never, never>;
    };
    Views: {
      v_lecturas: { Row: VLectura; Relationships: [] };
      v_operadores: { Row: VOperador; Relationships: [] };
      v_conflictos: { Row: VConflicto; Relationships: [] };
      v_rutas: { Row: VRuta; Relationships: [] };
    };
    Functions: {
      es_admin: { Args: never; Returns: boolean };
      es_operador_activo: { Args: never; Returns: boolean };
      sincronizar_lecturas: {
        Args: { p_lecturas: Json };
        Returns: { lectura_id: string; estado: EstadoSincronizacion; mensaje: string | null }[];
      };
      abrir_periodo: { Args: { p_nombre: string; p_fecha_inicio?: string }; Returns: Periodo };
      resumen_periodo: { Args: { p_periodo_id: string }; Returns: Json };
      cerrar_periodo: { Args: { p_periodo_id: string }; Returns: Json };
      cuentas_pendientes: {
        Args: { p_periodo_id: string };
        Returns: Cuenta[];
        SetofOptions: { from: '*'; to: 'cuentas'; isOneToOne: false; isSetofReturn: true };
      };
      registrar_suscripcion_push: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string };
        Returns: undefined;
      };
      resolver_conflicto: {
        Args: { p_conflicto_id: string; p_accion: 'descartar' | 'reemplazar' };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
