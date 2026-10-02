import { useState } from 'react';

// Preferencias de pantalla de este celular: modo oscuro (para leer de noche
// o con poca luz) y letra grande. Se guardan en el navegador.

export type Preferencias = { oscuro: boolean; letraGrande: boolean };
const CLAVE = 'preferencias-pantalla';

export function leerPreferencias(): Preferencias {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE) ?? '{}') as Partial<Preferencias>;
    return { oscuro: Boolean(p.oscuro), letraGrande: Boolean(p.letraGrande) };
  } catch {
    return { oscuro: false, letraGrande: false };
  }
}

export function aplicarPreferencias(p: Preferencias = leerPreferencias()): void {
  const html = document.documentElement;
  html.classList.toggle('oscuro', p.oscuro);
  html.classList.toggle('letra-grande', p.letraGrande);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.oscuro ? '#0b1220' : '#15803d');
}

export function usePreferencias(): [Preferencias, (cambio: Partial<Preferencias>) => void] {
  const [prefs, setPrefs] = useState(leerPreferencias);
  function cambiar(cambio: Partial<Preferencias>) {
    const nuevas = { ...prefs, ...cambio };
    setPrefs(nuevas);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(nuevas));
    } catch {
      /* sin almacenamiento: vale solo hasta cerrar la app */
    }
    aplicarPreferencias(nuevas);
  }
  return [prefs, cambiar];
}
