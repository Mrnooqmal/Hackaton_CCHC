# Firmas Digitales

Las **firmas digitales** son el corazón del cumplimiento "sin papeleo". En lugar de imprimir
un documento, juntarlo con la firma de cada trabajador y archivarlo en una carpeta, en la
plataforma cada persona **firma con su PIN personal** directamente desde su teléfono o
computador. Cada firma queda registrada con fecha, hora y un código de verificación que
permite comprobar después que fue real.

Hay tres pantallas relacionadas con firmas, según lo que necesites hacer:

- **Mis Firmas** — para que **tú firmes** lo que te asignaron.
- **Solicitudes de Firma** — para **pedir firmas** a otras personas (roles de gestión).
- **Firmas Offline** — para **recolectar firmas sin conexión** a internet, por ejemplo en
  terreno donde no hay señal.

> **Tu PIN es tu firma.** Es un código personal de **4 dígitos** que solo tú conoces. Al
> ingresarlo confirmas que leíste y comprendiste el documento. No lo compartas con nadie:
> equivale a tu firma de puño y letra.

## Mis Firmas — firmar lo que me asignaron

Esta es la pantalla que más usará un **Trabajador**. Aquí aparecen los documentos que
esperan tu firma.

1. En el menú lateral, entra a **Mis Firmas**.
2. Verás la lista de documentos **pendientes de firmar**. Si no tienes ninguno, aparecerá
   el mensaje **"Todo al día"**.
3. Haz clic en el documento que quieres firmar para revisarlo.
4. Se abrirá la ventana **Firma digital**. Lee el documento.
5. Ingresa tu **PIN de 4 dígitos** y haz clic en **Confirmar Firma**.

![Pantalla Mis Firmas con los documentos pendientes de firmar](/img/firmas/mis-firmas.png)

Una vez firmado, el documento pasa a tu **historial de firmas**, donde cada firma muestra su
estado (**Válida**, **Disputada**), la **fecha y hora**, **quién la solicitó**, los
**documentos** firmados y un **token de verificación** (el código que prueba la firma).

## Solicitudes de Firma — pedir firmas a otros

Esta pantalla es para los roles de gestión que necesitan que un grupo de personas firme un
documento (por ejemplo, la difusión de un procedimiento o la entrega de un EPP).

1. Entra a **Solicitudes de Firma** y haz clic en **Nueva Solicitud de Firma**.
2. El asistente te guía por pasos:
   - **Firmantes** — selecciona quiénes deben firmar (al menos una persona).
   - **Tipo** — el tipo de solicitud.
   - **Título** *(opcional)* — un nombre para identificarla.
   - **Fecha Límite** *(opcional)* — hasta cuándo deben firmar.
   - **Descripción** *(opcional)* — contexto para los firmantes.
   - **Archivos** — sube el o los documentos (PDF, Word, Excel o imágenes, máx. 10 MB cada uno).
3. Crea la solicitud. Cada firmante la recibirá como **pendiente** en su pantalla de
   *Mis Firmas* y en su [Bandeja de Entrada](/modulos/bandeja-entrada).

![Asistente de Nueva Solicitud de Firma con la selección de firmantes](/img/firmas/nueva-solicitud.png)

En la lista de solicitudes verás el **estado** de cada una, **quién la asignó**, la **fecha
de creación** y la **fecha límite**. Podrás ver cuántas personas ya firmaron y cuántas
están **pendientes**. Si una solicitud ya no corresponde, puedes **cancelarla**.

> Tú también puedes firmar desde aquí cuando seas uno de los firmantes: se abre la
> ventana **Confirmar Firma Digital** y se te pedirá tu **PIN de 4 dígitos**.

## Firmas Offline — recolectar firmas sin internet

En muchas obras no hay buena señal. Las **Firmas Offline** te permiten juntar las firmas de
los trabajadores **sin conexión** y luego **sincronizarlas** cuando vuelvas a tener internet.

1. Entra a **Firmas Offline** y haz clic en **Nueva Solicitud Offline**.
2. Define el documento y recolecta las firmas de los presentes (cada uno con su PIN), todo
   sin necesidad de conexión.
3. Cuando recuperes la señal, la plataforma **sincroniza** automáticamente las firmas
   recolectadas con el sistema.

Cada solicitud offline muestra su **estado de sincronización**, para que sepas cuáles ya se
subieron y cuáles están pendientes de sincronizar.

> Las firmas offline se guardan **en tu dispositivo** hasta que sincronizan. No cierres
> sesión ni borres los datos del navegador antes de sincronizar, o podrías perderlas.

## Validez legal de la firma con PIN

::: warning Consulta legal en curso
La validez jurídica del PIN como firma electrónica ante un fiscalizador del DS 44 está siendo
evaluada con la Dirección del Trabajo. La funcionalidad opera con normalidad y deja
trazabilidad completa, pero **por ahora no debe usarse como única prueba legal** hasta tener
la respuesta oficial. Más detalle en [Firmas digitales y DS44](/ds44/firmas-digitales).
:::

## Preguntas frecuentes

**¿Dónde defino o cambio mi PIN?**
Tu PIN se establece al activar tu cuenta. Puedes cambiarlo desde la configuración de tu
perfil. Si lo olvidaste, un administrador puede ayudarte a restablecerlo.

**Olvidé mi PIN y no puedo firmar.**
Contacta a un administrador de tu empresa para que te ayude a restablecerlo. Por seguridad,
nadie más puede ver tu PIN actual.

**Firmé pero el documento sigue apareciendo como pendiente para otros.**
Cada persona firma por separado. El documento se considera completo cuando **todos** los
firmantes asignados firmaron. Tu parte ya está; faltan los demás.

**Me equivoqué al firmar un documento.**
Las firmas quedan registradas para garantizar la trazabilidad. Si firmaste por error,
informa a un administrador o prevencionista: una firma puede quedar marcada como
**disputada** para dejar constancia.

**¿Qué es el "token de verificación"?**
Es un código único que se genera con cada firma. Sirve para comprobar después que la firma
es auténtica y no fue alterada. No necesitas hacer nada con él en el uso diario.

**Estoy en terreno sin señal. ¿Puedo igual juntar firmas?**
Sí, para eso están las **Firmas Offline**. Recolectas las firmas sin conexión y se
sincronizan solas cuando vuelvas a tener internet.

**¿Quién puede crear solicitudes de firma?**
Los roles de gestión (Administrador, Prevencionista, Jefe de Obra, Supervisor según el caso).
Un Trabajador normalmente solo firma lo que le solicitan. Consulta [Roles de Usuario](/roles/).
