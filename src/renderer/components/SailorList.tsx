import React, { useState, useEffect, useMemo } from 'react';
import Flag from 'react-world-flags';
import { getFlagCode } from '../utils/leaderboardUtils';
import { toSubgroupLabel } from '../../shared/subgroups';
import {
  confirmAction,
  reportError,
  reportInfo,
  reportWarning,
} from '../utils/userFeedback';
import { sailorDB } from '../api/db';
import LoadingState from './shared/LoadingState';
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

/** The fields a row edit can change; compared to find unsaved changes. */
const EDITABLE_FIELDS = [
  'country',
  'sail_number',
  'model',
  'name',
  'surname',
  'club',
  'category',
] as const;

interface EditedSailor {
  boat_id?: number;
  country?: string;
  sail_number?: number | string;
  model?: string;
  name?: string;
  surname?: string;
  club?: string;
  category?: string;
  originalName?: string;
  originalSurname?: string;
  originalClubName?: string;
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
  const [editedSailor, setEditedSailor] = useState<EditedSailor>({});
  const [isExpanded, setIsExpanded] = useState(readExpanded);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

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

  // Whether the open row edit differs from the saved sailor: only then is
  // leaving it a loss worth asking about.
  const hasUnsavedEdit = (): boolean => {
    if (editingSailorId == null) return false;
    const saved = sailors.find((row) => row.boat_id === editingSailorId);
    if (!saved) return false;
    return EDITABLE_FIELDS.some(
      (field) =>
        String(editedSailor[field] ?? '') !== String(saved[field] ?? ''),
    );
  };

  const handleEditClick = async (sailor: SailorListSailor) => {
    // Opening another row would throw away what was typed in this one.
    if (
      editingSailorId != null &&
      editingSailorId !== sailor.boat_id &&
      hasUnsavedEdit()
    ) {
      const discard = await confirmAction(
        'You changed this sailor and have not saved. Discard the changes and edit the other sailor instead?',
        'Discard unsaved changes',
        {
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
          confirmClassName: 'btn-danger',
        },
      );
      if (!discard) return;
    }
    setEditingSailorId(sailor.boat_id);
    setEditedSailor({
      ...sailor,
      originalName: sailor.name,
      originalSurname: sailor.surname,
      originalClubName: sailor.club,
    });
  };

  // Back out of an in-progress edit without saving — the row reverts to its
  // last-saved values instead of trapping the user into Save-or-lose-elsewhere.
  const handleCancelEdit = () => {
    setEditingSailorId(null);
    setEditedSailor({});
  };

  const handleSave = async () => {
    // Prevent a second save while the update round-trip is still in flight.
    if (savingEdit) return;

    // The same rule as the add form: no empty names, sail number or club (an
    // edit used to be able to blank them), and stray spaces are not kept.
    const text = (value: unknown): string => String(value ?? '').trim();
    const name = text(editedSailor.name);
    const surname = text(editedSailor.surname);
    const sailNumber = text(editedSailor.sail_number);
    const club = text(editedSailor.club);
    if (!name || !surname || !sailNumber || !club) {
      reportWarning(
        'First name, surname, sail number and club cannot be empty. Nothing was saved.',
        'Missing information',
      );
      return;
    }

    setSavingEdit(true);
    try {
      const sailorData = {
        originalName: editedSailor.originalName,
        originalSurname: editedSailor.originalSurname,
        name,
        surname,
        category_name: editedSailor.category,
        club_name: club,
        originalClubName: editedSailor.originalClubName,
        boat_id: editedSailor.boat_id,
        sail_number: sailNumber,
        country: editedSailor.country,
        model: text(editedSailor.model),
      };

      const result = await sailorDB.updateSailor(sailorData);

      if (!result) {
        reportError('Could not save sailor changes.');
        return;
      }

      setEditingSailorId(null);
      setEditedSailor({});
      onRefreshSailors();
      reportInfo('Sailor details saved successfully.', 'Saved');
    } catch (error) {
      reportError('Could not save sailor changes.', error);
    } finally {
      setSavingEdit(false);
    }
  };

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

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setEditedSailor((prev) => ({ ...prev, [name]: value }));
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
              <tr key={`${sailor.boat_id}-${sailor.sail_number}`}>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="country"
                      value={editedSailor.country}
                      onChange={handleInputChange}
                      className="editable-input"
                    />
                  ) : (
                    <div>
                      <Flag
                        code={getFlagCode(sailor.country)}
                        style={{ width: '30px', marginRight: '5px' }}
                      />
                      <span>{sailor.country}</span>
                    </div>
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="sail_number"
                      value={editedSailor.sail_number}
                      onChange={handleInputChange}
                      className="editable-input"
                      aria-label="Sail number"
                    />
                  ) : (
                    sailor.sail_number
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="model"
                      value={editedSailor.model}
                      onChange={handleInputChange}
                      className="editable-input"
                      aria-label="Boat model"
                    />
                  ) : (
                    sailor.model
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <>
                      <input
                        type="text"
                        name="name"
                        value={editedSailor.name}
                        onChange={handleInputChange}
                        className="editable-input"
                        placeholder="First name"
                        aria-label="First name"
                      />
                      <input
                        type="text"
                        name="surname"
                        value={editedSailor.surname}
                        onChange={handleInputChange}
                        className="editable-input"
                        placeholder="Surname"
                        aria-label="Surname"
                      />
                    </>
                  ) : (
                    sailorFullName(sailor)
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="club"
                      value={editedSailor.club}
                      onChange={handleInputChange}
                      className="editable-input"
                      aria-label="Club"
                    />
                  ) : (
                    sailor.club
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <select
                      name="category"
                      value={editedSailor.category}
                      onChange={handleInputChange}
                      className="editable-input"
                      aria-label="Subgroup"
                    >
                      {categories.map((category) => (
                        <option
                          key={category.category_id}
                          value={category.category_name}
                        >
                          {toSubgroupLabel(category.category_name) ||
                            category.category_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    toSubgroupLabel(sailor.category) || sailor.category
                  )}
                </td>
                <td>
                  <div className="icon-container">
                    {editingSailorId === sailor.boat_id ? (
                      <>
                        <button
                          type="button"
                          className="icon-action-btn"
                          aria-label={`Save changes for ${sailorFullName(sailor)}`}
                          title="Save changes"
                          onClick={handleSave}
                          disabled={savingEdit}
                        >
                          <i
                            className={
                              savingEdit
                                ? 'fa fa-spinner fa-spin'
                                : 'fa fa-save'
                            }
                            aria-hidden="true"
                            style={{ color: 'var(--teal)' }}
                          />
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn"
                          aria-label={`Cancel editing ${sailorFullName(sailor)}`}
                          title="Cancel editing"
                          onClick={handleCancelEdit}
                          disabled={savingEdit}
                        >
                          <i
                            className="fa fa-xmark"
                            aria-hidden="true"
                            style={{ color: 'var(--text-secondary)' }}
                          />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="icon-action-btn"
                        aria-label={`Edit ${sailorFullName(sailor)}`}
                        title="Edit sailor and boat"
                        onClick={() => handleEditClick(sailor)}
                      >
                        <i
                          className="fa fa-pencil"
                          aria-hidden="true"
                          style={{ color: 'var(--ocean)' }}
                        />
                      </button>
                    )}
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
    </div>
  );
}

export default SailorList;
