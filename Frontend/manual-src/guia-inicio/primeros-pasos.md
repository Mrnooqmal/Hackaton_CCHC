# Primeros pasos

Una vez instalada la plataforma, este es el recorrido típico para poner una obra en
marcha y empezar a operar.

## 1. Iniciar sesión

Ingresa con las credenciales del administrador (creadas durante el
[onboarding del tenant](/guia-inicio/onboarding)). La sesión usa JWT; ver
[Autenticación](/api/autenticacion).

## 2. Configurar la empresa (tenant)

Como admin, revisa la configuración de tu empresa:

- **Módulos activos** según tu plan.
- **Reglas SST**: qué fases del DS 44 aplican a tus obras.
- **Personalización**: logo, colores, preferencias regionales.

Ver [Tenants](/modulos/tenants).

## 3. Crear una obra

Crea tu primera obra. Al hacerlo, la plataforma **precrea automáticamente** los
documentos obligatorios de cada fase según las reglas del tenant.

```
Nueva obra → fasesConfig precargado → documentos obligatorios listos
```

Ver [Obras](/modulos/obras).

## 4. Registrar personas

Da de alta a las personas de la obra (prevencionista, supervisores, trabajadores).
Define para cada una:

- Su **rol** (determina permisos).
- Si **tiene acceso web** o solo firma en terreno.
- Las **obras** a las que está asignada.

Ver [Personas](/modulos/personas).

## 5. Cargar y firmar documentos

- Sube los archivos a los documentos obligatorios de la fase actual.
- Asigna documentos diarios a las personas que correspondan.
- Las personas reciben notificación y firman con su PIN.

Ver [Documentos](/modulos/documentos) y [Firmas](/modulos/firmas).

## 6. Programar actividades

Programa charlas y capacitaciones. Registra asistencia y recoge las firmas de los
asistentes y del relator.

Ver [Actividades](/modulos/actividades).

## 7. Monitorear desde el Dashboard

Revisa los KPIs de seguridad, el cumplimiento por fase y los incidentes recientes desde
el [Dashboard](/modulos/dashboard).

## Flujo resumido

```
Login → Configurar tenant → Crear obra → Registrar personas
   → Cargar/firmar documentos → Programar actividades → Monitorear
```

::: tip Avance de fase
Cuando la fase actual tenga todos sus documentos obligatorios firmados, el jefe de obra
podrá avanzar a la siguiente fase. La plataforma verifica el cumplimiento antes de
permitirlo. Ver [Fases de obra](/ds44/fases-obra).
:::
