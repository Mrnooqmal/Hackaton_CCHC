# Actividad N°2: Cifrado de datos (Build & Serve)

**Integrantes:** Alonso Cárdenas, Benjamín Pinto, Benjamín Sánchez, Adrean Torres
**Repositorio:** https://github.com/Mrnooqmal/Hackaton_CCHC (rama `pruebas`)

Las rutas de este documento son relativas a la raíz del repositorio.

## 0. Actualización de la Actividad N°1

La matriz de actores y riesgos CIA de la Actividad N°1 describía la plataforma al 12 de septiembre de 2026. Desde entonces, el equipo preparó el sistema para una **marcha blanca con datos reales**, y eso exigió endurecer la seguridad antes de recibir información de personas. Varios riesgos de esa matriz se transformaron en controles implementados, y algunas filas ya no describen el sistema actual. Esta sección deja constancia de esos cambios. La tabla del Item I parte de esta versión corregida.

| Fila de la Actividad 1 | Lo que decía | Lo que hay hoy | Fecha y commit |
|---|---|---|---|
| PIN de firma | Hash de PIN + personaId + secreto | scrypt con sal aleatoria por hash y una pimienta guardada en AWS SSM. Límite de intentos con bloqueo progresivo desde el quinto fallo | 19-sep `0cb56d9`, 22-sep `5521bf6` |
| Credenciales de acceso web | Contraseña y token JWT de sesión | La contraseña usa el mismo esquema scrypt. La sesión **no es JWT**: es un token aleatorio de 256 bits, del que el servidor guarda solo el hash SHA-256, con 6 horas de vigencia. Cambiar la contraseña revoca todas las sesiones | 19-sep `0cb56d9`, 30-sep `d750646` |
| Datos personales de identificación | Protegidos por la Ley 19.628 | El marco de referencia pasa a la Ley 21.719, que modifica la 19.628 y rige desde diciembre de 2026. El RUT se guarda cifrado y se busca por HMAC | 24-sep `f81b431` |
| Firmas capturadas sin conexión | IndexedDB + offlineToken | El PIN ya no se guarda en el dispositivo. Al iniciar el turno, con conexión, se emiten vales de un solo uso que vencen a las 12 horas, y el servidor guarda solo su hash | 16-sep `b61c708` |
| Respuestas a encuestas | Riesgo identificado | Se cifran siempre el RUT de cada destinatario y sus respuestas | 24-sep `6956335` |
| Evidencias de salud | Riesgo identificado | Cifrado de campo, y auditoría de cada acceso a datos de salud en una tabla de solo agregar | 24-sep `f81b431`, 29-sep `9e13a83` |
| Proveedor de SMS y correo | SMS y correo | **Se eliminó el canal SMS.** Solo queda correo transaccional desde un dominio propio, con rebotes y quejas monitoreados | 29-sep `79d687e`, `3ab3823` |
| tenantId que aísla los datos | "Se extrae siempre del JWT" | La fila describía el diseño previsto. Al revisarlo se detectó que la API aún no validaba la sesión en todas las rutas. Se corrigió: hoy toda ruta exige sesión y la empresa se toma de la sesión del servidor, nunca de la petición | 15-sep `84f5dcb` |
| Archivos y procedimientos en S3 | Riesgo de reemplazo | Huella SHA-256 del archivo, verificada por S3 al recibirlo y comprobada en cada descarga | 26-sep `58845ba` |
| Registro Art. 72 e informe Art. 71 | Riesgo de cálculo mal derivado | Se detectó y corrigió que la huella de los informes firmados no cubría su contenido anidado | 26-sep `9128bca` |

## 1. Item I: cuadro de decisión por campo

**Criterio general:**

- **Cifrado (reversible)** si el sistema necesita volver a mostrar el dato.
- **Hash (irreversible)** si basta con comprobar que lo presentado coincide.
- **Tokenización** si hace falta una referencia que no revele el dato, o una credencial temporal que lo reemplace.

