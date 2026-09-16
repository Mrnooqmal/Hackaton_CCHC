# Gobernanza y seguridad de datos personales

**Documento base para la elaboración del informe formal**
Sistema: Build & Serve — plataforma de gestión de cumplimiento DS 44/2024
Ámbito: datos personales, credenciales, integridad documental e infraestructura

---

## 1. Propósito y alcance

Este documento consolida el estado real de la plataforma en materia de gobernanza y
seguridad de datos, distinguiendo **lo que está implementado y verificado en el código**
de **lo que falta implementar**.

Está pensado como insumo para redactar el informe formal dirigido a la Dirección o a un
tercero evaluador. Por eso cada punto declara **dónde está la evidencia** en el repositorio:
ninguna afirmación de este documento debería poder caerse ante una revisión técnica.

**Qué NO cubre este documento:** la firma digital mediante PIN tiene su propio documento
descriptivo en [`docs/firma-digital-pines.md`](./firma-digital-pines.md). Acá se recogen
sus aspectos de seguridad y se agrega el análisis crítico que aquel no incluye.

### Convención de estado

| Marcador | Significado |
|---|---|
| **Implementado** | Existe en el código y fue verificado. Se puede afirmar ante un tercero. |
| **Parcial** | Existe el mecanismo pero le falta una pieza para ser suficiente. |
| **Pendiente** | No existe. No debe afirmarse como capacidad del sistema. |

---

## 2. Checklist consolidado

### 2.1 Aislamiento entre empresas (multi-tenant)

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 1.1 | Particionamiento de datos por empresa | **Implementado** | Clave primaria `TENANT#{tenantId}` en personas, documentos y firmas. `Backend/lib/services/PersonaService.js` |
| 1.2 | Las consultas exigen el identificador de empresa | **Implementado** | Ninguna lectura de datos personales se resuelve sin `tenantId`. |
| 1.3 | Una persona solo firma dentro de su empresa | **Implementado** | Validación previa a aceptar la firma. `Backend/handlers/signatures/handler.js` |
| 1.4 | Los documentos de una obra no acreditan a otra | **Implementado** | `documentosDelAmbito()` en `Backend/lib/completitud.js`. Cubierto por pruebas. |

### 2.2 Credenciales y autenticación

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 2.1 | El PIN nunca se almacena en texto plano | **Implementado** | Solo se guarda el hash. `Backend/lib/utils/validation.js` |
| 2.2 | El hash incorpora identificador personal y secreto de servidor | **Implementado** | `hashPin(pin, personaId)` con `PIN_SALT` desde variable de entorno. Dos personas con el mismo PIN obtienen hashes distintos. |
| 2.3 | Verificación resistente a ataques de temporización | **Implementado** | `crypto.timingSafeEqual`. |
| 2.4 | El hash nunca se expone en la API | **Implementado** | Campo interno; la respuesta solo informa si hay PIN configurado. `Backend/lib/models/Persona.js` |
| 2.5 | Mensajes de error genéricos ante credencial inválida | **Implementado** | No revelan si falló el PIN, el estado de la persona u otro. |
| 2.6 | **Función de derivación con costo para el PIN** | **Pendiente** | Usa SHA-256 simple. Ver hallazgo crítico H-1. |
| 2.7 | **Límite de intentos de PIN** | **Pendiente** | No existe bloqueo por intentos fallidos. Ver hallazgo crítico H-2. |
| 2.8 | **Throttling a nivel de API** | **Pendiente** | Sin plan de uso ni límite de tasa configurado en `Backend/serverless.yml`. |

### 2.3 Sesiones y recuperación de acceso

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 3.1 | Sesión con expiración explícita | **Implementado** | Seis horas. `Backend/handlers/auth/handler.js` |
| 3.2 | Eliminación automática de sesiones vencidas | **Implementado** | TTL nativo de DynamoDB: la sesión se borra sola, no queda residuo. |
| 3.3 | Tokens de recuperación con aleatoriedad criptográfica | **Implementado** | `crypto.randomBytes(32)`. |
| 3.4 | Tokens de recuperación almacenados hasheados | **Implementado** | `hashResetToken()` con SHA-256; nunca se guarda el token en claro. |

