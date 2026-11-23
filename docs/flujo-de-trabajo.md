# Flujo de trabajo

Vigente desde el 22 de noviembre de 2026. Reemplaza las ramas especiales (`alertas-soporte`, `sesion-cookie` y otras): no se crean más.

## Las ramas

| Rama | Qué es | Quién escribe en ella |
|---|---|---|
| `main` | Lo que corre en prod. | Nadie directamente. Solo avanza al commit de `pruebas` que ya se probó en dev. |
| `pruebas` | Lo que corre en dev. Todo lo que está aquí está terminado. | Nadie directamente. Entra solo por pull request revisado. |
| Una rama por tarea | El trabajo en curso. | Quien hace la tarea. |

## Una tarea, de principio a fin

1. **Crea la rama desde `pruebas` actualizada:**
   ```bash
   git switch pruebas && git pull
   git switch -c <tipo>/<tema-corto>     # p. ej. fix/firma-sin-red, feat/reactivar-acceso
   ```
2. **Trabaja y commitea en tu rama.** Antes de abrir el pull request, pasa las pruebas en tu máquina:
   ```bash
   cd Backend && npm test
   cd ../Frontend && npm test && npm run build
   ```
3. **Abre el pull request hacia `pruebas`.** En la descripción, di qué cambia, cómo lo probaste y qué tiene que mirar quien revisa. Si cambia algo que ve el usuario, incluye una captura.
4. **Otra persona lo revisa y lo aprueba.** Nadie aprueba su propio pull request. Si después de la aprobación agregas commits, la aprobación se pierde y hay que revisar de nuevo.
5. **Se mezcla a `pruebas` solo si está terminado.** Terminado quiere decir: funciona, tiene sus pruebas, pasa la suite completa, y el manual y los documentos están al día. Lo que está a medias espera en su rama; no entra a `pruebas` escondido.
6. **Se despliega `pruebas` en dev** (lo hace Adrean, o quien él designe), y el equipo lo prueba ahí.

## Despliegues

- **Dev se despliega solo desde `pruebas`.** Nunca desde una rama de tarea: dos ramas en el mismo stack se borran recursos entre sí (el 22 de noviembre de 2026 quedó huérfano el bucket de dictados por eso). Los scripts de despliegue lo exigen: en dev rechazan un commit que no esté en `origin/pruebas`, y en prod uno que no esté en `origin/main`.
- **Prod se despliega solo desde `main`, con el mismo commit que se probó en dev.** Para pasar a prod, `main` avanza a ese commit sin crear uno nuevo:
  ```bash
  git fetch origin
  git push origin <commit-probado-en-dev>:main    # solo avanza; si GitHub lo rechaza, main tiene algo que pruebas no tiene: avisar
  infra/desplegar-backend.sh <commit-probado-en-dev> prod
  infra/desplegar-frontend.sh <commit-probado-en-dev> prod
  ```
- **No se despliega en prod durante una visita a obra o a un cliente,** ni el día hábil anterior. Si algo se rompe en prod durante una visita, se avisa a Adrean y él decide.
- El orden de cada despliegue y sus cuidados están en `docs/estado-actual.md`, sección de despliegue.

## Un arreglo urgente en prod

Sigue el mismo camino, más rápido: rama desde `pruebas`, pull request revisado, dev, y después `main`. Si `pruebas` tiene algo que todavía no puede salir a prod, no se inventa una rama especial: se habla con Adrean antes de tocar nada.

## Protección de las ramas

En el repositorio, `main` y `pruebas` se protegen: no se borran, no aceptan push forzado, `pruebas` exige pull request con una aprobación de otra persona (que se pierde con cada commit nuevo), y en `main` solo puede avanzar quien publica en prod.

## Reglas que no cambian

- El código va sin comentarios; lo que hay que explicar va en `docs/`.
- Las pruebas manuales se hacen en dev (`https://dev.buildandserve.cl`), nunca en prod.
- Nadie fuerza un push (`--force`) a `main` ni a `pruebas`.