| Campo | Necesidad | Elección | Criterio técnico | Implementación | Evidencia |
|---|---|---|---|---|---|
| RUT de la persona (búsqueda) | Encontrar a la persona por RUT en el login y evitar duplicados, sin guardarlo en claro | Tokenización determinista: HMAC-SHA256 | Para buscar se necesita que el mismo RUT dé siempre el mismo valor. Un hash sin llave sería atacable por fuerza bruta, porque los RUT son pocos y predecibles; con la llave secreta no se puede recalcular. El RUT se normaliza antes, para que puntos y guion no cambien el resultado | `hmac()` en [Backend/lib/cifradoCampo.js](../Backend/lib/cifradoCampo.js). La llave es un `SecureString` de SSM (`campo-hmac-key`), separada de la pimienta de credenciales | [tests/cifrado-campo.test.js](../Backend/tests/cifrado-campo.test.js): "el HMAC del RUT es determinista", "el HMAC no distingue formato", "RUT distintos dan HMAC distintos" |
| RUT de la persona (mostrar) | Mostrarlo en fichas, actas y firmas | Cifrado AES-256-GCM con cifrado de sobre | Hay que recuperar el valor. GCM da confidencialidad e integridad: un cambio de un bit se detecta por la etiqueta de 128 bits. El IV es aleatorio, así que dos cifrados del mismo RUT no se pueden correlacionar | `cifrarSobre()` / `descifrarSobre()` en [cifradoCampo.js](../Backend/lib/cifradoCampo.js). Una llave de datos AES-256 por empresa, generada y envuelta por una llave maestra (CMK) de AWS KMS ([llaveTenant.js](../Backend/lib/llaveTenant.js)) | [tests/cifrado-campo.test.js](../Backend/tests/cifrado-campo.test.js): "el sobre no expone el valor en claro en ninguno de sus campos", "cifrar y descifrar un sobre da el valor original", "crear(): el RUT nunca queda en la tabla en claro" |
| RUT e IP dentro de firmas, asignaciones y asistentes | Mostrar quién firmó y desde dónde, como traza legal | Cifrado AES-256-GCM con la llave de la empresa | Es parte del contenido del documento y se lee en listados de decenas de registros. Con la llave por empresa se hace una sola llamada a KMS por listado, en vez de una por valor | [Backend/lib/arregloSensible.js](../Backend/lib/arregloSensible.js) | [tests/registro-cifrado.test.js](../Backend/tests/registro-cifrado.test.js) |
| Datos de salud (vigilancia, restricción laboral, exámenes) | Mostrar el estado de vigencia a quien tiene permiso | Cifrado AES-256-GCM con una llave de salud por empresa, distinta de la del RUT | Es un dato sensible. Llaves separadas limitan el impacto si se compromete una. Se cifra incluso el valor `null`, para no revelar quién tiene restricción | [llaveTenant.js](../Backend/lib/llaveTenant.js) (`PROPOSITOS.SALUD`) y [cifradoCampo.js](../Backend/lib/cifradoCampo.js). Cada acceso queda auditado ([auditoriaSalud.js](../Backend/lib/gobernanza/auditoriaSalud.js)) | [tests/cifrado-campo.test.js](../Backend/tests/cifrado-campo.test.js): "crear(): la salud tampoco queda en claro, incluida la restricción null", "RUT y salud son atributos distintos en la fila del tenant" |
| Respuestas a encuestas y RUT del destinatario | Consolidar resultados sin exponer quién respondió qué | Cifrado AES-256-GCM, siempre, incluso si la respuesta está vacía | Cifrar solo las respuestas no vacías revelaría quién no contestó | `cifrarConLlaveDatosSiempre()` en [cifradoCampo.js](../Backend/lib/cifradoCampo.js) | [tests/cifrado-campo.test.js](../Backend/tests/cifrado-campo.test.js): "cifrarConLlaveDatosSiempre: null SÍ produce un sobre real" |
| PIN de firma (4 dígitos) | Comprobar que quien firma es el titular. Nunca hay que recuperarlo | Hash scrypt (N=2^15, r=8, p=1) con sal aleatoria por hash y pimienta | Con solo 10.000 combinaciones, SHA-256 cae en microsegundos. scrypt es costoso en memoria, la sal impide precalcular tablas y la pimienta en SSM hace que la base de datos sola no alcance para un ataque. Se compara en tiempo constante y hay límite de intentos | [Backend/lib/credenciales.js](../Backend/lib/credenciales.js), formato `$scrypt$ln=15,r=8,p=1,pv=1$<sal>$<derivada>`. Límite en [Backend/lib/limitePin.js](../Backend/lib/limitePin.js) | [tests/credenciales.test.js](../Backend/tests/credenciales.test.js) y [tests/limite-pin.test.js](../Backend/tests/limite-pin.test.js) |
| Contraseña de acceso web | Autenticar. Nunca hay que recuperarla | Hash scrypt con sal y pimienta, igual que el PIN | El algoritmo y sus parámetros quedan dentro del hash, así que se puede subir el costo o rotar la pimienta sin invalidar las cuentas | [credenciales.js](../Backend/lib/credenciales.js) | [tests/credenciales.test.js](../Backend/tests/credenciales.test.js): "el mismo secreto dos veces da dos hashes distintos", "el hash de una persona no sirve para otra", "rotar la pimienta deja entrar con la anterior y marca el reemplazo" |
| Token de sesión | Identificar la sesión en cada petición | Token aleatorio de 256 bits; el servidor guarda solo su hash SHA-256 | El token ya es aleatorio, así que basta un SHA-256 sin sal. Quien lea la tabla de sesiones no puede usar ninguna | `hashToken` en [Backend/lib/auth/sesion.js](../Backend/lib/auth/sesion.js) | [tests/sesion.test.js](../Backend/tests/sesion.test.js), [tests/cambio-password-sesiones.test.js](../Backend/tests/cambio-password-sesiones.test.js): "la sesión con la que se cambió queda revocada" |
| Token de restablecimiento de contraseña | Probar que quien restablece recibió el correo | Token aleatorio de 256 bits, guardado como hash, que vence a los 30 minutos | Mismo criterio que la sesión, más una vigencia corta | `hashResetToken` en [Backend/handlers/auth/handler.js](../Backend/handlers/auth/handler.js) | [tests/cambio-password-sesiones.test.js](../Backend/tests/cambio-password-sesiones.test.js): "restablecer la contraseña por correo revoca las sesiones abiertas" |
| Vale de firma sin conexión | Firmar en terreno sin red y sin guardar el PIN en el dispositivo | Tokenización: vales aleatorios de 256 bits, de un solo uso, que vencen a las 12 horas; el servidor guarda solo el hash | Reemplaza al PIN en el dispositivo: si se roba el teléfono, el vale caduca y se puede revocar | [Backend/lib/services/ValeFirmaService.js](../Backend/lib/services/ValeFirmaService.js) | [tests/vale-firma.test.js](../Backend/tests/vale-firma.test.js): "el vale se guarda hasheado, nunca en claro", "un vale sirve una sola vez", "el vale de una persona no firma por otra" |
| Token de verificación de firma (`SIG-…`) | Que un tercero, como el fiscalizador, verifique una firma sin acceder a datos personales | Tokenización: `SIG-<timestamp>-<96 bits aleatorios>` | Es una referencia pública que no se deriva del dato personal, así que no permite reconstruirlo | [Backend/lib/utils/validation.js](../Backend/lib/utils/validation.js), endpoint `verifySignatureByToken` | [tests/token-firma.test.js](../Backend/tests/token-firma.test.js) |
| Contenido de documentos e informes firmados | Probar que lo firmado no cambió | Huella SHA-256 sobre una forma canónica, versionada | Se calcula sobre el contenido en claro, antes de cifrar, para que rotar llaves no invalide firmas antiguas | [Backend/lib/huella.js](../Backend/lib/huella.js) | [tests/huella-integridad.test.js](../Backend/tests/huella-integridad.test.js): huellas del Art. 71 y del registro AT/EP, "la huella se verifica con la regla con que se firmó" |
| Archivos de evidencia en S3 | Detectar que un archivo fue reemplazado | Huella SHA-256 del archivo, verificada por S3 | El navegador calcula la huella, el servidor la firma dentro de la URL de subida y S3 rechaza bytes que no coinciden | [Backend/lib/huellaArchivo.js](../Backend/lib/huellaArchivo.js) | [tests/huella-archivo.test.js](../Backend/tests/huella-archivo.test.js) |
| URL de descarga o subida de un documento o evidencia | Entregar el archivo solo a quien tiene permiso | Token temporal: URL prefirmada de S3 | Expira a los 15 minutos (5 para subir) y se emite solo después de verificar permiso y empresa | `URL_VIGENCIA_SEGUNDOS = 900` en [Backend/handlers/documents/handler.js](../Backend/handlers/documents/handler.js) y [Backend/handlers/uploads/handler.js](../Backend/handlers/uploads/handler.js) | [tests/s3-presign-checksum.test.js](../Backend/tests/s3-presign-checksum.test.js): "con la huella del archivo, se firma como header y no viaja en la URL"; [tests/uploads-pertenencia.test.js](../Backend/tests/uploads-pertenencia.test.js) |
| Correo, teléfono y fecha de nacimiento | Contactar a la persona y mostrar su ficha | **Sin cifrado de campo**: solo cifrado en reposo de la tabla con la CMK de KMS. El correo además es buscable por HMAC | Es una decisión consciente: no son datos sensibles en el sentido de la ley y el riesgo residual queda documentado. Los listados para cualquier rol están registrados como hallazgo H-16, a la espera de una decisión de producto | Cifrado de DynamoDB con KMS (`ClaveDatos` en [Backend/serverless.yml](../Backend/serverless.yml)) | [docs/gobernanza-y-seguridad-de-datos.md](gobernanza-y-seguridad-de-datos.md), H-16 |

