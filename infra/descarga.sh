# Descarga que retoma donde se cortó. La usan las verificaciones de
# desplegar-backend.sh y desplegar-frontend.sh: el 10 de noviembre de 2026 el
# paquete de 41 MB de la Lambda se cortó dos veces desde una conexión lenta, y el
# despliegue quedó sin verificar aunque había salido bien.
#
#   descargar_reanudable <salida> <bytes esperados> <comando que imprime la URL> [args…]
#
# - Cada intento pide la URL de nuevo: la de la Lambda es prefirmada y vence.
# - Sigue desde los bytes que ya tiene (`curl -C -`, petición con Range).
# - Termina bien solo con el tamaño esperado exacto. Quien llama comprueba además
#   el contenido (la huella o la comparación con el original): un tramo mal
#   pegado no pasa.
# - Hasta DESCARGA_INTENTOS intentos (20) de DESCARGA_TIEMPO segundos (300) cada
#   uno: nunca se queda colgada para siempre.

descargar_reanudable() {
    local salida="$1" esperado="$2"; shift 2
    local intentos="${DESCARGA_INTENTOS:-20}" tiempo="${DESCARGA_TIEMPO:-300}" i n url
    for ((i = 1; i <= intentos; i++)); do
        n="$(stat -c %s "$salida" 2>/dev/null || echo -1)"
        [ "$n" -eq "$esperado" ] && return 0
        # Más de lo esperado no se arregla reanudando: se empieza de cero.
        [ "$n" -gt "$esperado" ] && rm -f "$salida"
        url="$("$@")" || { echo "No se pudo obtener la URL de descarga." >&2; return 1; }
        curl -fsS -C - --connect-timeout 30 --max-time "$tiempo" -o "$salida" "$url" 2>/dev/null || true
    done
    n="$(stat -c %s "$salida" 2>/dev/null || echo -1)"
    [ "$n" -eq "$esperado" ] && return 0
    echo "La descarga no se completó en $intentos intentos ($n de $esperado bytes)." >&2
    return 1
}
