# Traspaso: botones de subir en Detalle de persona

Estado al 26 de noviembre de 2026. Borrar este archivo antes de integrar la rama a `pruebas`.

## Dónde está

- Rama `fix/subir-documentos-ficha-persona`, creada desde `pruebas` (`3b3edf8`). Arreglo en `3174288`.
- Sin PR todavía. Va hacia `pruebas` y lo aprueba otra persona.

## Reporte

"Los botones de subir no funcionan dentro de Detalle de persona".

Causa: sin documento asignado, la función de subida salía sin avisar, y no revisaba la respuesta de S3, la confirmación ni el guardado.

## Decisiones

- Sin documento asignado no se ofrece Subir; la ficha lo indica.
- No se crea el documento al subir: cambiaría el backend y las reglas de onboarding.
- No se ofrece Reemplazar sobre un documento que ya tiene firmas.
- Con varios documentos del mismo tipo se sube al de la obra en vista.
- La rama parte de `pruebas` y no de `incidentes-rediseño`.

## Verificado

- `npm run build`, frontend 110/110, backend 1535/1535 y 12 pruebas en `Frontend/tests/e2e/ficha-subir.spec.mjs`.
- Todo con la API simulada. No se probó contra dev.
- Hubo una revisión independiente; lo que se podía corregir en el frontend está aplicado.

## Por decidir antes del PR

- En los ítems sin documento sigue sin poder subirse nada. Confirmar con quien reportó si esperaba poder hacerlo.
- Confirmar que ocultar Reemplazar en documentos firmados es lo que se quiere.

## Pendiente

- Prueba manual en dev.
- Captura `ficha.png` del manual.
- Definir en el backend qué cambios admite un documento firmado.
- El estado DS 44 de la ficha considera documentos de todas las obras, no solo de la que está en vista.
- Guardar una plantilla de obra no asigna el documento a quien ya está en la obra.
- Alinear el permiso de Evidencias con vigencia entre frontend y backend.
- El botón Subir del equipo de obra (`useObraOnboarding.ts`) tiene el mismo fallo sin aviso; conviene una función compartida con la ficha.

## Seguir en otro equipo

```bash
git clone https://github.com/Mrnooqmal/Hackaton_CCHC.git
cd Hackaton_CCHC
git switch fix/subir-documentos-ficha-persona
cd Frontend && npm ci
./node_modules/.bin/playwright install chromium
npm run test:e2e -- ficha-subir
```

- `Frontend/.env` no está en el repositorio: copiarlo aparte para levantar la aplicación contra dev.
- En el equipo original las pruebas se corrieron con una configuración temporal y otro Chromium; `npm run test:e2e` con la configuración del repositorio no se ha ejecutado.
