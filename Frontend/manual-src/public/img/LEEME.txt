# Imágenes del manual

Las capturas de pantalla del manual van en esta carpeta, organizadas por módulo:

```
public/img/
├── obras/
├── documentos/
├── firmas/
├── incidentes/
├── actividades/
├── encuestas/
├── asistente-ia/
├── personas/
├── bandeja-entrada/
├── tenants/
├── dashboard/
└── guia-inicio/
```

## Cómo agregar una captura

1. Toma la captura de pantalla de la interfaz real.
2. Guárdala en la subcarpeta del módulo correspondiente, con el **mismo nombre de archivo**
   que ya está referenciado en el `.md` (por ejemplo `obras/listado.png`).
3. Listo: al recompilar el manual la imagen aparece automáticamente.

> Los archivos `.md` ya tienen los marcadores `![pie de foto](/img/...)` ubicados en el
> punto exacto donde debe ir cada imagen. Solo necesitas reemplazar/crear el archivo de
> imagen en la ruta indicada. Mientras no exista el archivo, el manual mostrará el texto
> alternativo (el pie de foto) en lugar de la imagen.

**Formato recomendado:** PNG, ancho ~1200–1600 px. Evita incluir datos sensibles reales en
las capturas (usa datos de ejemplo cuando sea posible).
