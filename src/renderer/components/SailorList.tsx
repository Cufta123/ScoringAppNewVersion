import React, { useState, useEffect, useMemo } from 'react';
import Flag from 'react-world-flags';
import { getFlagCode } from '../utils/leaderboardUtils';
import { toSubgroupLabel } from '../../shared/subgroups';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';
import { sailorDB } from '../api/db';
import LoadingState from './shared/LoadingState';
import SailorEditDialog from './SailorEditDialog';
import type { CategoryRow } from '../types';
import { sailorFullName } from '../utils/sailorName';

const EXPANDED_STORAGE_KEY = 'sailorListExpanded';

// Numeric-aware, case-insensitive comparison so "Sail №" sorts 9, 10, 100
// (sail numbers are stored as TEXT) instead of lexicographically.
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

// The collapsed state is a per-viewer convenience: storage can be missing,
// blocked or hold something else, and none of that may break the list.
const readExpanded = (): boolean => {
  try {
    const saved = localStorage.getItem(EXPANDED_STORAGE_KEY);
    return saved === null ? true : JSON.parse(saved) !== false;
  } catch (_error) {
    return true;
  }
};

const writeExpanded = (expanded: boolean): void => {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(expanded));
  } catch (_error) {
    // Not remembered; the list still works.
  }
};

type SortDirection = 'asc' | 'desc';

interface SortThProps {
  col: string;
  label: string;
  sortCriteria: string;
  sortDirection: SortDirection;
  onSort: (col: string) => void;
}

function SortTh({
  col,
  label,
  sortCriteria,
  sortDirection,
  onSort,
}: SortThProps) {
  return (
    <th scope="col" className="sortable" onClick={() => onSort(col)}>
      {label}{' '}
      {sortCriteria === col ? (
        <i
          className={`fa fa-sort-${sortDirection === 'asc' ? 'up' : 'down'}`}
        />
      ) : (
        <i className="fa fa-sort" style={{ opacity: 0.25 }} />
      )}
    </th>
  );
}

/** A boat+sailor row as assembled by EventPage and rendered in this list. */
export interface SailorListSailor {
  boat_id: number;
  country: string;
  sail_number: number | string;
  model: string;
  name: string;
  surname: string;
  club: string;
  category: string;
  [key: string]: unknown;
}

interface SailorListProps {
  sailors: SailorListSailor[];
  /** Resolves true when the boat was removed (false/void: it was not). */
  onRemoveBoat: (boatId: number) => boolean | void | Promise<boolean | void>;
  /** False once a race is scored: the entry list is fixed (WTH instead). */
  canRemove?: boolean;
  onRefreshSailors: () => void;
  headerActions?: React.ReactNode;
  /** True while the parent is still fetching boats — distinguishes "loading"
   * from a genuinely empty list so we don't flash "No sailors registered". */
  loading?: boolean;
}

