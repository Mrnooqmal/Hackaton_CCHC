// Bloqueo del lanzamiento automático de recorridos (decisión 8 de la Fase 0).
//
// Un recorrido no se lanza solo encima de un flujo en curso: un modal (firma,
// firma asistida, PIN, cualquier `Modal`), una confirmación destructiva
// (`ConfirmModal`) o el cambio obligatorio de contraseña. Cada uno lo activa con
// `useBloqueoAyuda(abierto)` mientras está abierto. Es un contador de módulo y
// no un contexto: los modales se montan en muchos lugares y no tienen que estar
// debajo de ningún proveedor.
//
// Solo afecta al lanzamiento automático: lo que la persona abre desde la ayuda
// se abre igual.

const oyentes = new Set<() => void>();
let activos = 0;

export const bloqueado = () => activos > 0;

/** Activa un bloqueo; devuelve la función que lo libera (idempotente). */
export function bloquear(): () => void {
    activos += 1;
    oyentes.forEach((f) => f());
    let liberado = false;
    return () => {
        if (liberado) return;
        liberado = true;
        activos -= 1;
        oyentes.forEach((f) => f());
    };
}

export function suscribir(f: () => void): () => void {
    oyentes.add(f);
    return () => { oyentes.delete(f); };
}