## 2. Item II: aplicación del cifrado, el hash y la tokenización

### 2.1 Código fuente

Todo está en este repositorio. Los módulos principales son:

| Módulo | Qué hace |
|---|---|
| [Backend/lib/cifradoCampo.js](../Backend/lib/cifradoCampo.js) | HMAC para buscar; cifrado de sobre AES-256-GCM con KMS |
| [Backend/lib/llaveTenant.js](../Backend/lib/llaveTenant.js) | Llaves de datos por empresa, separadas para RUT y salud |
| [Backend/lib/arregloSensible.js](../Backend/lib/arregloSensible.js) | Cifrado de RUT e IP dentro de firmas y asignaciones |
| [Backend/lib/credenciales.js](../Backend/lib/credenciales.js) | scrypt con sal y pimienta para el PIN y la contraseña |
| [Backend/lib/limitePin.js](../Backend/lib/limitePin.js) | Límite de intentos de PIN con bloqueo progresivo |
| [Backend/lib/auth/sesion.js](../Backend/lib/auth/sesion.js) | Tokens de sesión guardados como hash |
| [Backend/lib/services/ValeFirmaService.js](../Backend/lib/services/ValeFirmaService.js) | Vales de firma de un solo uso |
| [Backend/lib/huella.js](../Backend/lib/huella.js), [Backend/lib/huellaArchivo.js](../Backend/lib/huellaArchivo.js) | Huellas de integridad del contenido y del archivo |

