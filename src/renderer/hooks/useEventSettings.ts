import { useState } from 'react';
import type { EventRow } from '../types';
import {
  DEFAULT_THRESHOLD_PREVIEW,
  parseDiscardModeAndConfig,
  parseThresholdInput,
  serializeDiscardProfile,
} from '../utils/discardProfileForm';

/**
 * The advanced SHRS options shared by the create form and the inline edit form.
 *
 * Both forms edit the same seven settings, and both previously kept their own
 * copy of the state, their own mode-change handlers and their own validation —
 * the edit copies distinguished only by an `edit` prefix. A change to the
 * discard UI therefore had to be made twice or the two paths silently diverged.
 *
 * The qualifying and final discard series are themselves identical, so they
 * share one `useDiscardSeries` instance each rather than being written out
 * twice again.
 */

export interface DiscardSeries {
  mode: string;
  input: string;
  error: string;
  locked: boolean;
  /** Change the mode, resetting the threshold list to match it. */
  setMode: (value: string) => void;
  /** Change the threshold list, validating as the user types. */
  setInput: (value: string) => void;
  /** Validate before submit; returns the message to report, or null. */
  validate: () => string | null;
  /** The profile string to persist. */
  serialize: () => string;
}

function useDiscardSeries(): DiscardSeries & {
  load: (profile: string | null | undefined, isLocked: boolean) => void;
  reset: () => void;
} {
  const [mode, setModeState] = useState('standard');
  const [input, setInputState] = useState(DEFAULT_THRESHOLD_PREVIEW);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);

  const setMode = (value: string) => {
    setModeState(value);
    setError('');
    if (value === 'standard') {
      setInputState(DEFAULT_THRESHOLD_PREVIEW);
    } else if (value === 'never') {
      setInputState('');
    }
  };

  const setInput = (value: string) => {
    setInputState(value);
    setError(parseThresholdInput(value).error || '');
  };

  const load = (profile: string | null | undefined, isLocked: boolean) => {
    const parsed = parseDiscardModeAndConfig(profile);
    setModeState(parsed.mode);
    setInputState(parsed.thresholdsInput);
    setError('');
    setLocked(isLocked);
  };

  const reset = () => {
    setModeState('standard');
    setInputState(DEFAULT_THRESHOLD_PREVIEW);
    setError('');
    setLocked(false);
  };

  // A locked profile cannot be edited (SHRS 5.4 closes it at the first warning
  // signal), so there is nothing to validate. The create form never locks, so
  // this is the same check both forms already made.
  const validate = (): string | null => {
    if (locked || mode !== 'custom') return null;
    const { error: message } = parseThresholdInput(input);
    setError(message || '');
    return message || null;
  };

  const serialize = () => serializeDiscardProfile(mode, input);

  return {
    mode,
    input,
    error,
    locked,
    setMode,
    setInput,
    validate,
    serialize,
    load,
    reset,
  };
}

export interface LoadedEventSettings {
  advanced: boolean;
  assignment: string;
  overflow: string;
  qMode: string;
  qInput: string;
  fMode: string;
  fInput: string;
}

export interface EventSettings {
  advancedEnabled: boolean;
  setAdvancedEnabled: (value: boolean) => void;
  assignmentMode: string;
  setAssignmentMode: (value: string) => void;
  heatOverflowPolicy: string;
  setHeatOverflowPolicy: (value: string) => void;
  qualifying: DiscardSeries;
  final: DiscardSeries;
  /**
   * Load the settings stored on an event, for the inline edit form. Returns
   * the loaded values: React state updates are async, so a caller recording a
   * baseline cannot read them back off this object straight afterwards.
   */
  loadFrom: (event: EventRow) => LoadedEventSettings;
  /** Return to create-form defaults. */
  reset: () => void;
  /**
   * Validate both discard series. Returns the message and which series failed,
   * or null when both are valid.
   */
  validate: () => { message: string; series: 'qualifying' | 'final' } | null;
  /** The four values insertEvent/updateEvent expect, honouring the toggle. */
  toEventFields: () => [string, string, string, string];
}

export default function useEventSettings(): EventSettings {
  const [advancedEnabled, setAdvancedEnabled] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState('progressive');
  const [heatOverflowPolicy, setHeatOverflowPolicy] = useState('auto-increase');
  const qualifying = useDiscardSeries();
  const final = useDiscardSeries();

  const loadFrom = (event: EventRow): LoadedEventSettings => {
    const assignment = event.shrs_qualifying_assignment_mode || 'progressive';
    const overflow = event.shrs_heat_overflow_policy || 'auto-increase';
    const qualifyingProfile = parseDiscardModeAndConfig(
      event.shrs_discard_profile_qualifying,
    );
    const finalProfile = parseDiscardModeAndConfig(
      event.shrs_discard_profile_final,
    );

    qualifying.load(
      event.shrs_discard_profile_qualifying,
      event.shrs_discard_locked_qualifying === 1,
    );
    final.load(
      event.shrs_discard_profile_final,
      event.shrs_discard_locked_final === 1,
    );
    setAssignmentMode(assignment);
    setHeatOverflowPolicy(overflow);

    // The panel opens expanded only when the event actually uses a
    // non-default setting, so an untouched event edits as simply as it reads.
    const usesAdvanced =
      assignment !== 'progressive' ||
      overflow !== 'auto-increase' ||
      qualifyingProfile.mode !== 'standard' ||
      finalProfile.mode !== 'standard';
    setAdvancedEnabled(usesAdvanced);

    return {
      advanced: usesAdvanced,
      assignment,
      overflow,
      qMode: qualifyingProfile.mode,
      qInput: qualifyingProfile.thresholdsInput,
      fMode: finalProfile.mode,
      fInput: finalProfile.thresholdsInput,
    };
  };

  const reset = () => {
    setAdvancedEnabled(false);
    setAssignmentMode('progressive');
    setHeatOverflowPolicy('auto-increase');
    qualifying.reset();
    final.reset();
  };

  const validate = () => {
    if (!advancedEnabled) return null;
    const qualifyingMessage = qualifying.validate();
    if (qualifyingMessage) {
      return { message: qualifyingMessage, series: 'qualifying' as const };
    }
    const finalMessage = final.validate();
    if (finalMessage) {
      return { message: finalMessage, series: 'final' as const };
    }
    return null;
  };

  const toEventFields = (): [string, string, string, string] =>
    advancedEnabled
      ? [
          assignmentMode,
          qualifying.serialize(),
          final.serialize(),
          heatOverflowPolicy,
        ]
      : ['progressive', 'standard', 'standard', 'auto-increase'];

  return {
    advancedEnabled,
    setAdvancedEnabled,
    assignmentMode,
    setAssignmentMode,
    heatOverflowPolicy,
    setHeatOverflowPolicy,
    qualifying,
    final,
    loadFrom,
    reset,
    validate,
    toEventFields,
  };
}
