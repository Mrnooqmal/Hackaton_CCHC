// Arnés del motor de recorridos para Playwright. Monta MotorRecorrido real
// sobre una página con:
//   - una cabecera fija con el botón de ayuda (global.boton-ayuda);
//   - un ancla muy abajo, fuera de la vista (global.menu-lateral);
//   - un ancla que aparece a los `?tarde=<ms>` (menu-ayuda.manual);
//   - un ancla que nunca existe (menu-ayuda.novedades).
// `?caso=<nombre>` elige el recorrido. Lo que hace la persona queda en
// `window.__eventos`; el fin, en `window.__terminado`, y si no se pudo mostrar
// nada, en `window.__noMostrado`. `?redibujar=<ms>` vuelve a dibujar la página
// cada tantos ms y le pasa al motor un `abrirAyuda` nuevo en cada render, como
// hacía el proveedor.
// También hay un ancla oculta por CSS (global.menu-sesion) para `soloSiNoSeVe`.

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import MotorRecorrido from '../../src/ayuda/MotorRecorrido';
import type { EventoRecorrido } from '../../src/ayuda/MotorRecorrido';
import type { DefinicionRecorrido, Paso } from '../../src/ayuda/tipos';
import '../../src/css/index.css';

declare global {
    interface Window { __eventos: EventoRecorrido[]; __terminado: boolean; __noMostrado?: boolean; __xss?: number }
}

const paso = (ancla: Paso['ancla'], titulo: string, descripcion = `Descripción de ${titulo}.`): Paso =>
    ({ ancla, titulo: { es: titulo }, descripcion: { es: descripcion } });

const base = (id: string, pasos: Paso[], tipo: DefinicionRecorrido['tipo'] = 'obligatorio'): DefinicionRecorrido => ({
    id, tipo, pantalla: 'inicio', visibleSi: {}, ambito: 'cualquiera', version: 1, reiniciarAlPublicar: false,
    estado: 'publicado', titulo: { es: id }, pasos,
});

const CASOS: Record<string, DefinicionRecorrido> = {
    scroll: base('scroll', [paso('global.boton-ayuda', 'Botón de ayuda'), paso('global.menu-lateral', 'Elemento lejano')]),
    tarde: base('tarde', [paso('menu-ayuda.manual', 'Elemento que llega tarde')]),
    faltante: base('faltante', [paso('menu-ayuda.novedades', 'No existe'), paso('global.boton-ayuda', 'Botón de ayuda'), paso('menu-ayuda.novedades', 'Tampoco')]),
    ninguno: base('ninguno', [paso('menu-ayuda.novedades', 'No existe')]),
    xss: base('xss', [paso('global.boton-ayuda', '<script>window.__xss=2</script>Título', '<img src=x onerror="window.__xss=1">Texto')]),
    anuncio: base('anuncio', [paso(undefined, 'Novedad', 'Algo nuevo en la plataforma.')], 'anuncio'),
    // El último paso no está en la pantalla: el anterior ya es el final.
    'ultimo-ausente': base('ultimo-ausente', [paso('global.boton-ayuda', 'Primero'), paso('global.menu-lateral', 'Segundo'), paso('menu-ayuda.novedades', 'No existe')]),
    // Un paso del medio no está: se salta rápido, sin la espera de la carga.
    'medio-ausente': base('medio-ausente', [paso('global.boton-ayuda', 'Primero'), paso('menu-ayuda.novedades', 'No existe'), paso('global.menu-lateral', 'Tercero')]),
    // El primer paso no está y el segundo sí: con redibujos seguidos tiene que arrancar igual.
    'primero-ausente': base('primero-ausente', [paso('menu-ayuda.novedades', 'No existe'), paso('global.boton-ayuda', 'Botón de ayuda')]),
    // Un paso que solo va si el menú de sesión no se ve (está oculto en este arnés).
    'solo-si-no-se-ve': base('solo-si-no-se-ve', [
        { ...paso('global.boton-ayuda', 'Solo si el menú no se ve'), soloSiNoSeVe: 'global.menu-sesion' },
        { ...paso('global.boton-ayuda', 'Solo si se ve la ayuda'), soloSiNoSeVe: 'global.boton-ayuda' },
        paso('global.menu-lateral', 'Lejos'),
    ]),
    // El primer paso está y el siguiente llega cuando la pantalla termina de cargar
    // (el botón Subir documento antes que las carpetas del repositorio).
    'siguiente-tarde': base('siguiente-tarde', [paso('global.boton-ayuda', 'Primero'), paso('menu-ayuda.manual', 'Llegó después')]),
    // Ningún paso está en la pantalla.
    'nada': base('nada', [paso('menu-ayuda.novedades', 'No existe'), paso('menu-ayuda.recorridos', 'Tampoco')]),
};

function Pagina() {
    const q = new URLSearchParams(location.search);
    const def = CASOS[q.get('caso') || 'scroll'];
    const tarde = Number(q.get('tarde') || 0);
    const [mostrarTarde, setMostrarTarde] = useState(false);
    const [activo, setActivo] = useState(true);
    const redibujar = Number(q.get('redibujar') || 0);
    const [, setTic] = useState(0);
    useEffect(() => {
        if (!redibujar) return;
        const t = window.setInterval(() => setTic((n) => n + 1), redibujar);
        return () => window.clearInterval(t);
    }, [redibujar]);

    useEffect(() => {
        if (!tarde) return;
        const t = window.setTimeout(() => setMostrarTarde(true), tarde);
        return () => window.clearTimeout(t);
    }, [tarde]);

    return (
        <>
            <header className="header" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 64, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 12px', background: 'var(--surface-card)', zIndex: 10 }}>
                <button type="button" data-tour="global.boton-ayuda" style={{ width: 40, height: 40 }}>?</button>
                <button type="button" data-tour="global.menu-sesion" style={{ display: 'none' }}>⋮</button>
            </header>
            <main style={{ paddingTop: 80, paddingInline: 16 }}>
                <p>Contenido de la pantalla.</p>
                {mostrarTarde && <button type="button" data-tour="menu-ayuda.manual" style={{ width: 200, height: 40 }}>Llegó tarde</button>}
                <div style={{ height: 1800 }} />
                <nav data-tour="global.menu-lateral" style={{ width: 300, height: 120, border: '1px solid' }}>Lejos</nav>
                <div style={{ height: 400 }} />
            </main>
            {activo && (
                <MotorRecorrido
                    definicion={def}
                    espera={Number(q.get('espera') || 4000)}
                    alturaCabecera={64}
                    alEvento={(ev) => { window.__eventos.push(ev); }}
                    alTerminar={() => { window.__terminado = true; setActivo(false); }}
                    abrirAyuda={() => {}}
                    alNoMostrar={() => { window.__noMostrado = true; }}
                />
            )}
        </>
    );
}

window.__eventos = [];
window.__terminado = false;
createRoot(document.getElementById('raiz')!).render(<BrowserRouter><Pagina /></BrowserRouter>);
