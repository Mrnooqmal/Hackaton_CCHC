/**
 * Logo de la empresa en pantalla. Si la empresa subió uno distinto para modo
 * oscuro se montan los dos y el tema decide cuál se ve (ver components.css);
 * si no, es una sola imagen para ambos modos.
 */
interface Props {
    claro: string;
    oscuro?: string | null;
    alt: string;
    className?: string;
    /** Fondo fijo que no sigue el tema (tarjetas siempre blancas, credenciales navy). */
    fondo?: 'claro' | 'oscuro';
}

export default function LogoMarca({ claro, oscuro, alt, className = '', fondo }: Props) {
    if (fondo) return <img src={fondo === 'oscuro' ? (oscuro || claro) : claro} alt={alt} className={className} />;
    if (!oscuro) return <img src={claro} alt={alt} className={className} />;
    return (
        <>
            <img src={claro} alt={alt} className={`${className} logo-marca--claro`} />
            <img src={oscuro} alt={alt} className={`${className} logo-marca--oscuro`} />
        </>
    );
}
