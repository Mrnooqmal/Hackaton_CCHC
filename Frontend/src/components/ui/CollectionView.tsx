import { FiList, FiGrid } from 'react-icons/fi';
import SearchInput from './SearchInput';

export type CollectionMode = 'list' | 'grid';

export interface CollectionViewProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  sort?: React.ReactNode;
  mode: CollectionMode;
  onModeChange: (m: CollectionMode) => void;
  count?: number;
  list: React.ReactNode;
  grid: React.ReactNode;
  actions?: React.ReactNode;
}

export default function CollectionView({
  searchValue, onSearchChange, searchPlaceholder,
  filters, sort, mode, onModeChange,
  count, list, grid, actions,
}: CollectionViewProps) {
  return (
    <div className="ui-collection">
      <div className="ui-collection-toolbar">
        <div className="ui-collection-toolbar-left">
          <SearchInput
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder ?? 'Buscar…'}
          />
          {filters && <div className="ui-collection-filters">{filters}</div>}
          {sort && <div className="ui-collection-sort">{sort}</div>}
          {count !== undefined && (
            <span className="ui-collection-count">{count} elemento{count !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="ui-collection-toolbar-right">
          <div className="ui-collection-mode-toggle" role="group" aria-label="Vista">
            <button
              className={`ui-collection-mode-btn${mode === 'list' ? ' active' : ''}`}
              onClick={() => onModeChange('list')}
              aria-pressed={mode === 'list'}
              aria-label="Vista lista"
              title="Lista"
            >
              <FiList size={16} />
            </button>
            <button
              className={`ui-collection-mode-btn${mode === 'grid' ? ' active' : ''}`}
              onClick={() => onModeChange('grid')}
              aria-pressed={mode === 'grid'}
              aria-label="Vista grilla"
              title="Grilla"
            >
              <FiGrid size={16} />
            </button>
          </div>
          {actions && <div className="ui-collection-actions">{actions}</div>}
        </div>
      </div>
      <div className="ui-collection-body">
        {mode === 'list' ? list : grid}
      </div>
      <style>{`
        .ui-collection { display: flex; flex-direction: column; gap: var(--space-4); }
        .ui-collection-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          flex-wrap: wrap;
        }
        .ui-collection-toolbar-left {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
          flex: 1;
          min-width: 0;
        }
        .ui-collection-toolbar-right {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-shrink: 0;
        }
        .ui-collection-filters, .ui-collection-sort {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }
        .ui-collection-count {
          font-size: var(--text-xs);
          color: var(--text-muted);
          white-space: nowrap;
          padding-left: var(--space-1);
        }
        .ui-collection-mode-toggle {
          display: flex;
          border: 1px solid var(--surface-border);
          border-radius: var(--radius-sm);
          overflow: hidden;
        }
        .ui-collection-mode-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: none;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .ui-collection-mode-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
        .ui-collection-mode-btn.active { background: var(--accent-tint); color: var(--accent); }
        .ui-collection-actions { display: flex; gap: var(--space-2); }
        .ui-collection-body { min-height: 200px; }
        @media (max-width: 640px) {
          .ui-collection-toolbar { flex-direction: column; align-items: stretch; }
          .ui-collection-toolbar-right { justify-content: flex-end; }
        }
      `}</style>
    </div>
  );
}
