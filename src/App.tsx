import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ProveedorAuth } from '@/auth/ProveedorAuth';
import { RedirigirInicio, RequiereRol } from '@/auth/RequiereRol';
import { PantallaCarga, PantallaConfigFaltante, PantallaNoEncontrada } from '@/components/Pantallas';
import { configuracionCompleta } from '@/lib/supabase';
import OperadorLayout from '@/layouts/OperadorLayout';
import Login from '@/pages/Login';
import Instalar from '@/pages/Instalar';
import { AvisoActualizacion } from '@/components/AvisoActualizacion';
import InicioOperador from '@/pages/operador/Inicio';
import Buscar from '@/pages/operador/Buscar';
import Recorrido from '@/pages/operador/Recorrido';
import CargarLectura from '@/pages/operador/CargarLectura';
import MisLecturas from '@/pages/operador/MisLecturas';
import ChatOperador from '@/pages/operador/Chat';

// El módulo del administrador se carga aparte: el celular del operador no lo descarga al abrir.
const AdminLayout = lazy(() => import('@/layouts/AdminLayout'));
const PanelAdmin = lazy(() => import('@/pages/admin/Panel'));
const Cuentas = lazy(() => import('@/pages/admin/Cuentas'));
const Lecturas = lazy(() => import('@/pages/admin/Lecturas'));
const Operadores = lazy(() => import('@/pages/admin/Operadores'));
const Periodos = lazy(() => import('@/pages/admin/Periodos'));
const Rutas = lazy(() => import('@/pages/admin/Rutas'));
const Mapa = lazy(() => import('@/pages/admin/Mapa'));
const Historial = lazy(() => import('@/pages/admin/Historial'));
const Mensajes = lazy(() => import('@/pages/admin/Mensajes'));
const Configuracion = lazy(() => import('@/pages/admin/Configuracion'));

export default function App() {
  if (!configuracionCompleta) return <PantallaConfigFaltante />;

  return (
    <ProveedorAuth>
      <AvisoActualizacion />
      <BrowserRouter>
        <Suspense fallback={<PantallaCarga />}>
        <Routes>
          <Route path="/" element={<RedirigirInicio />} />
          <Route path="/login" element={<Login />} />
          <Route path="/instalar" element={<Instalar conVolver />} />

          <Route element={<RequiereRol rol="admin" />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<PanelAdmin />} />
              <Route path="cuentas" element={<Cuentas />} />
              <Route path="lecturas" element={<Lecturas />} />
              <Route path="rutas" element={<Rutas />} />
              <Route path="mapa" element={<Mapa />} />
              <Route path="operadores" element={<Operadores />} />
              <Route path="periodos" element={<Periodos />} />
              <Route path="historial" element={<Historial />} />
              <Route path="mensajes" element={<Mensajes />} />
              <Route path="configuracion" element={<Configuracion />} />
            </Route>
          </Route>

          <Route element={<RequiereRol rol="operador" />}>
            <Route path="/operador" element={<OperadorLayout />}>
              <Route index element={<InicioOperador />} />
              <Route path="recorrido" element={<Recorrido />} />
              <Route path="buscar" element={<Buscar />} />
              <Route path="cuenta/:id" element={<CargarLectura />} />
              <Route path="mis-lecturas" element={<MisLecturas />} />
              <Route path="ayuda" element={<Instalar />} />
              <Route path="chat" element={<ChatOperador />} />
            </Route>
          </Route>

          <Route path="*" element={<PantallaNoEncontrada />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </ProveedorAuth>
  );
}
