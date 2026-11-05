import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Flag from 'react-world-flags';
import useDialogFocus from '../hooks/useDialogFocus';
import IOC_NATIONS from '../constants/iocNations';
import { getFlagCode } from '../utils/leaderboardUtils';
import { SUBGROUP_OPTIONS, toSubgroupLabel } from '../../shared/subgroups';
import { sailorDB } from '../api/db';
import { queries } from '../api/queries';
import { useWrite } from '../api/writes';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';
import { sailorFullName } from '../utils/sailorName';
import type { CategoryRow } from '../types';
import type { SailorListSailor } from './SailorList';

/** The fields the dialog edits, as typed (untrimmed). */
interface Draft {
  name: string;
  surname: string;
  club: string;
  category: string;
  sail_number: string;
  country: string;
  model: string;
}

type FieldErrors = Partial<Record<keyof Draft, string>>;

const draftOf = (sailor: SailorListSailor): Draft => ({
  name: String(sailor.name ?? ''),
  surname: String(sailor.surname ?? ''),
  club: String(sailor.club ?? ''),
  category: String(sailor.category ?? ''),
  sail_number: String(sailor.sail_number ?? ''),
  country: String(sailor.country ?? ''),
  model: String(sailor.model ?? ''),
});

/** The subgroup as the add form names it: "M — Masters (Veteran)". */
const subgroupLabel = (categoryName: string): string =>
  SUBGROUP_OPTIONS.find(
    (option) => option.categoryName === categoryName.toUpperCase(),
  )?.label ||
  toSubgroupLabel(categoryName) ||
  categoryName;

/** Subgroups in the add form's order; unknown ones after, as stored. */
const subgroupRank = (categoryName: string): number => {
  const at = SUBGROUP_OPTIONS.findIndex(
    (option) => option.categoryName === categoryName.toUpperCase(),
  );
  return at < 0 ? SUBGROUP_OPTIONS.length : at;
};

const FIELD_ORDER: (keyof Draft)[] = [
  'name',
  'surname',
  'club',
  'category',
  'sail_number',
  'country',
  'model',
];

const sameText = (a: unknown, b: unknown): boolean =>
  String(a ?? '')
    .trim()
    .toUpperCase() ===
  String(b ?? '')
    .trim()
    .toUpperCase();

function FieldError({
  field,
  message,
}: {
  field: string;
  message: string | undefined;
}) {
  if (!message) return null;
  return (
    <span className="sailor-edit-error" id={`se-${field}-error`} role="alert">
      {message}
    </span>
  );
}

interface TextFieldProps {
  field: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  optional?: boolean;
  list?: string;
  inputMode?: 'numeric' | 'text';
  inputRef?: React.RefObject<HTMLInputElement>;
}

/** A labelled text box with its problem, if any, right under it. */
function TextField({
  field,
  label,
  value,
  error,
  onChange,
  optional = false,
  list = undefined,
  inputMode = 'text',
  inputRef = undefined,
}: TextFieldProps) {
  const id = `se-${field}`;
  return (
    <div className="sailor-form-field">
      <label htmlFor={id}>
        {label}
        {optional && <span className="sailor-edit-optional"> (optional)</span>}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={field}
        type="text"
        autoComplete="off"
        inputMode={inputMode}
        list={list}
        value={value}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <FieldError field={field} message={error} />
    </div>
  );
}

interface SailorEditDialogProps {
  /** The boat being edited. Mount the dialog only while it is open. */
  sailor: SailorListSailor;
  /** Every boat in the event, to refuse a sail number already in use. */
  eventSailors: SailorListSailor[];
  categories: CategoryRow[];
  onClose: () => void;
}

/**
 * Edit one boat and its sailor in a proper form: labelled fields, the country
 * picked from the list with its flag, problems shown next to the field they
 * are about, and typed changes never dropped without asking.
 */
