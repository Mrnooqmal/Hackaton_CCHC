import { FiWifiOff } from 'react-icons/fi';
import { NO_DISPONIBLE_SIN_CONEXION } from '../utils/conexion';

/**
 * En lugar de un dato que no se pudo cargar por falta de señal: nunca un cero
 * ni un "Todo al día", que se leerían como datos. Neutro (el único aviso de que
 * no hay señal es el del layout) y sin botón: se carga solo cuando vuelve.
 */
export default function SinConexion({ detalle = 'Se carga cuando vuelva la señal.', compacto = false }: { detalle?: string; compacto?: boolean }) {
    return (
        <div className={`sin-conexion${compacto ? ' sin-conexion--compacto' : ''}`} role="status">
            <FiWifiOff aria-hidden />
            <span className="sin-conexion__titulo">{NO_DISPONIBLE_SIN_CONEXION}</span>
            {!compacto && <span className="sin-conexion__texto">{detalle}</span>}
        </div>
    );
}
