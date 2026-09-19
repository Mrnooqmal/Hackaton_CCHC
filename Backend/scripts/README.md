# Scripts operativos

Scripts que se ejecutan con credenciales de AWS, no desde la aplicacion. Los de
migracion siguen el patron `--dry-run` (default) / `--apply` y son idempotentes
salvo que se indique.

## sembrar-ambiente.js

Deja un ambiente recien desplegado listo para usar: **empresa, administrador y
catalogo de cargos con los kits del DS 44**. Nada mas: sin obras, sin personal de
ejemplo, sin documentos de muestra. Un ambiente con datos de demostracion es uno
donde nadie distingue lo real de lo inventado.

```
AWS_PROFILE=<perfil> node scripts/sembrar-ambiente.js --stage prod --datos empresa.json [--confirmar]
```

Es idempotente en lo que importa: si la empresa ya existe no la duplica, y si el
catalogo ya esta cargado no lo pisa. Usa el mismo archivo de datos que
`crear-empresa.js`.

## crear-empresa.js

Alta de una empresa y de su primer administrador. **Es la unica via**: el alta
dejo de ser un endpoint publico (`POST /tenants/setup`), porque dependia de un
codigo compartido —fragil por diseno y vacio en los dos ambientes— y porque no
existe un rol de plataforma que pueda autorizarla desde dentro del sistema. Aca
la autorizacion es IAM y cada escritura queda en CloudTrail.

```
# Ensayo: valida los datos y la unicidad, no escribe nada.
AWS_PROFILE=<perfil> node scripts/crear-empresa.js --stage prod --datos empresa.json

# Alta real.
AWS_PROFILE=<perfil> node scripts/crear-empresa.js --stage prod --datos empresa.json --confirmar
```

`empresa.json`:

```json
{
  "nombre": "Constructora Ejemplo SpA",
  "rutEmpresa": "76.111.999-0",
  "admin": {
    "rut": "15.111.222-6",
    "nombre": "Maria",
    "apellidoPaterno": "Soto",
    "apellidoMaterno": "Rivas",
    "email": "maria.soto@ejemplo.cl"
  }
}
```

La contrasena temporal viaja por correo (SES) y se cambia en el primer ingreso;
solo se imprime en pantalla si el envio falla. Roles, cargos y preferencias
quedan en sus valores por defecto y se configuran despues desde Mi Empresa.

## La pimienta de las credenciales (no es un script, pero se opera a mano)

El PIN y la contrasena se hashean con scrypt mas una **pimienta**: una llave de
256 bits que vive en SSM, no en la tabla, y sin la cual un volcado de DynamoDB no
sirve para probar ni un intento. No la crea CloudFormation porque CloudFormation
no sabe crear parametros `SecureString`.

Ya existe una por ambiente, version 1:

```
/BuildAndServe/dev/credencial-pepper
/BuildAndServe/prod/credencial-pepper
```

Crearla donde no exista (cifrada con la CMK del stack, `ClaveDatos`):

```
AWS_PROFILE=<perfil> aws ssm put-parameter \
  --name /BuildAndServe/<stage>/credencial-pepper \
  --type SecureString --key-id <id de la CMK del stack> \
  --value "$(openssl rand -base64 32)"
```

El valor **no se imprime nunca**: se genera dentro del comando y no pasa por la
pantalla ni por el historial.

**Si se pierde**, nadie queda bloqueado para siempre pero sí para entrar: las
contrasenas se recuperan con el flujo de "olvide mi contrasena" y los PIN los
reconfigura la persona o un administrador. Es recuperable, no es indoloro.

**Rotarla** es crear la version nueva y dejar la anterior declarada mientras
queden hashes hechos con ella:

1. `CREDENCIAL_PEPPER_V: 2` en `serverless.yml` y el parametro nuevo en SSM.
2. `CREDENCIAL_PEPPER_ANTERIORES: "1:<valor anterior>"` mientras dure la
   transicion. Cada credencial se actualiza sola la proxima vez que su dueno
   entra, porque el hash guarda con que version se hizo.
3. Cuando ya no queden hashes con `pv=1`, se quita esa variable.

Sin el paso 2, un hash hecho con la version anterior **falla** en vez de
responder "credencial incorrecta". Es deliberado: decir que no coincide seria
mentir sobre algo que no se puede juzgar.

## migrate-to-personas.js
Migracion historica: une `Users` + `Workers` legacy en `Personas`.
```
node scripts/migrate-to-personas.js --stage dev [--dry-run]
```

## migrate-workerId-to-personaId.js
Normaliza referencias embebidas: copia `workerId -> personaId` en
`asignaciones`, `firmas`, `asistentes`, `trabajadores` y `afectado` de las
tablas Documents, SignatureRequests, Activities e Incidents. No borra
`workerId` (se retira en una limpieza posterior).
```
STAGE=dev node scripts/migrate-workerId-to-personaId.js --dry-run
STAGE=dev node scripts/migrate-workerId-to-personaId.js --apply
```

> ADVERTENCIA: NO ejecutar `--apply` en produccion sin backup previo de las
> tablas afectadas (habilitar Point-in-Time Recovery o exportar a S3 antes).
> Ejecutar siempre primero en `dev` y validar con `--dry-run`.

Nombres de tabla: se leen de las variables de entorno
(`DOCUMENTS_TABLE`, `SIGNATURE_REQUESTS_TABLE`, `ACTIVITIES_TABLE`,
`INCIDENTS_TABLE`); si no estan, se construyen como
`${SERVICE_NAME:-BuildAndServe}-<tabla>-${STAGE:-dev}`.
