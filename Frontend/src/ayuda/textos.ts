// Textos de los botones del motor de recorridos. El motor los recibe como
// opción (`textos`), con estos por omisión.

export interface TextosMotor {
    readonly siguiente: string;
    readonly anterior: string;
    readonly finalizar: string;
    readonly entendido: string;
    readonly omitir: string;
    readonly cerrar: string;
    readonly leerMas: string;
    readonly paso: (n: number, total: number) => string;
}

export const TEXTOS: TextosMotor = {
    siguiente: 'Siguiente',
    anterior: 'Anterior',
    finalizar: 'Finalizar',
    entendido: 'Entendido',
    omitir: 'Omitir recorrido',
    cerrar: 'Cerrar recorrido',
    leerMas: 'Leer más en el manual',
    paso: (n, total) => `Paso ${n} de ${total}`,
};
