import { useState } from 'react';
import { ITERACIONES, derivarLlave, cifradoDisponible } from '../utils/valesCifrados';
import '../css/medicion-pin.css';

/**
 * Medición de PBKDF2 en el teléfono (solo fuera de producción).
 *
 * Los vales sin conexión se cifran con una llave derivada del PIN
 * (utils/valesCifrados). Derivarla tiene que tardar del orden de medio segundo
 * en el teléfono más débil que se use en obra: menos regala intentos a quien
 * copie el almacenamiento; más hace esperar a cada firma sin señal.
 *
 * Esta página corre la MISMA función que usa la firma (`derivarLlave`) con las
 * iteraciones de hoy, varias veces, y dice cuántas iteraciones darían 500 ms en
 * este equipo. No envía nada: el resultado se copia a mano.
 */

const OBJETIVO_MS = 500;
const REPETICIONES = 5;
/** hashcat, PBKDF2-HMAC-SHA256 (modo 10900), RTX 4090: ~8,8 millones de hashes de 999 iteraciones por segundo. */
const ITERACIONES_POR_SEGUNDO_GPU = 8.8e9;
/** Candidatos de 6 dígitos que deja el byte de comprobación: 10^6 / 256. */
const CANDIDATOS = Math.round(1e6 / 256);

const PRODUCCION = ['buildandserve.cl', 'www.buildandserve.cl'];

const mediana = (xs: number[]) => {
    const o = [...xs].sort((a, b) => a - b);
    return o[Math.floor(o.length / 2)];
};
const miles = (n: number) => Math.round(n).toLocaleString('es-CL');

export default function MedicionPin() {
    const [tiempos, setTiempos] = useState<number[]>([]);
    const [midiendo, setMidiendo] = useState(false);
    const [error, setError] = useState('');
    const [copiado, setCopiado] = useState(false);

    if (PRODUCCION.includes(window.location.hostname)) {
        return (
            <main className="medicion-pin">
                <h1>Medición no disponible</h1>
                <p>Esta página existe solo en el ambiente de pruebas.</p>
            </main>
        );
    }

    const medir = async () => {
        setError('');
        setTiempos([]);
        setCopiado(false);
        if (!cifradoDisponible()) {
            setError('Este navegador no tiene WebCrypto (¿la dirección es https?). Sin él no se puede habilitar la firma sin conexión.');
            return;
        }
        setMidiendo(true);
        try {
            const sal = new Uint8Array(16);
            crypto.getRandomValues(sal);
            // Calentamiento: la primera derivación paga la carga del motor.
            await derivarLlave('000000', sal, 10_000);
            const hechos: number[] = [];
            for (let i = 0; i < REPETICIONES; i += 1) {
                const t0 = performance.now();
                await derivarLlave(String(100000 + i), sal, ITERACIONES);
                hechos.push(performance.now() - t0);
                setTiempos([...hechos]);
                // Respiro para que la pantalla se actualice entre medidas.
                await new Promise((r) => setTimeout(r, 50));
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo medir.');
        } finally {
            setMidiendo(false);
        }
    };

    const m = tiempos.length === REPETICIONES ? mediana(tiempos) : null;
    const recomendadas = m ? Math.max(100_000, Math.round((ITERACIONES * OBJETIVO_MS / m) / 10_000) * 10_000) : null;
    const ataque = (iter: number) => (CANDIDATOS * iter) / ITERACIONES_POR_SEGUNDO_GPU;

    const nav = navigator as Navigator & { deviceMemory?: number };
    const resumen = m && recomendadas ? [
        `Medición PBKDF2 (${new Date().toLocaleString('es-CL')})`,
        `Equipo: ${navigator.userAgent}`,
        `Núcleos: ${navigator.hardwareConcurrency ?? '?'} · Memoria: ${nav.deviceMemory ?? '?'} GB`,
        `Iteraciones actuales: ${ITERACIONES}`,
        `Tiempos (ms): ${tiempos.map((t) => Math.round(t)).join(', ')}`,
        `Mediana: ${Math.round(m)} ms`,
        `Iteraciones para ${OBJETIVO_MS} ms en este equipo: ${recomendadas}`,
    ].join('\n') : '';

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(resumen);
            setCopiado(true);
        } catch {
            setCopiado(false);
            setError('No se pudo copiar: selecciona el texto y cópialo a mano.');
        }
    };

    return (
        <main className="medicion-pin">
            <h1>Medición de la firma sin conexión</h1>
            <p>
                Mide cuánto tarda este teléfono en abrir los vales con un PIN: es lo que espera cada firma sin señal.
                El objetivo es del orden de {OBJETIVO_MS} ms en el teléfono más débil de la obra. No envía nada.
            </p>
            <ol className="medicion-pin__pasos">
                <li>Cierra las demás aplicaciones y deja el teléfono con más de 20% de batería.</li>
                <li>Toca <strong>Medir</strong> y no cambies de aplicación hasta que termine (unos segundos).</li>
                <li>Toca <strong>Copiar resultado</strong> y envíalo.</li>
            </ol>

            <button type="button" className="btn btn-primary" onClick={medir} disabled={midiendo}>
                {midiendo ? `Midiendo… ${tiempos.length}/${REPETICIONES}` : 'Medir'}
            </button>

            {error && <p className="form-error" role="alert">{error}</p>}

            {tiempos.length > 0 && (
                <section className="medicion-pin__resultado" aria-live="polite">
                    <h2>Resultado</h2>
                    <dl>
                        <dt>Iteraciones de hoy</dt><dd>{miles(ITERACIONES)}</dd>
                        <dt>Cada medida</dt><dd>{tiempos.map((t) => `${Math.round(t)} ms`).join(' · ')}</dd>
                        {m && <><dt>Mediana</dt><dd><strong>{Math.round(m)} ms</strong></dd></>}
                        {recomendadas && <><dt>Para {OBJETIVO_MS} ms en este equipo</dt><dd><strong>{miles(recomendadas)}</strong> iteraciones</dd></>}
                        {recomendadas && (
                            <>
                                <dt>Quien copie el almacenamiento, con una tarjeta gráfica</dt>
                                <dd>
                                    descarta los PIN en ~{Math.max(1, Math.round(ataque(recomendadas)))} s y le quedan ~{miles(CANDIDATOS)} candidatos,
                                    {' '}que solo puede probar contra el servidor (5 intentos y se anulan los vales).
                                </dd>
                            </>
                        )}
                    </dl>
                    {resumen && (
                        <>
                            <pre className="medicion-pin__texto">{resumen}</pre>
                            <button type="button" className="btn btn-secondary" onClick={copiar}>
                                {copiado ? 'Copiado' : 'Copiar resultado'}
                            </button>
                        </>
                    )}
                </section>
            )}
        </main>
    );
}