function SailorList({
  sailors,
  onRemoveBoat,
  canRemove = true,
  onRefreshSailors,
  headerActions = null,
  loading = false,
}: SailorListProps) {
  const [sortCriteria, setSortCriteria] = useState('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editingSailorId, setEditingSailorId] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(readExpanded);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const handleSort = (col: string) => {
    if (col === sortCriteria) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCriteria(col);
      setSortDirection('asc');
    }
  };

  // Subgroup is displayed via its label, so sort by the label the user sees
  // rather than the raw stored category code.
  const sortedSailors = useMemo(() => {
    const sortValue = (sailor: SailorListSailor): unknown =>
      sortCriteria === 'category'
        ? toSubgroupLabel(sailor.category) || sailor.category || ''
        : sailor[sortCriteria];
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...sailors].sort(
      (a, b) =>
        collator.compare(
          String(sortValue(a) ?? ''),
          String(sortValue(b) ?? ''),
        ) * dir,
    );
  }, [sailors, sortCriteria, sortDirection]);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const result = await sailorDB.readAllCategories();
        if (result) {
          setCategories(result);
        } else {
          reportError('Could not load the category list.');
        }
      } catch (error) {
        reportError(
          'Could not load the category list, so categories cannot be changed here until the page is reloaded.',
          error,
        );
      }
    };

    fetchCategories();
  }, []);

  // Always the boat as saved now, so a refresh while the dialog is open
  // (another window, an import) cannot leave it editing a stale copy.
  const editingSailor =
    editingSailorId == null
      ? null
      : (sailors.find((row) => row.boat_id === editingSailorId) ?? null);

  const handleRemoveWithConfirm = async (sailor: SailorListSailor) => {
    const confirmed = await confirmAction(
      `Remove boat ${sailor.sail_number} (${sailorFullName(sailor)}) from this event?`,
      'Remove boat',
      { confirmLabel: 'Remove boat', confirmClassName: 'btn-danger' },
    );

    if (!confirmed) return;

    // Only confirm what happened: the parent refuses after a race is scored
    // and reports a failure itself.
    const removed = await onRemoveBoat(sailor.boat_id);
    if (removed === true) reportInfo('Boat removed from event.', 'Removed');
  };

  const toggleExpand = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    writeExpanded(next);
  };

  return (
    <div>
      <div className="sailor-list-header">
        <h2>
          <i className="fa fa-users" aria-hidden="true" />
          Registered Boats &amp; Sailors
        </h2>
        <div className="list-header-actions">
          {headerActions}
          <button type="button" className="btn-ghost" onClick={toggleExpand}>
            <i
              className={`fa fa-chevron-${isExpanded ? 'up' : 'down'}`}
              aria-hidden="true"
            />
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {isExpanded && sailors.length === 0 && loading && (
        <LoadingState label="Loading boats…" />
      )}
      {isExpanded && sailors.length === 0 && !loading && (
        <div className="info-banner">
          <i
            className="fa fa-info-circle"
            aria-hidden="true"
            style={{ marginRight: '8px' }}
          />
          No sailors registered yet. Use <strong>Add Sailors</strong> above to
          add them one by one, or import a whole list from a CSV file.
        </div>
      )}
      {isExpanded && sailors.length > 0 && (
        <table>
          <thead>
            <tr>
              <SortTh
                col="country"
                label="Country"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="sail_number"
                label="Sail №"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="model"
                label="Model"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="name"
                label="Skipper"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="club"
                label="Club"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="category"
                label="Subgroup"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedSailors.map((sailor) => (
              <tr
                key={`${sailor.boat_id}-${sailor.sail_number}`}
                className={
                  editingSailorId === sailor.boat_id ? 'row-editing' : undefined
                }
              >
                <td>
                  <div>
                    <Flag
                      code={getFlagCode(sailor.country)}
                      style={{ width: '30px', marginRight: '5px' }}
                    />
                    <span>{sailor.country}</span>
                  </div>
                </td>
                <td>{sailor.sail_number}</td>
                <td>{sailor.model}</td>
                <td>{sailorFullName(sailor)}</td>
                <td>{sailor.club}</td>
                <td>{toSubgroupLabel(sailor.category) || sailor.category}</td>
                <td>
                  <div className="icon-container">
                    <button
                      type="button"
                      className="icon-action-btn"
                      aria-label={`Edit ${sailorFullName(sailor)}`}
                      title="Edit sailor and boat"
                      onClick={() => setEditingSailorId(sailor.boat_id)}
                    >
                      <i
                        className="fa fa-pencil"
                        aria-hidden="true"
                        style={{ color: 'var(--ocean)' }}
                      />
                    </button>
                    {canRemove && (
                      <button
                        type="button"
                        className="icon-action-btn"
                        aria-label={`Remove boat ${sailor.sail_number} from event`}
                        title="Remove boat from event"
                        onClick={() => handleRemoveWithConfirm(sailor)}
                      >
                        <i
                          className="fa fa-trash"
                          aria-hidden="true"
                          style={{ color: 'var(--danger)' }}
                        />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editingSailor && (
        <SailorEditDialog
          key={editingSailor.boat_id}
          sailor={editingSailor}
          eventSailors={sailors}
          categories={categories}
          onClose={() => setEditingSailorId(null)}
          onSaved={onRefreshSailors}
        />
      )}
    </div>
  );
}

export default SailorList;
