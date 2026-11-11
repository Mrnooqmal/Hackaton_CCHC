/** "1 firma enviada", "2 firmas enviadas". Nunca "firma(s)". */
export const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;
