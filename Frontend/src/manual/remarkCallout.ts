// Soporte para los contenedores de VitePress (::: warning / tip / info …).
//
// Dos piezas:
//  1) `normalizeVitepressContainers`: preprocesa el texto markdown para convertir
//     la sintaxis de VitePress `::: warning Título` (con espacio) a la de
//     remark-directive `:::warning[Título]`, que sí se parsea de forma estándar.
//  2) `remarkCalloutData`: plugin remark que marca los `containerDirective` para
//     que react-markdown los renderice como <div class="callout callout-{tipo}">
//     con el título en data-callout-title (mapeado luego al componente <Callout>).

const TIPOS = ['warning', 'tip', 'info', 'danger', 'note', 'details'];

/** `::: warning Mi título` → `:::warning[Mi título]` ; `::: tip` → `:::tip`. */
export function normalizeVitepressContainers(md: string): string {
    const abre = new RegExp(`^:::\\s+(${TIPOS.join('|')})(?:\\s+(.*\\S))?\\s*$`, 'gm');
    return md.replace(abre, (_m, tipo: string, titulo?: string) =>
        titulo ? `:::${tipo}[${titulo}]` : `:::${tipo}`,
    );
}

interface UnistNode {
    type: string;
    name?: string;
    data?: Record<string, unknown>;
    children?: UnistNode[];
}

function visit(node: UnistNode, fn: (n: UnistNode) => void): void {
    fn(node);
    if (node.children) for (const child of node.children) visit(child, fn);
}

/** Convierte los containerDirective en <div class="callout callout-{name}">. */
export function remarkCalloutData() {
    return (tree: UnistNode) => {
        visit(tree, (node) => {
            if (node.type !== 'containerDirective') return;
            const name = node.name && TIPOS.includes(node.name) ? node.name : 'info';

            // La etiqueta (título) es el primer hijo con data.directiveLabel.
            let titulo = '';
            const hijos = node.children ?? [];
            if (hijos.length && hijos[0].data && (hijos[0].data as { directiveLabel?: boolean }).directiveLabel) {
                const label = hijos.shift() as UnistNode;
                const textos = (label.children ?? []) as Array<{ value?: string }>;
                titulo = textos.map((c) => c.value ?? '').join('');
                node.children = hijos;
            }

            const data = node.data ?? (node.data = {});
            data.hName = 'div';
            data.hProperties = {
                className: `callout callout-${name}`,
                'data-callout-title': titulo,
            };
        });
    };
}
