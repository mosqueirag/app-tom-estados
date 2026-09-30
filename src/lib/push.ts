// Avisos push en el celular del operador (Web Push).
// En iPhone/iPad solo funciona con la app instalada en la pantalla de inicio
// (iOS 16.4 o posterior). En Android funciona en Chrome, instalada o no.
import { config } from './config';
import { supabase } from './supabase';

export type EstadoPush = 'no_soportado' | 'instalar_iphone' | 'sin_configurar' | 'bloqueado' | 'preguntar' | 'activo';

const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const instalada = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function estadoPush(): EstadoPush {
  const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!soporta) return esIOS() && !instalada() ? 'instalar_iphone' : 'no_soportado';
  if (!config.vapidPublica) return 'sin_configurar';
  if (Notification.permission === 'denied') return 'bloqueado';
  if (Notification.permission === 'granted') return 'activo';
  return 'preguntar';
}

function claveABytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob((base64url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function suscripcionActual(crear: boolean): Promise<PushSubscription | null> {
  const registro = await navigator.serviceWorker.ready;
  const existente = await registro.pushManager.getSubscription();
  if (existente || !crear) return existente;
  return registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(config.vapidPublica) });
}

async function registrar(sub: PushSubscription) {
  const datos = sub.toJSON();
  const { error } = await supabase.rpc('registrar_suscripcion_push', {
    p_endpoint: sub.endpoint,
    p_p256dh: datos.keys?.p256dh ?? '',
    p_auth: datos.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

/** Pide permiso y registra este celular. Tiene que llamarse desde un toque del usuario. */
export async function activarPush(): Promise<EstadoPush> {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return estadoPush();
  const sub = await suscripcionActual(true);
  if (sub) await registrar(sub);
  return 'activo';
}

/** Al abrir la app: si ya había permiso, vuelve a registrar el celular a nombre del usuario actual. */
export async function renovarPush(): Promise<void> {
  if (estadoPush() !== 'activo') return;
  const sub = await suscripcionActual(true);
  if (sub) await registrar(sub);
}

/** Al cerrar sesión: este celular deja de recibir avisos de ese usuario. */
export async function quitarPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const sub = await Promise.race([
    suscripcionActual(false),
    new Promise<null>((r) => setTimeout(() => r(null), 2000)),
  ]);
  if (!sub) return;
  await supabase.from('suscripciones_push').delete().eq('endpoint', sub.endpoint);
}
