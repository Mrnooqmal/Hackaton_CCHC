# Pruebas manuales de la sesión en cookie

Para el equipo, en `https://dev.buildandserve.cl`, con la versión candidata a prod (`sesion-cookie`). Cada persona vuelve a entrar una vez: la sesión anterior, guardada en el navegador, deja de servir.

Cada caso se hace en tres lugares, porque las cookies se comportan distinto en cada uno:

1. Chrome en Android.
2. Safari en iPhone.
3. La app instalada en la pantalla de inicio del iPhone (Compartir → Agregar a inicio). En iOS guarda sus cookies aparte del Safari normal: entrar en Safari no deja la sesión abierta en la app instalada, y al revés.

| # | Caso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar con RUT y contraseña | Entra. Si la persona está en varias empresas, elige una y entra a esa. |
| 2 | Recargar la página | Sigue dentro, sin volver a pedir la contraseña. |
| 3 | Cerrar la app (o la pestaña) y volver a abrirla | Sigue dentro mientras la sesión esté vigente (6 horas desde que entró). |
| 4 | Volver al día siguiente | Pide entrar de nuevo: la sesión venció. |
| 5 | Cerrar sesión con señal | Vuelve al ingreso. Al recargar no queda dentro. |
| 6 | Cerrar sesión en modo avión | Vuelve al ingreso igual. Al recuperar la señal, la sesión se cierra también en el servidor (sin hacer nada). |
| 7 | Cerrar sesión en modo avión y recuperar la señal después de 6 horas | Lo mismo que el 6: no aparece ningún error. |
| 8 | Firmar sin señal y volver a tener señal | Las firmas se envían solas, como antes. |
| 9 | Vales y cola de firmas al cerrar sesión | «Cerrar sesión» sigue avisando si hay firmas por enviar. Las firmas no se pierden. |
| 10 | Activación en terreno | La persona entra con la temporal de 2 horas, elige su contraseña y sigue dentro sin volver a entrar. |
| 11 | Enlace de activación por correo | El enlace abre `dev.buildandserve.cl`, la persona elige su contraseña y entra. |
| 12 | Cambiar de empresa (persona en varias empresas) | Al salir y entrar a la otra, ve solo los datos de esa empresa. |
| 13 | Descargas | La plantilla de carga masiva, el expediente de una obra y el reporte del FUF se descargan. |
| 14 | La URL vieja | `https://d3pve67iu4s0dd.cloudfront.net/...` lleva a la misma página en `dev.buildandserve.cl`. |

Si algo falla, anotar: el caso, el lugar (1, 2 o 3), la hora y una captura.