### 2.2 Protección de los campos críticos

Un registro de persona queda así en la base de datos:

- El RUT nunca está en claro: queda el HMAC para buscar y un sobre cifrado para mostrar.
- La salud va cifrada con su propia llave.
- El PIN y la contraseña quedan como hash scrypt.

Si falta el cifrado, `toDynamoItem` lanza un error en vez de escribir el registro (test "toDynamoItem revienta si falta el cifrado, no escribe un campo vacío", en [tests/cifrado-campo.test.js](../Backend/tests/cifrado-campo.test.js)).

### 2.3 Evidencia de funcionamiento

Salida de la suite de pruebas de cifrado, hash y tokenización, ejecutada el 1 de octubre de 2026 sin conexión a AWS:

```
cd Backend
node --test --require ./tests/sin-aws.js tests/cifrado-campo.test.js tests/credenciales.test.js \
  tests/huella-integridad.test.js tests/huella-archivo.test.js tests/vale-firma.test.js \
  tests/sesion.test.js tests/token-firma.test.js tests/limite-pin.test.js tests/registro-cifrado.test.js

ℹ tests 210
ℹ suites 14
ℹ pass 210
ℹ fail 0
```

Extracto de las pruebas que pasan:

```
✔ el hash guarda con qué se hizo
✔ el mismo secreto dos veces da dos hashes distintos
✔ el secreto correcto entra y el incorrecto no
✔ el hash de una persona no sirve para otra
✔ un hash corrupto o de otro formato no valida nada
✔ sin la pimienta, el hash no se puede probar
✔ rotar la pimienta deja entrar con la anterior y marca el reemplazo
✔ huella del informe de investigación (Art. 71)
✔ huella del registro AT/EP (Arts. 71-72)
✔ la huella se verifica con la regla con que se firmó
✔ el vale se guarda hasheado, nunca en claro
✔ un vale sirve una sola vez
✔ el vale de una persona no firma por otra
✔ un vale inventado no sirve
✔ un vale revocado no firma, y el motivo lo dice
```