### 2.4 Integridad y trazabilidad documental

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 4.1 | Cada firma registra fecha, IP de origen y user-agent | **Implementado** | Verificado en `Backend/handlers/signatures/handler.js`. |
| 4.2 | El documento original nunca se modifica | **Implementado** | La evidencia de firmas se anexa; el archivo subido se preserva intacto. |
| 4.3 | Versionado inmutable con autoría y motivo | **Implementado** | Snapshot por versión con quién publicó, cuándo y por qué. `Backend/handlers/documents/handler.js` |
| 4.4 | Idempotencia: sin firmas duplicadas por reintento | **Implementado** | |
| 4.5 | Escrituras concurrentes atómicas por persona | **Implementado** | Firmas simultáneas de distintas personas no se pisan. |
| 4.6 | Serialización del estampado por documento | **Implementado** | Cola SQS FIFO con `MessageGroupId = documentId` y cola de mensajes fallidos. |
| 4.7 | Verificación independiente de una firma por token | **Implementado** | Sin exponer datos personales. |
| 4.8 | Constancia de difusión con origen declarado | **Implementado** | `Document.difusiones[]` distingue constancia automática de declarada. `Backend/lib/distribucion.js` |
| 4.9 | **Hash de integridad del archivo almacenado** | **Pendiente** | No se calcula huella del archivo al subirlo, así que no se puede demostrar que el binario no fue alterado en el almacenamiento. |

### 2.5 Control de acceso y datos sensibles

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 5.1 | Permisos por rol con presets explícitos | **Implementado** | `Backend/lib/permissions.js`; el bypass de administrador es declarado, no implícito. |
| 5.2 | Resguardo de documentos de salud | **Implementado** | Vigilancia de la salud, exámenes ocupacionales, encuestas de salud, restricciones laborales y traslados por enfermedad. `Backend/lib/documentos-salud.js` |
| 5.3 | La persona siempre accede a sus propios datos de salud | **Implementado** | Ocultarle su propio examen sería improcedente. |
| 5.4 | Falla cerrada ante solicitante no identificado | **Implementado** | Sin identificación se ocultan: el error es que falten documentos, nunca que se filtren datos de salud. Cubierto por pruebas. |
| 5.5 | Archivos servidos por URL prefirmada temporal | **Implementado** | No hay URL pública permanente sobre el almacenamiento. |
| 5.6 | **Registro de auditoría de accesos a datos sensibles** | **Pendiente** | Se audita quién firma, no quién consulta una ficha de vigilancia. Ver hallazgo H-5. |
| 5.7 | **Cifrado a nivel de campo para RUT y datos de salud** | **Pendiente** | Quien acceda a la tabla los lee en claro. |

### 2.6 Infraestructura y cifrado

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 6.1 | Cifrado en tránsito | **Implementado** | Todo el tráfico por HTTPS; API Gateway no admite HTTP plano. |
| 6.2 | **Cifrado en reposo declarado** | **Parcial** | AWS cifra S3 y DynamoDB por defecto con clave gestionada por AWS, pero **no está declarado en `Backend/serverless.yml`** ni se usa clave propia (KMS). No queda constancia de la decisión. |
| 6.3 | **Bloqueo explícito de acceso público a los buckets** | **Pendiente** | Sin `PublicAccessBlockConfiguration` en `Backend/serverless.yml`. |
| 6.4 | **Restricción de orígenes CORS en almacenamiento** | **Pendiente** | `AllowedOrigins: ['*']` en ambos buckets. |
| 6.5 | **Recuperación a un punto en el tiempo** | **Pendiente** | Sin `PointInTimeRecoverySpecification` en ninguna tabla: no hay restauración ante borrado o corrupción. |
| 6.6 | Política de retención de infraestructura | **Implementado** | `DeletionPolicy` y `UpdateReplacePolicy` configurados por ambiente. |

### 2.7 Gobernanza del dato personal

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 7.1 | **Política de retención de datos personales** | **Pendiente** | No hay plazos de conservación definidos ni mecanismo que los aplique. |
| 7.2 | **Mecanismo de supresión a solicitud del titular** | **Pendiente** | No existe. Exigible con la Ley 21.719. |
| 7.3 | **Registro de tratamientos** | **Pendiente** | No hay inventario documentado de qué datos personales se tratan, con qué finalidad y por cuánto tiempo. |
| 7.4 | **Procedimiento de notificación de brechas** | **Pendiente** | No hay protocolo definido. |
| 7.5 | Minimización en las respuestas de la API | **Parcial** | El hash del PIN nunca sale, pero no hay una revisión sistemática de qué campos personales viajan en cada respuesta. |

---

## 3. Hallazgos priorizados

### H-1. El PIN usa SHA-256 sin función de derivación con costo
**Severidad: alta**

El PIN es de cuatro dígitos: 10.000 combinaciones posibles. SHA-256 está diseñado para ser
rápido, de modo que quien obtuviera la base de datos **y** el secreto del servidor podría
recorrer el espacio completo en segundos y recuperar el PIN de todas las personas.

