import { useState } from 'react';
import { FiChevronUp, FiChevronDown } from 'react-icons/fi';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  width?: string;
  align?: 'left' | 'right' | 'center';
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  loading?: boolean;
}

export default function DataTable<T>({ columns, rows, rowKey, onRowClick, emptyState, loading }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (col: DataTableColumn<T>) => {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  };

  const sorted = (() => {
    if (!sortKey) return rows;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  })();

  if (loading) {
    return (
      <div className="ui-datatable-wrap">
        <table className="ui-datatable" aria-label="Cargando datos">
          <thead>
            <tr>{columns.map(c => <th key={c.key} style={{ width: c.width }}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="ui-datatable-skeleton-row">
                {columns.map(c => (
                  <td key={c.key} className={c.hideOnMobile ? 'ui-datatable-hide-mobile' : ''}>
                    <div className="ui-datatable-skeleton-cell" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <SkeletonStyle />
      </div>
    );
  }

  if (!loading && rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="ui-datatable-wrap">
      <table className="ui-datatable">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align ?? 'left' }}
                className={[
                  col.sortable ? 'sortable' : '',
                  col.hideOnMobile ? 'ui-datatable-hide-mobile' : '',
                  sortKey === col.key ? 'sorted' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleSort(col)}
                aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                <span className="ui-datatable-th-inner">
                  {col.header}
                  {col.sortable && (
                    <span className="ui-datatable-sort-icon" aria-hidden="true">
                      {sortKey === col.key
                        ? (sortDir === 'asc' ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />)
                        : <FiChevronDown size={13} style={{ opacity: 0.3 }} />}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'clickable' : ''}
              onClick={() => onRowClick?.(row)}
              onKeyDown={e => { if (onRowClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(row); } }}
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  style={{ textAlign: col.align ?? 'left' }}
                  className={col.hideOnMobile ? 'ui-datatable-hide-mobile' : ''}
                  data-label={col.header}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`
        .ui-datatable-wrap { width: 100%; overflow-x: auto; }
        .ui-datatable {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--text-sm);
        }
        .ui-datatable thead th {
          padding: var(--space-2) var(--space-3);
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-muted);
          border-bottom: 1px solid var(--surface-border);
          white-space: nowrap;
          background: var(--surface-card);
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .ui-datatable thead th.sortable { cursor: pointer; user-select: none; }
        .ui-datatable thead th.sortable:hover { color: var(--text-primary); }
        .ui-datatable thead th.sorted { color: var(--accent-text); }
        .ui-datatable-th-inner {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
        }
        .ui-datatable-sort-icon { display: inline-flex; align-items: center; }
        .ui-datatable tbody tr {
          border-bottom: 1px solid var(--surface-border);
          transition: background var(--transition-fast);
        }
        .ui-datatable tbody tr:last-child { border-bottom: none; }
        .ui-datatable tbody tr.clickable { cursor: pointer; }
        .ui-datatable tbody tr.clickable:hover { background: var(--surface-hover); }
        .ui-datatable tbody tr.clickable:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .ui-datatable tbody td {
          padding: var(--space-3) var(--space-3);
          color: var(--text-primary);
          vertical-align: middle;
        }
        .ui-datatable-skeleton-row td { padding: var(--space-3); }
        .ui-datatable-skeleton-cell {
          height: 14px;
          border-radius: var(--radius-sm);
          background: var(--surface-hover);
          animation: ui-skeleton-pulse 1.4s ease-in-out infinite;
        }
        @keyframes ui-skeleton-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (max-width: 640px) {
          .ui-datatable thead { display: none; }
          .ui-datatable tbody tr {
            display: block;
            padding: var(--space-3) var(--space-4);
            border: 1px solid var(--surface-border);
            border-radius: var(--radius-md);
            margin-bottom: var(--space-2);
          }
          .ui-datatable tbody td {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-1) 0;
            border: none;
          }
          .ui-datatable tbody td::before {
            content: attr(data-label);
            font-size: var(--text-xs);
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.04em;
            flex-shrink: 0;
            margin-right: var(--space-3);
          }
          .ui-datatable-hide-mobile { display: none; }
        }
      `}</style>
      <SkeletonStyle />
    </div>
  );
}

function SkeletonStyle() {
  return null;
}
