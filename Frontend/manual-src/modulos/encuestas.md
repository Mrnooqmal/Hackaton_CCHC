# Módulo: Encuestas

**Ubicación:** `Frontend/src/pages/Surveys.tsx` · `Backend/handlers/surveys/`

Sistema de encuestas y evaluaciones para trabajadores. Permite levantar información de
salud, clima de seguridad y evaluaciones de conocimiento, con lógica condicional.

## Creación de encuestas

Constructor de preguntas con distintos tipos:

| Tipo de pregunta | Uso |
| --- | --- |
| Opción múltiple | Selección entre alternativas |
| Texto libre | Respuesta abierta |
| Escala numérica | Valoración (ej. 1 a 5) |
| Sí / No | Respuesta binaria |

Soporta **lógica condicional (skip logic)**: ciertas preguntas se muestran solo según
respuestas anteriores.

## Distribución

- Asignación a trabajadores específicos.
- Asignación por rol o área.
- Programación de envío.

Las asignaciones se registran con `personaId` (identidad unificada). Ver
[Personas](/modulos/personas).

## Relación con el DS 44

Las encuestas alimentan documentos como la `ENCUESTA_SALUD` (declaración de salud al
ingreso), un insumo relevante para la evaluación de riesgos por cargo y la
[MIPPER](/ds44/documentos-obligatorios).

## Estructura

```
surveyId      UUID
tenantId      FK
obraId        FK
preguntas     Lista de preguntas con tipo y lógica condicional
asignaciones  [{ personaId, estado }]
resultados    Respuestas agregadas
```

## Resultados

Los resultados se agregan para análisis: distribución de respuestas, tasa de
participación y resultados por área o cargo.

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/surveys` | Crear encuesta |
| `GET` | `/surveys` | Listar encuestas |
| `GET` | `/surveys/{id}` | Obtener encuesta |
| `POST` | `/surveys/{id}/respond` | Responder encuesta |
| `GET` | `/surveys/{id}/results` | Obtener resultados |
