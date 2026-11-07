// Definiciones de los recorridos guiados (D-33).
//
// Vacío hasta que se aprueben los recorridos iniciales (Fase 5). Para agregar o
// cambiar uno:
//   1. Marca en el componente cada elemento que vas a resaltar con `ancla()` y
//      regístralo en `registro.ts`.
//   2. Escribe o edita la definición acá. Si cambias el contenido de uno que ya
//      existe, sube su `version`.
//   3. `npm run recorridos:huellas` actualiza `huellas.json`; el build falla si
//      el contenido cambió y la versión no, o si las huellas no están al día.
//
// Los textos se muestran como texto plano. Reglas de redacción en el encargo:
// el sistema custodia evidencia, no valida el contenido de los documentos ni
// garantiza el cumplimiento legal.

import type { DefinicionRecorrido } from './tipos.ts';

export const RECORRIDOS: readonly DefinicionRecorrido[] = [];