La suite completa del backend (`npm test` en `Backend/`) tiene 1041 pruebas y todas pasan. Además, cada prueba de seguridad se validó saboteando el control que protege: se rompe el control, se comprueba que la prueba falla y se restaura.

### 2.4 Cómo se recupera o valida cada dato

- **Cifrado (RUT, salud, encuestas, IP):**
  1. Se lee el sobre: IV, texto cifrado, etiqueta y la llave de datos envuelta.
  2. KMS desenvuelve la llave de datos. Solo el rol de la Lambda tiene `kms:Decrypt`.
  3. Se descifra con AES-256-GCM. Si alguien alteró un byte, la etiqueta no coincide y se rechaza; nunca se devuelve un dato corrupto.
- **HMAC (búsqueda por RUT):** se normaliza el RUT ingresado, se calcula el HMAC con la llave de SSM y se busca por ese valor. El RUT no se recupera desde el HMAC.
- **Hash scrypt (PIN y contraseña):** se lee del hash el algoritmo, los parámetros, la sal y la versión de la pimienta. Se recalcula con lo ingresado y se compara en tiempo constante. Si el hash es de un esquema anterior, se reemplaza en el mismo ingreso.
- **Tokens (sesión, restablecimiento, vales):** se calcula el SHA-256 de lo presentado y se busca. Luego se comprueba la vigencia y, en el caso de los vales, que no se hayan usado ni revocado.
- **Huellas:** se recalcula la huella del contenido (o S3 entrega la del archivo) y se compara con la registrada al firmar.

### 2.5 Evidencia de que las llaves y los secretos no quedan expuestos

1. **Las llaves criptográficas no viven en el código ni en la plantilla de despliegue.** [Backend/serverless.yml](../Backend/serverless.yml) solo nombra los parámetros (`CREDENCIAL_PEPPER_PARAM`, `CAMPO_HMAC_KEY_PARAM`). Los valores son `SecureString` de SSM cifrados con la CMK y se leen en ejecución, no al desplegar, así que no quedan en CloudFormation.
2. **Las llaves de datos nunca se guardan en claro:** se guardan envueltas por KMS, y la llave maestra no sale de KMS.
3. **Mínimo privilegio, verificado en `serverless.yml`:** el rol de la Lambda permite `kms:Encrypt`, `kms:Decrypt`, `kms:ReEncrypt*`, `kms:GenerateDataKey*` y `kms:DescribeKey` solo sobre la CMK del sistema (`!GetAtt ClaveDatos.Arn`), y `ssm:GetParameter` solo sobre los dos parámetros `/BuildAndServe/<stage>/credencial-pepper` y `/BuildAndServe/<stage>/campo-hmac-key`.
4. **Escaneo con gitleaks 8.21.2 del historial completo del repositorio** (316 commits, todas las ramas): 2 resultados, ambos falsos positivos:
   - un token de ejemplo truncado (`eyJhbGciOi...`) en el manual de la API (`Frontend/manual-src/api/autenticacion.md`);
   - el identificador de un Origin Access Control de CloudFront (`cloudfront-distribution.json`), que identifica un recurso pero no da acceso a nada.

   No hay llaves de AWS, de APIs ni privadas en el historial. `.env` y la carpeta de build `.serverless/` están en `.gitignore` y no están versionados.
5. **Pruebas aisladas de AWS:** [tests/sin-aws.js](../Backend/tests/sin-aws.js) impide que la suite toque servicios reales, y las pruebas usan llaves generadas en el momento.
6. **Logs sin datos personales:** se corrigió que los logs registraran datos personales (hallazgo H-11 en [docs/gobernanza-y-seguridad-de-datos.md](gobernanza-y-seguridad-de-datos.md)).
7. **Rotación prevista:** la pimienta y la llave HMAC están versionadas (`pv=1`, `CREDENCIAL_PEPPER_V`, `CAMPO_HMAC_KEY_V`), así que se pueden rotar sin invalidar lo existente.
8. **Excepción detectada y pendiente:** el mismo escaneo sobre los archivos locales mostró que la clave de API del servicio de transcripción (`GEMINI_API_KEY`) se inyecta como variable de entorno resuelta **al desplegar**. Por eso queda en la plantilla de CloudFormation y en la configuración de la Lambda dentro de AWS. No está en el repositorio, pero no sigue el mismo patrón que las llaves criptográficas. La corrección es moverla a un `SecureString` de SSM leído en ejecución, igual que la pimienta.
