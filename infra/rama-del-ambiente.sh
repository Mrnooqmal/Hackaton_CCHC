exigir_rama_del_ambiente() {
    local raiz="$1" sha="$2" ambiente="$3" rama
    case "$ambiente" in
        dev) rama=pruebas ;;
        prod) rama=main ;;
        *) echo "Ambiente desconocido: $ambiente (dev o prod)." >&2; exit 1 ;;
    esac
    git -C "$raiz" rev-parse --verify --quiet "origin/$rama" >/dev/null || {
        echo "No existe origin/$rama: haz git fetch origin, o revisa el remoto." >&2; exit 1; }
    git -C "$raiz" merge-base --is-ancestor "$sha" "origin/$rama" || {
        echo "El commit $sha no está en origin/$rama: $ambiente se despliega solo desde $rama (docs/flujo-de-trabajo.md)." >&2; exit 1; }
}