export default function SailorEditDialog({
  sailor,
  eventSailors,
  categories,
  onClose,
}: SailorEditDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  // The draft starts from the boat as saved when the dialog mounts; the
  // parent keys the dialog by boat, so another boat gets a fresh one.
  const [draft, setDraft] = useState<Draft>(() => draftOf(sailor));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  // Club names for the suggestions; the field still takes any new name, so a
  // failed read only leaves the suggestions out.
  const clubsQuery = useQuery(queries.clubs());
  const clubs = useMemo(() => clubsQuery.data ?? [], [clubsQuery.data]);
  // A sailor and her boat are shown in every event she sailed (one record
  // each, AGENTS.md section 10): everything is read again.
  const updateSailor = useWrite(
    (...args: Parameters<typeof sailorDB.updateSailor>) =>
      sailorDB.updateSailor(...args),
    'everything',
  );

  const dirty = useMemo(() => {
    const saved = draftOf(sailor);
    return FIELD_ORDER.some((field) => draft[field] !== saved[field]);
  }, [sailor, draft]);

  const requestClose = async () => {
    if (saving) return;
    if (
      dirty &&
      !(await confirmAction(
        'You changed this sailor and have not saved. Discard the changes?',
        'Discard unsaved changes',
        {
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
          confirmClassName: 'btn-danger',
        },
      ))
    ) {
      return;
    }
    onClose();
  };

  useDialogFocus(dialogRef, true, requestClose, firstFieldRef);

  const clubSuggestions = useMemo(() => {
    const { country } = draft;
    const names = new Set<string>();
    // Clubs of the boat's country first, then the rest.
    [...clubs]
      .sort(
        (a, b) =>
          Number(b.country === country) - Number(a.country === country) ||
          a.club_name.localeCompare(b.club_name),
      )
      .forEach((club) => {
        if (club.club_name) names.add(club.club_name);
      });
    return [...names];
  }, [clubs, draft]);

  const set =
    (field: keyof Draft) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      const { value } = event.target;
      setDraft((current) => ({ ...current, [field]: value }));
      setErrors((current) =>
        current[field] ? { ...current, [field]: undefined } : current,
      );
    };

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    const required: [keyof Draft, string][] = [
      ['name', 'Enter the first name.'],
      ['surname', 'Enter the surname.'],
      ['club', 'Enter the club.'],
      ['sail_number', 'Enter the sail number.'],
      ['country', 'Pick the country.'],
      ['category', 'Pick the subgroup.'],
    ];
    required.forEach(([field, message]) => {
      if (!draft[field].trim()) found[field] = message;
    });
    if (!found.sail_number && !found.country) {
      const clash = eventSailors.find(
        (other) =>
          other.boat_id !== sailor.boat_id &&
          sameText(other.sail_number, draft.sail_number) &&
          sameText(other.country, draft.country),
      );
      if (clash) {
        found.sail_number = `${draft.country.trim().toUpperCase()} ${draft.sail_number.trim()} is already sailed by ${sailorFullName(clash)} in this event.`;
      }
    }
    return found;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const found = validate();
    const firstBad = FIELD_ORDER.find((field) => found[field]);
    if (firstBad) {
      setErrors(found);
      dialogRef.current
        ?.querySelector<HTMLElement>(`[name="${firstBad}"]`)
        ?.focus();
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const country = draft.country.trim().toUpperCase();
      const result = await updateSailor({
        name: draft.name.trim(),
        surname: draft.surname.trim(),
        category_name: draft.category,
        club_name: draft.club.trim(),
        originalClubName: sailor.club,
        boat_id: sailor.boat_id,
        sail_number: draft.sail_number.trim(),
        country,
        model: draft.model.trim(),
      });
      if (!result) {
        reportError('Could not save sailor changes.');
        setSaving(false);
        return;
      }
      reportInfo('Sailor details saved.', 'Saved');
      setSaving(false);
      onClose();
    } catch (error) {
      setSaving(false);
      reportError('Could not save sailor changes.', error);
    }
  };

  const countryKnown = Boolean(IOC_NATIONS[draft.country]);
  const sortedCategories = [...categories].sort(
    (a, b) => subgroupRank(a.category_name) - subgroupRank(b.category_name),
  );
  const subgroupKnown = categories.some(
    (category) => category.category_name === draft.category,
  );

  const invalid = (field: keyof Draft) => (errors[field] ? true : undefined);
  const describedBy = (field: keyof Draft) =>
    errors[field] ? `se-${field}-error` : undefined;

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="feedback-modal sailor-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="se-title"
        tabIndex={-1}
      >
        <form onSubmit={handleSubmit} noValidate>
          <header className="sailor-edit-head">
            <div className="sailor-edit-identity">
              <Flag
                code={getFlagCode(sailor.country)}
                className="sailor-edit-flag"
                fallback={<span className="sailor-edit-flag" />}
              />
              <div>
                <h3 id="se-title" className="feedback-modal-title">
                  Edit sailor
                </h3>
                <p className="sailor-edit-sub">
                  {sailor.country} {sailor.sail_number} ·{' '}
                  {sailorFullName(sailor)}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="icon-action-btn"
              aria-label="Close"
              title="Close"
              onClick={requestClose}
              disabled={saving}
            >
              <i className="fa fa-xmark" aria-hidden="true" />
            </button>
          </header>

          <fieldset className="sailor-edit-section" disabled={saving}>
            <legend>
              <i className="fa fa-user" aria-hidden="true" /> Sailor
            </legend>
            <div className="sailor-edit-grid">
              <TextField
                field="name"
                label="First name"
                value={draft.name}
                error={errors.name}
                onChange={set('name')}
                inputRef={firstFieldRef}
              />
              <TextField
                field="surname"
                label="Surname"
                value={draft.surname}
                error={errors.surname}
                onChange={set('surname')}
              />
              <TextField
                field="club"
                label="Club"
                value={draft.club}
                error={errors.club}
                onChange={set('club')}
                list="se-club-list"
              />
              <datalist id="se-club-list">
                {clubSuggestions.map((name) => (
                  <option key={name} value={name} aria-label={name} />
                ))}
              </datalist>
              <div className="sailor-form-field">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- tied by htmlFor, as in SailorForm */}
                <label htmlFor="se-category">Subgroup</label>
                <select
                  id="se-category"
                  name="category"
                  value={draft.category}
                  onChange={set('category')}
                  aria-invalid={invalid('category')}
                  aria-describedby={describedBy('category')}
                >
                  {!subgroupKnown && (
                    <option value={draft.category} disabled={!draft.category}>
                      {draft.category
                        ? subgroupLabel(draft.category)
                        : 'Select subgroup…'}
                    </option>
                  )}
                  {sortedCategories.map((category) => (
                    <option
                      key={category.category_id}
                      value={category.category_name}
                    >
                      {subgroupLabel(category.category_name)}
                    </option>
                  ))}
                </select>
                <FieldError field="category" message={errors.category} />
              </div>
            </div>
          </fieldset>

          <fieldset className="sailor-edit-section" disabled={saving}>
            <legend>
              <i className="fa fa-sailboat" aria-hidden="true" /> Boat
            </legend>
            <div className="sailor-edit-grid sailor-edit-grid--boat">
              <TextField
                field="sail_number"
                label="Sail number"
                value={draft.sail_number}
                error={errors.sail_number}
                onChange={set('sail_number')}
                inputMode="numeric"
              />
              <div className="sailor-form-field">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- tied by htmlFor, as in SailorForm */}
                <label htmlFor="se-country">Country</label>
                <div className="sailor-edit-country">
                  <Flag
                    code={getFlagCode(draft.country)}
                    className="sailor-edit-flag sailor-edit-flag--small"
                    fallback={
                      <span className="sailor-edit-flag sailor-edit-flag--small" />
                    }
                  />
                  <select
                    id="se-country"
                    name="country"
                    value={draft.country}
                    onChange={set('country')}
                    aria-invalid={invalid('country')}
                    aria-describedby={describedBy('country')}
                  >
                    {!countryKnown && (
                      <option value={draft.country} disabled={!draft.country}>
                        {draft.country
                          ? `${draft.country} (not on the list)`
                          : 'Select country…'}
                      </option>
                    )}
                    {Object.entries(IOC_NATIONS).map(([code, nation]) => (
                      <option key={code} value={code}>
                        {nation.name} ({code})
                      </option>
                    ))}
                  </select>
                </div>
                <FieldError field="country" message={errors.country} />
              </div>
              <TextField
                field="model"
                label="Boat model"
                optional
                value={draft.model}
                error={errors.model}
                onChange={set('model')}
              />
            </div>
          </fieldset>

          <div className="feedback-modal-actions sailor-edit-actions">
            <span className="sailor-edit-hint">
              <kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels
            </span>
            <button
              type="button"
              className="btn-outline"
              onClick={requestClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-success" disabled={saving}>
              {saving ? (
                <>
                  <i className="fa fa-spinner fa-spin" aria-hidden="true" />{' '}
                  Saving…
                </>
              ) : (
                <>
                  <i className="fa fa-check" aria-hidden="true" /> Save changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
