# Verificación de cierre — Ítems 1, 50, 58 y repositorio seccionado

Fase 8 del encargo. Pasada contra las secciones 10 y 12.

Fecha: 2026-09-09 · 255 tests backend / 0 fallas · `npm run build` verde.

## Sección 10 — Anti duplicación y anti contradicción

Verificado con script contra el código real. **15/15 pasan.**

| Regla | Dónde se sostiene |
|---|---|
| AD-1 Un solo catálogo del FUF | `lib/fuf.js`, consumido por completitud, export y repositorio |
| AD-2 El repositorio no calcula | `RepositorioFuf.tsx` solo llama `estructuraApi.completitud` |
| AD-3 Un solo componente de distribución | `lib/distribucion.js`, genérico; el ítem 50 lo consume |
| AD-4 Destinatarios preventivos no replicados | Se leen del módulo de estructura |
| AD-5 El ítem 1 referencia, no copia | `propio: false` + `enlace` por componente |
| AD-6 Ninguna tabla nueva | Prefijo `PRE#` en la tabla existente. Siguen siendo 15 tablas |
| AD-7 Un documento, un módulo dueño | El repositorio no carga documentos, los indexa |
| AC-1 Repositorio y panel no difieren | Leen la misma función |
| AC-2 Implementada exige evidencia y fecha | `validarPrescripcion` |
| AC-3 Vencida es derivada | `estadoPrescripcion`, nunca un campo |
| AC-4 Menos de 30 días no es Cumplido | `evaluarItem50` |
| AC-5 Ninguna fecha futura | `validarPrescripcion` y el endpoint de difusión |
| AC-6 Destinatario inexistente es NoAplica con razón | `estadoDestinatario` |
| AC-7 El ítem 1 no cumple si falta un componente | `evaluarItem1` |
| AC-8 Los acuerdos no generan prescripciones solas | Conexión opt in vía `reunionOrigenId` |

## Sección 12 — Checklist

| Ítem | Cómo se cerró |
|---|---|
| **1** | `evaluarItem1` + `componentesSgsst`: los cinco literales del Art. 22, cuatro referenciados y uno propio (Política de SST). Tipos nuevos `AUDITORIA_SGSST` y `ACCIONES_MEJORA_SGSST` para los literales d) y e) |
| **50** | `fechaEntradaVigencia` en el documento, endpoint `POST /documents/{id}/difusion`, y `evaluarItem50` con los tres destinatarios del Art. 57 y los 30 días corridos |
| **58** | `lib/prescripciones.js` + persistencia con prefijo `PRE#` + rutas CRUD. Estado derivado del plazo |
| **Repositorio DS 44** | `RepositorioFuf.tsx`: 15 secciones del formulario, leyendo el catálogo único y `completitudAmbito` |
| **Componente de distribución** | `lib/distribucion.js`, genérico. El ítem 50 es el primer consumidor; 4, 11, 25, 37 y 51 se enganchan pasando otra lista de destinatarios |

## Tablas creadas

**Ninguna.** Las prescripciones viven en `EstructuraPreventivaTable` con prefijo
`PRE#`, y la distribución extiende `Document.difusiones[]`, que ya existía.
Siguen siendo las mismas 15 tablas.

## Decisión sobre el mecanismo de difusión (duda D2)

Ya existía `Document.difusiones[]` con `estadoPlazoReglamento`, hechos por otra
persona. Estaban **incompletos**: nadie llamaba a la función y el campo
`fechaEntradaVigencia` que recibe no existía en el modelo, así que siempre
devolvía `sin_vigencia`.

Por decisión del usuario se **extendió** en vez de reemplazar. Una entrada de
`difusiones[]` ahora tiene `origen`:

- `automatica`: la escribe EventBus al publicar una versión. Informa a la línea de
  mando y a los representantes; sirve a los ítems 4 y 11.
- `manual`: la declara alguien, con destinatario tipificado, medio y evidencia.
  Es la que exige el Art. 57 inc. 2.

Ninguna reemplaza a la otra y ambas cuentan como haber informado.

## Revisión del módulo de Repositorio (sección D.5)

- **Carga y reemplazo**: el repositorio **no edita documentos**, solo los lista y
  previsualiza. La carga y el versionado ocurren en el módulo dueño, que es
  justamente lo que la sección D.2 exige. No sobrescribe nada.
- **Búsqueda y filtrado**: siguen funcionando. Al buscar se aplana todo el ámbito
  ignorando la carpeta abierta, incluido DS 44.
- **Documentos huérfanos**: no hay. Todos caen en alguna carpeta por
  `clasificacion` o `fase`.

**Dos problemas encontrados y corregidos, ambos dentro del alcance:**

1. La definición del ítem 1 referenciaba `AUDITORIA_SGSST` y
   `ACCIONES_MEJORA_SGSST`, que **no existían** en el catálogo de tipos. Un
   documento de esos tipos no se podía crear, así que los literales d) y e) del
   Art. 22 nunca se habrían podido cumplir. Agregados.
2. Al abrir la carpeta DS 44 se renderizaban **la vista del formulario y la lista
   plana a la vez**: el mismo documento aparecía dos veces. Corregido, dejando que
   la búsqueda siga aplanando todo.

## Contradicción con el encargo, corregida

`BLOQUE_FUF` de `lib/completitud.js` agrupaba en **diez bloques temáticos
inventados** en el encargo anterior, no en las quince secciones del formulario.
El panel y el FUF no hablaban el mismo idioma.

Ahora se deriva de `lib/fuf.js`, y el motor **deriva la sección del número de
ítem**: una definición ya no puede quedar en una sección que no le corresponde.
Los ítems 30-48 pasaron a las secciones 8 y 9.

El espejo del frontend (`utils/fuf.ts`) se **genera** desde la fuente backend y se
verificó campo por campo: 60 ítems y 15 secciones idénticos. Transcribir a mano 60
textos normativos es cómo se desincronizan los espejos.

## Supuestos declarados

1. **D1 · Organizaciones sindicales**: registro mínimo en `Tenant.reglas`
   (nombre y contacto), más la declaración explícita "sin organizaciones
   sindicales" con fecha y quién la hizo. Sin esa declaración, el destinatario
   quedaría `Pendiente` para siempre en una empresa sin sindicatos, que es un
   incumplimiento imposible de cerrar.
2. **D4 · Ámbito del ítem 1**: empresa. Es donde vive el SGSST.
3. **D5 · Firma de la Política de SST**: opcional, no requisito para dar el
   componente por cumplido. El Art. 22 no la exige.
4. **D6 · Ítem 58 sin prescripciones**: `Cumplido` con la nota "sin prescripciones
   registradas en el período". La obligación del Art. 70 es implementar lo que
   exista.
5. **D8 · Ítem 58 y traslados**: solo medidas prescritas. El traslado de puesto es
   el ítem 57 y quedó fuera de alcance.
6. **El comité y el delegado son alternativos** como destinatarios del Art. 57:
   el Art. 66 hace al delegado la figura de los lugares sin comité, así que exigir
   ambos sería exigir algo imposible.

## Pendiente declarado

- **Ítems 4, 11, 25, 37 y 51**: el componente de distribución está listo y es
  genérico; falta que cada ítem declare sus destinatarios y su regla de plazo.
- **Ítems 51 y 60**: fuera de alcance por reparto con la otra persona (duda D2).
- **UI de prescripciones y del SGSST**: el backend, las rutas y la evaluación
  están; falta la pantalla que las administre.
