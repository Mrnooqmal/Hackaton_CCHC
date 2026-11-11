# Pedir firmas y firma asistida

Las firmas se piden al **asignar** un documento a quienes deben firmarlo: en el requisito de
la obra ([Cargar un documento y pedir las firmas](/obra/cumplimiento#cargar-un-documento-y-pedir-las-firmas))
o en el [Repositorio](/obra/documentos). A cada persona le llega un aviso y el documento aparece en
su **Mis firmas**. En **Solicitudes de firma** sigues quién firmó y quién falta.

:::: solo obra.firma_asistida
## Firma asistida

Hay personas que no firman desde su propio equipo, por ejemplo en terreno. En ese caso, quien
tiene el permiso de **firma asistida** (normalmente supervisor, jefe de obra o prevencionista)
abre la firma en **su** equipo y le pasa el teléfono a la persona:

1. Con la obra elegida, entra a **Personas**, toca a la persona y elige **Firmar asistido**
   (en la vista de lista, **Firma asistida**).

   ![Menú de la persona con la opción Firmar asistido](/img/personas/menu-persona.png)

2. Se abre **Documentos pendientes**, con lo que esa persona tiene por firmar. Toca **Firmar**
   en el documento.

   ![Documentos pendientes de la persona, con el botón Firmar](/img/firmas/firma-asistida.png)

3. Revisa el documento con ella para que lo lea (**Ver**). Luego **la persona escribe su propio
   PIN** (quien asiste nunca lo conoce), marca *El trabajador declara haber leído
   conscientemente este documento antes de firmarlo* y toca **Confirmar firma**.

   ![Firma asistida: la persona escribe su PIN](/img/firmas/firma-asistida-pin.png)

Queda registrado que la persona declaró haber leído el documento antes de firmar.

### Sin señal en terreno

La firma asistida también funciona **sin señal**. Cada persona escribe su propio PIN como
siempre; la firma queda guardada en tu equipo y **se envía sola cuando vuelve la señal**. Arriba
de la pantalla ves cuántas quedan por enviar, por ejemplo *5 firmas por enviar*.

- Si la persona escribió su PIN con señal en tu equipo **durante el turno**, para esa misma obra,
  un error de tipeo se detecta al momento y lo corrige ahí mismo. Eso dura un turno (hasta 12
  horas).
- Si no, su PIN se revisa **cuando vuelve la señal**. Si estaba mal, aparece un aviso con su
  nombre y lo que firmaba: *La firma de … no se validó: tiene que firmar de nuevo*. Pídele que
  vuelva a firmar; con **Entendido** cierras el aviso.
::::

:::: solo firmas.crear
## Firmas en revisión

Una firma tomada sin señal queda registrada, pero **no cuenta como cumplimiento** hasta que
alguien la confirme, en uno de estos casos:

- **Llegó tarde.** El equipo estaba listo para detectar el error de tipeo de esa persona (había
  escrito su PIN con señal ahí), pero la firma llegó después de que eso venciera, al terminar el
  turno (12 horas). Si pasan **30 días más** sin enviarse, ya no entra: hay que firmar de nuevo.
- **La hora no es creíble.** La hora que marca el equipo está en el futuro o es de hace más de
  30 días.
- **La persona ya no está en la empresa** cuando la firma llega, y el equipo marca que firmó
  antes de su salida. Si marca que firmó después, la firma se rechaza.

Esas firmas aparecen en **Firmas en revisión**, en el menú lateral. Cada una muestra quién firmó,
qué, el motivo, la hora según el equipo y cuándo llegó al sistema:

- **Confirmar**: la firma pasa a contar como cumplimiento.
- **Rechazar**: pide un motivo, que queda en el acta. La firma no se borra: queda revocada.

Si no hay ninguna, verás **No hay firmas en revisión**.
::::

## Firma del relator

En las capacitaciones, además de la firma de cada asistente, se pide la **firma del
relator**, que [certifica que la capacitación se realizó](/fuf/capacitaciones).
