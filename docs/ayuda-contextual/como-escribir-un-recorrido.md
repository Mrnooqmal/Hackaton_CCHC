# Cómo escribir un recorrido guiado

Los recorridos son código (D-33): no hay panel de administración. Se escriben en el repo, se revisan en un PR y se publican con el despliegue del frontend. Esta guía es el reemplazo del editor.

Todo vive en `Frontend/src/ayuda/`:

| Archivo | Para qué |
|---|---|
| `registro.ts` | Pantallas (con su ruta y su página del manual) y anclas de cada pantalla. |
| `recorridos.ts` | Las definiciones. |
| `huellas.json` | La huella del contenido de cada recorrido. No se edita a mano. |
| `tipos.ts` | El modelo, con los límites. |

---

## 1. Marcar los elementos

Un paso nunca nombra un elemento con texto libre. Nombra un ancla del registro, y el componente la marca:

```tsx
// registro.ts
export const ANCLAS = {
    // ...
    'mis-firmas': {
        'lista-pendientes': 'Lista de documentos por firmar',
    },
};

// MySignatures.tsx
import { ancla } from '../ayuda/registro';
<section {...ancla('mis-firmas.lista-pendientes')}>
```

- Las claves llevan solo minúsculas, dígitos y guiones.
- Un paso puede usar anclas de su pantalla, de `global` (header y menú lateral) o, con `accion: 'abrir_ayuda'`, de `menu-ayuda`.
- Registrar un ancla que ningún componente marca hace fallar el build, y también escribir `data-tour` a mano.
- Marca el elemento que la persona tiene que mirar, no un contenedor enorme: en el teléfono el globo va en la mitad libre de la pantalla, y un elemento que ocupa toda la vista no deja mitad libre.

## 2. Definir el recorrido

```ts
// recorridos.ts
{
    id: 'mis-firmas-intro',            // slug único y estable: el progreso se guarda con él
    tipo: 'obligatorio',               // 'obligatorio' | 'opcional' | 'anuncio'
    pantalla: 'mis-firmas',
    visibleSi: { ninguno: ['obras.crear'] },
    ambito: 'cualquiera',              // 'obra' | 'empresa' | 'cualquiera'
    version: 1,
    reiniciarAlPublicar: false,
    estado: 'borrador',                // 'borrador' | 'publicado' | 'inactivo'
    titulo: { es: 'Tus firmas' },
    manual: 'modulos/firmas',
    pasos: [
        {
            ancla: 'mis-firmas.lista-pendientes',
            titulo: { es: 'Lo que tienes por firmar' },
            descripcion: { es: 'Aquí aparecen los documentos que te asignaron. Tócalo para leerlo antes de firmar.' },
            manual: 'modulos/firmas',      // agrega "Leer más en el manual"
        },
    ],
},
```

**Tipos:**
- **Obligatorio:** se lanza solo en su pantalla.
  - Sale de la cola si se completa o con "Omitir recorrido".
  - Cerrarlo con la X o Escape, o salir de la pantalla, lo deja pendiente; al tercer cierre cuenta como omitido.
- **Opcional:** solo se abre desde el menú de ayuda.
- **Anuncio:** aviso de novedad, centrado, sin resaltar nada.
  - Se lanza solo en su pantalla y queda en "Novedades" mientras esté vigente.
  - Cerrarlo lo marca como visto.
  - Necesita `vigenciaHasta`.

**Quién lo ve:** por permiso, nunca por nombre de rol, porque cada empresa crea sus roles.
- `todos`: tiene todos esos permisos.
- `alguno`: tiene al menos uno.
- `ninguno`: no tiene ninguno.
- `{}`: lo ven todos.
- Un recorrido de terreno suele ser `ninguno: ['obras.crear']`. El administrador tiene todos los permisos, así que no ve esos.

**Vigencia:** `vigenciaDesde` y `vigenciaHasta` en `AAAA-MM-DD`, hora de Chile, ambas inclusivas.

**Cuándo se lanza solo:** como máximo un recorrido automático por sesión, primero los anuncios y después los obligatorios. Nunca con un modal, una confirmación, el cambio obligatorio de contraseña o el enrolamiento en curso, y nunca si no se pudo leer el progreso. Todo lo demás queda en el menú de ayuda.

**Límites (los verifica el build):**
- Hasta 20 pasos.
- Título de hasta 80 caracteres y descripción de hasta 300.
- Textos sin HTML. Se muestran como texto plano; un salto de línea en la descripción se respeta.

## 3. Cambiar uno que ya existe

Si cambias cualquier cosa de un recorrido (texto, pasos, segmentación), **sube su `version`** y corre:

```bash
npm run recorridos:huellas
```

El build falla si el contenido cambió y la versión no, o si `huellas.json` no está al día.

Al subir la versión:
- Con `reiniciarAlPublicar: true` se vuelve a mostrar a quien ya lo había visto. Úsalo cuando el cambio importa, por ejemplo cuando cambió cómo se firma.
- Con `false` solo lo ve quien todavía no lo había visto. Sirve para correcciones de texto.

## 4. Verificar y ver la vista previa

```bash
npm run recorridos:verificar           # lo mismo que corre npm run build
npm run recorridos:listar              # todos, con su ruta de vista previa
npm run recorridos:listar -- --estado borrador --pantalla mis-firmas
npm test                               # pruebas del frontend
```

**Vista previa:** con el frontend de dev, entra con una empresa de prueba y abre la ruta que da el listado (`/my-signatures?recorrido=mis-firmas-intro&previa=1`).
- Muestra la definición tal como está, también en borrador, y no guarda progreso.
- Los borradores existen solo en dev (y en `npm run dev`): el build de prod los quita, y falla si el texto de alguno se cuela por otro lado. En prod, la vista previa solo abre recorridos publicados o inactivos.
- Si la pantalla tiene parámetros (`/obras/:obraId`), reemplázalos por una obra de esa empresa: el recorrido necesita la pantalla con datos para encontrar sus anclas.
- Si un ancla no aparece, el paso se salta y queda en la consola del navegador como `[recorridos] ancla no encontrada`.

## 5. Publicar y retirar

1. Cambia `estado` a `'publicado'` en el mismo PR (o en uno posterior).
2. Despliega como siempre: dev primero (`infra/desplegar-frontend.sh <commit> dev`), revisión de QA y después prod.
3. Antes de prod, corre `npm run test:e2e`. Se corre a mano y no forma parte del despliegue (decisión 5 de la Fase 0).

**Retirar:** `estado: 'inactivo'`. El recorrido y el progreso de las personas se conservan, y nadie lo ve.

**Borrar uno:** no reutilices su `id`. El progreso de las personas sigue guardado con ese id.

## 6. Reglas de redacción (obligatorias)

- El sistema **gestiona y custodia** evidencia preventiva.
  - **No valida** el contenido de los documentos que sube la persona; eso es responsabilidad de quien los sube.
  - **No verifica** la investidura real de los roles: son asignaciones que hace el supervisor o el prevencionista.
  - Ningún texto puede insinuar lo contrario.
- El foco es el **FUF**, no el DS 44 completo. Nunca afirmes que el sistema garantiza el cumplimiento legal.
- Planificar, Hacer, Verificar, Actuar es un esquema propio del sistema, no fases del decreto. No lo presentes como estructura normativa.
- Donde hay un tema normativo sin resolver, como la validez del PIN como firma, describe el funcionamiento sin afirmar validez legal.
- Lenguaje para terreno: frases cortas, tú, sin jerga técnica ni siglas sin explicar.