**Corrección:** migrar a `scrypt`, `bcrypt` o PBKDF2 con costo configurado. Es migrable de
forma progresiva: se re-hashea en el siguiente ingreso exitoso de cada persona, sin pedirle
nada al usuario ni invalidar los PIN existentes.

**Ubicación:** `Backend/lib/utils/validation.js`

### H-2. No hay límite de intentos de PIN
**Severidad: alta**

Nada impide probar las 10.000 combinaciones contra el endpoint de firma. Combinado con H-1,
convierte al PIN en una credencial débil frente a un atacante con acceso a la API.

**Corrección:** contador de intentos fallidos por persona con bloqueo temporal progresivo, y
plan de uso con límite de tasa en API Gateway.

### H-3. Sin recuperación a un punto en el tiempo
**Severidad: media**

Un borrado accidental o una corrupción de datos no tienen vuelta atrás. Para un sistema cuyo
valor es la evidencia de cumplimiento ante fiscalización, la pérdida de datos es la falla más
costosa posible.

**Corrección:** habilitar `PointInTimeRecoverySpecification` en las tablas con datos de
cumplimiento y datos personales.

### H-4. Cifrado en reposo y exposición del almacenamiento no declarados
**Severidad: media**

Los buckets no bloquean explícitamente el acceso público, aceptan cualquier origen CORS, y ni
buckets ni tablas declaran su configuración de cifrado. Aunque AWS cifra por defecto, ante un
tercero evaluador **lo que no está declarado no se puede acreditar**.

**Corrección:** `PublicAccessBlockConfiguration` con las cuatro opciones activas, `AllowedOrigins`
acotado a los dominios de la aplicación, y `BucketEncryption` / `SSESpecification` explícitos,
idealmente con clave gestionada por el cliente.

### H-5. No se audita el acceso a datos sensibles
**Severidad: media**

El resguardo de documentos de salud impide el acceso indebido, pero no deja rastro de los
accesos legítimos. Para datos sensibles, el registro de acceso es lo que permite **detectar** un
uso indebido por parte de quien sí tiene permiso.

**Corrección:** registrar consulta y descarga de documentos de salud con persona, fecha y
documento, con retención acotada.

### H-6. Sin gobernanza del ciclo de vida del dato personal
**Severidad: media, con plazo normativo**

No hay política de retención, ni mecanismo de supresión a solicitud, ni registro de
tratamientos, ni protocolo de notificación de brechas.

**Contexto normativo:** la Ley 21.719 sobre protección de datos personales entra en vigencia en
**diciembre de 2026** y hace exigibles estos cuatro elementos, con régimen sancionatorio
asociado y una agencia con potestad fiscalizadora.

### H-7. Sin huella de integridad del archivo almacenado
**Severidad: baja**

El sistema preserva el documento original y registra quién lo firmó, pero no calcula una huella
del binario al subirlo. No se puede demostrar criptográficamente que el archivo servido hoy es
idéntico al que se subió.

**Corrección:** calcular SHA-256 del archivo al confirmar la carga y guardarlo junto al
documento; verificarlo al descargar.

---

## 4. Cómo presentar el estado actual

La plataforma es **sólida en trazabilidad e integridad**, que es precisamente lo que el
DS 44 exige y donde está concentrado el trabajo: quién firmó qué, cuándo, desde dónde, sobre
qué versión del documento, y con qué constancia de difusión. Eso se puede afirmar y sostener.

La deuda está en dos frentes distintos:

1. **Protección criptográfica de la credencial** (H-1, H-2). Es el punto más débil del sistema
   y el más barato de corregir.
2. **Gobernanza del dato personal** (H-5, H-6). No es materia del DS 44 sino de la Ley 21.719,
   y tiene fecha: diciembre de 2026.

La recomendación es abordar H-1 y H-2 de inmediato —son cambios acotados y migrables sin
fricción para el usuario— y planificar H-6 con el plazo normativo a la vista.

---

## 5. Verificación

Las afirmaciones de este documento se obtuvieron leyendo el código de la rama de trabajo, no de
documentación previa. Los puntos marcados como **Pendiente** en la sección de infraestructura se
verificaron por ausencia:

```bash
# No devuelven resultados: la configuración no existe
grep -n "PublicAccessBlockConfiguration" Backend/serverless.yml
grep -n "PointInTimeRecoverySpecification" Backend/serverless.yml
grep -n "BucketEncryption\|SSESpecification" Backend/serverless.yml

# Confirman lo implementado
grep -n "timingSafeEqual" Backend/lib/utils/validation.js
grep -n "sourceIp\|user-agent" Backend/handlers/signatures/handler.js
node --test Backend/tests/documentos-salud.test.js
```
