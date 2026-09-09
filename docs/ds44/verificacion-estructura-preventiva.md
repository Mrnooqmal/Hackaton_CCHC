# Verificación de cierre — Estructura Preventiva (DS 44)

Fase 10 del encargo. Pasada contra las secciones 10 y 12, con el reporte de
contradicciones, tablas creadas y supuestos tomados.

Fecha: 2026-09-09 · 215 tests backend / 0 fallas · `npm run build` verde.

## Sección 10 — Anti duplicación y anti contradicción

Verificado con un script contra el código real, no por lectura. **17/17 pasan.**

| Regla | Dónde se sostiene |
|---|---|
| AD-1 Un solo servicio de umbrales | `lib/estructura-preventiva.js`. Ningún otro archivo redefine cortes |
| AD-2 Un acta es un Documento con tipo | Sin tablas por clase de acta en `serverless.yml` |
| AD-3 Un solo mecanismo de firma | El módulo no firma: adjunta documentos que pasan por el flujo existente |
| AD-4 Un solo vínculo requisito-FUF ↔ evidencia | `lib/completitud-estructura.js`, sin ítems duplicados |
| AD-5 Un patrón único de acreditación | `acreditacion: { realizada, documentoId, adjunto, fecha }` |
| AC-1 Un órgano vigente por tipo y ámbito | `constituirOrgano` rechaza el segundo |
| AC-2 Delegado no obligatorio con CPHS vigente | `obligacionesDeAmbito` |
| AC-3 Ítems 46 y 47 excluyentes | `perfilRegistrosIndicadores` + `evaluarRegistros` |
| AC-4 Encargado y DPR no coexisten como exigibles | `encargadoAplica = esEmpresa && n <= UMBRAL_DPR` |
| AC-5 Mandato ≤ 2 años | `validarFechasOrgano` |
| AC-6 Ninguna fecha futura | `validarFechasOrgano` y `validarReunionRealizada` |
| AC-7 Ni titular y suplente, ni ambos estamentos | `validarMiembros` |
| AC-8 Reunión realizada exige acta | `validarReunionRealizada` + guard en el servicio |
| AC-9 Firma pendiente impide `Cumplido` | `lib/completitud.js:firmasPendientes` |
| AC-10 Constitución no anterior al ámbito | `validarFechasOrgano` |
| AC-11 Disolver cancela reuniones futuras | `cancelarReunionesFuturas` |
| ESP Espejos sincronizados | Cortes 25/10/100 idénticos en backend y frontend |

Todas están implementadas como **validaciones de dominio**, no de formulario: se
sostienen aunque se llame la API directamente.

## Sección 12 — Cobertura del checklist

**19/19 ítems cubiertos.** Los declarados fuera de alcance se muestran como
`FueraDeAlcance` en vez de omitirse: un panel que oculta lo que excluyó es tan
opaco como uno que castiga de más.

| Ítems | Cómo se cierran |
|---|---|
| 30, 39, 41 | Dotación por ámbito → obligación → órgano vigente |
| 31 | Check más documento en el integrante, con recordatorio a los 4, 5 y 6 meses |
| 32 | Comprobante adjunto al órgano más recordatorio a los 10 días hábiles |
| 34, 35 | Ordinarias autogeneradas por mes; realizada exige acta |
| 36 | Documento y fecha en la reunión |
| 37 y transversales (4, 11, 25, 50, 51, 58) | `resumenAmbito.destinatarios` |
| 38 | Programa de trabajo por período |
| 40 | Acta de asamblea más mandato de 2 años con alerta |
| 46 / 47 | Documento con período, perfil excluyente según tramo |
| 48 | Designación más certificado del OAL |
| 33, 42-45 | Fuera de alcance, declarado |

## Tablas creadas — justificación

**Una sola**: `EstructuraPreventivaTable`, con prefijos en la sort key
(`ORG#` / `MIE#` / `REU#`). El encargo autorizaba hasta tres.

Integrantes y reuniones no existen sin su órgano y nunca se consultan fuera de
él, así que separarlos habría agregado dos roundtrips sin ganar nada. Con esta
forma, listar los órganos de un tenant es un `begins_with(sk, 'ORG#')` que **no
arrastra las ~24 reuniones de cada mandato**, y abrir un órgano completo son tres
lecturas en paralelo. Sin índices secundarios.

Todo lo demás reutiliza entidades existentes: las actas, el programa de trabajo y
los registros e indicadores son `Documento` con `tipo` y `periodo`.

## Supuestos que afectan cumplimiento normativo

Marcados, no resueltos por cuenta propia.

1. **Días hábiles sin feriados** (ítem 32, Art. 36). Decisión del usuario. El
   error cae del lado seguro —los feriados solo alargan el plazo real, así que la
   fecha calculada llega antes y el recordatorio avisa temprano—, pero la UI
   rotula la fecha como **referencial** y el aviso lo dice explícitamente.
2. **Offline**: el cálculo de obligaciones es local y determinista (`utils/
   estructuraPreventiva.ts`), pero **cargar actas y registrar reuniones NO
   funciona sin conexión**: el offline actual del sistema cubre solo firmas.
3. **No hay export del FUF todavía**. El registro requisito → evidencia existe y
   es el único; cuando se construya el export, debe leer de ahí y no reimplementar.
4. **Investiduras no verificadas**, por alcance: el sistema permite designar, no
   comprueba que la persona ostente el cargo. La UI lo dice en pantalla.

## Contradicciones encontradas y resueltas

1. **Umbrales discrepantes.** `Tenant.TAMANOS` cortaba en 1-9/10-49/50-199/200+,
   ninguno umbral del DS 44, y `evalAplicabilidad` tenía otros. Unificado en
   `tramoDS44` / `obligacionesDeAmbito`.
2. **`encargado_oa` limitado a 9 personas**, cuando el Art. 65 llega a 100: el
   sistema retiraba la exigencia para todo el tramo 10-100. Corregido.
3. **Dos fuentes para el mismo umbral de 100** en `ObraDetalle`: `tamanoEntidad`
   (empresa) y `activeWorkers.length` (obra). Unificadas en `dotacionEntidad`.
4. **Porcentaje bajo la etiqueta equivocada**: se mostraba el conteo de PLAN bajo
   el encabezado de la fase activa. Cada fase mide ahora su propio universo.
5. **Recordatorio de mandato que se perdía**: el hito de 0 días tenía borde
   inferior, así que solo avisaba el día exacto del vencimiento. Encontrado por
   los tests, corregido con ventanas explícitas y test de regresión.

## Pendiente declarado

- **Export del FUF** (§10.4): el registro existe, el export no.
- **Distribución documental al CPHS con acuse** (ítems 4, 11, 25, 50, 51, 58):
  este encargo solo garantiza que las figuras existan y sean consultables como
  destinatarios, que es lo que pedía la sección 7.
- **Offline para actas y reuniones**, si se decide extenderlo.
