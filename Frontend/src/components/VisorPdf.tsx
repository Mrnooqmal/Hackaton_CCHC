import { useEffect, useRef, useState } from 'react';
import { FiAlertCircle } from 'react-icons/fi';

/**
 * Visor de PDF dibujado con PDF.js, una página bajo otra.
 *
 * Existe por los teléfonos: Chrome en Android no muestra PDFs dentro de un
 * <iframe> (sale una hoja rota) y Safari en iOS muestra solo la primera página.
 * En escritorio se sigue usando el visor del navegador, que trae búsqueda y zoom.
 *
 * PDF.js se carga recién al abrir un PDF: pesa bastante y la mayoría de las
 * pantallas no lo usa.
 */
export default function VisorPdf({ url, nombre }: { url: string; nombre?: string }) {
    const contenedor = useRef<HTMLDivElement>(null);
    const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');

    useEffect(() => {
        const caja = contenedor.current;
        if (!caja) return;
        let cancelado = false;
        let destruir: (() => void) | null = null;
        caja.replaceChildren();
        setEstado('cargando');

        (async () => {
            try {
                const [pdfjs, { default: workerUrl }] = await Promise.all([
                    import('pdfjs-dist'),
                    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
                ]);
                pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

                const tarea = pdfjs.getDocument({ url });
                destruir = () => { tarea.destroy(); };
                const pdf = await tarea.promise;
                if (cancelado) return;

                const ancho = caja.clientWidth || 360;
                const dpr = Math.min(window.devicePixelRatio || 1, 2);

                for (let n = 1; n <= pdf.numPages; n++) {
                    const pagina = await pdf.getPage(n);
                    if (cancelado) return;
                    const base = pagina.getViewport({ scale: 1 });
                    const escala = ancho / base.width;
                    const vista = pagina.getViewport({ scale: escala * dpr });

                    const lienzo = document.createElement('canvas');
                    lienzo.width = Math.floor(vista.width);
                    lienzo.height = Math.floor(vista.height);
                    lienzo.style.width = '100%';
                    lienzo.style.height = 'auto';
                    lienzo.style.display = 'block';
                    lienzo.style.background = '#fff';
                    lienzo.setAttribute('role', 'img');
                    lienzo.setAttribute('aria-label', `${nombre || 'Documento'}, página ${n} de ${pdf.numPages}`);
                    caja.appendChild(lienzo);

                    await pagina.render({ canvas: lienzo, canvasContext: lienzo.getContext('2d')!, viewport: vista }).promise;
                    // La primera página ya basta para dejar de mostrar el spinner.
                    if (n === 1 && !cancelado) setEstado('listo');
                }
            } catch (err) {
                if (cancelado) return;
                console.error('No se pudo dibujar el PDF:', err);
                setEstado('error');
            }
        })();

        return () => {
            cancelado = true;
            destruir?.();
        };
    }, [url, nombre]);

    return (
        <div style={{ width: '100%', height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
            {estado === 'cargando' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="spinner" />
                </div>
            )}
            {estado === 'error' && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-6)' }}>
                    <FiAlertCircle size={32} style={{ marginBottom: 'var(--space-2)' }} />
                    <p>No se pudo mostrar el documento. Puedes descargarlo.</p>
                </div>
            )}
            <div ref={contenedor} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} />
        </div>
    );
}
