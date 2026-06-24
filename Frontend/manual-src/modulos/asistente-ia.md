# Módulo: Asistente IA

**Ubicación:** `Frontend/src/pages/AIAssistant.tsx` · `Backend/handlers/ai-assistant/` · `lib/ai/`

Chatbot inteligente para consultas de seguridad y generación asistida de matrices de
riesgo, con contexto de la normativa chilena.

## Modelo y proveedores

- **Modelo principal:** Claude 3 Sonnet (Anthropic) vía **AWS Bedrock**.
- **Proveedor alternativo:** Google Gemini API.
- Contexto especializado en seguridad laboral chilena y DS 44.

## Capacidades

| Capacidad | Descripción |
| --- | --- |
| Generación de MIPER / MIPPER | Propone peligros, riesgos y medidas de control por cargo |
| Consultas normativas | Responde sobre el DS 44 y normativa SST vigente |
| Procedimientos de emergencia | Orientación ante situaciones críticas |
| Recomendaciones de EPP | Sugiere EPP según el cargo y sus riesgos |
| Análisis de riesgos | Apoyo en la identificación y evaluación de peligros |

## Generación de matrices de riesgo

El caso de uso estrella es la **generación asistida de la MIPPER**:

```
1. El prevencionista indica el cargo y la actividad
        ↓
2. El asistente propone peligros, riesgos y medidas de control
        ↓
3. El prevencionista revisa, ajusta y completa la matriz
        ↓
4. La MIPPER se guarda como documento DS 44 y se firma
```

::: tip El humano siempre valida
La IA **propone**, pero la responsabilidad técnica y legal recae en el prevencionista,
que revisa, corrige y firma la matriz final. La generación asistida acelera el trabajo,
no lo reemplaza.
:::

## Disponibilidad por plan

El Asistente IA puede estar habilitado o no según `tenant.settings.modulosActivos`. Es
habitual que se ofrezca en planes *professional* y *enterprise*. Ver
[Tenants](/modulos/tenants).

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/ai-assistant/chat` | Enviar mensaje al asistente |
