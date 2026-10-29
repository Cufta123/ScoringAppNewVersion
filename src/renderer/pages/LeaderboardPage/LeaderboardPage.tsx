import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, type NavigateOptions } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import useLeaderboard from '../../hooks/useLeaderboard';
import LeaderboardToolbar from '../../components/leaderboard/LeaderboardToolbar';
import SectionDivider from '../../components/leaderboard/SectionDivider';
import QualifyingTable from '../../components/leaderboard/QualifyingTable';
import FinalFleetTable from '../../components/leaderboard/FinalFleetTable';
import RdgLegend from '../../components/leaderboard/RdgLegend';
import { EditValidityProvider } from '../../components/leaderboard/editValidity';
import ScoreExplanationDialog, {
  type ExplainTarget,
} from '../../components/leaderboard/ScoreExplanationDialog';
import ResultsExportDialog from '../../components/export/ResultsExportDialog';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import EmptyState from '../../components/shared/EmptyState';
import LoadingState from '../../components/shared/LoadingState';
import { confirmAction } from '../../utils/userFeedback';
import './LeaderboardPage.css';
import type { EventRow, LeaderboardEntry } from '../../types';
import useRouteEvent from '../../hooks/useRouteEvent';
import { sailorFullName } from '../../utils/sailorName';

interface LeaderboardContentProps {
  event: EventRow;
  onUnsavedChange?: ((hasUnsaved: boolean) => void) | null;
}

function LeaderboardContent({
  event,
  onUnsavedChange = null,
}: LeaderboardContentProps) {
  const eventId = event.event_id;
  const {
    leaderboard,
    eventLeaderboard,
    discardProfiles,
    loading,
    finalSeriesStarted,
    editMode,
    saving,
    editableLeaderboard,
    compareMode,
    selectedBoatIds,
    rdgMeta,
    rdg2Picker,
    hasUnsavedChanges,
    hasEventData,
    hasFinalData,
    groupedLeaderboard,
    sortedGroups,
    compareInfo,
    setCompareMode,
    setSelectedBoatIds,
    setRdg2Picker,
    toggleEditMode,
    handleSave,
    handleRaceChange,
    confirmRdg2,
    handleCompareRowClick,
    reportInvalidCell,
    invalidCells,
    getFlagCode,
  } = useLeaderboard(eventId);
  const invalidCount = Object.keys(invalidCells).length;
  const [exportOpen, setExportOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState('Leaderboard loaded.');
  const [explainTarget, setExplainTarget] = useState<ExplainTarget | null>(
    null,
  );
  const closeExplanation = React.useCallback(() => setExplainTarget(null), []);
  // A boat's total explains itself on click, except while editing (the
  // numbers are unsaved) or comparing (a row click selects the boat).
  const onExplain =
    editMode || compareMode
      ? undefined
      : (entry: LeaderboardEntry) =>
          setExplainTarget({
            boatId: entry.boat_id,
            sail: `${entry.country ?? ''} ${entry.boat_number ?? ''}`.trim(),
            name: sailorFullName(entry),
            place: finalSeriesStarted
              ? (entry.overall_rank ?? null)
              : (entry.place ?? null),
          });

  useEffect(() => {
    if (onUnsavedChange) {
      onUnsavedChange(hasUnsavedChanges);
    }
  }, [hasUnsavedChanges, onUnsavedChange]);

  useEffect(() => {
    if (editMode) {
      setLiveMessage('Edit mode enabled. You can now modify race results.');
    } else {
      setLiveMessage('Edit mode disabled. Leaderboard is read-only.');
    }
  }, [editMode]);

  useEffect(() => {
    if (!compareMode) {
      setLiveMessage('Compare mode disabled.');
      return;
    }

    if (selectedBoatIds.length === 0) {
      setLiveMessage(
        'Compare mode enabled. Select two competitors to compare.',
      );
      return;
    }

    if (selectedBoatIds.length === 1) {
      setLiveMessage('One competitor selected. Select one more competitor.');
      return;
    }

    if (compareInfo && compareInfo.tied && compareInfo.tieBreak?.winner) {
      setLiveMessage(
        `Tie detected. Winner by tie-break: ${sailorFullName(compareInfo.tieBreak.winner)}.`,
      );
      return;
    }

    if (compareInfo && !compareInfo.tied) {
      const leader =
        compareInfo.totalA < compareInfo.totalB
          ? compareInfo.boatA
          : compareInfo.boatB;
      setLiveMessage(`Comparison updated. ${sailorFullName(leader)} leads.`);
    }
  }, [compareMode, selectedBoatIds, compareInfo]);

  useEffect(() => {
    if (hasUnsavedChanges) {
      setLiveMessage('You have unsaved leaderboard changes.');
    }
  }, [hasUnsavedChanges]);

  if (loading) {
    return <LoadingState label="Loading leaderboard data..." />;
  }

  if (!hasEventData && !hasFinalData) {
    return (
      <EmptyState
        title="No leaderboard data yet"
        description="No race results are available for this event. Start scoring races to see standings here."
      />
    );
  }

  return (
    <EditValidityProvider value={reportInvalidCell}>
      <div className="leaderboard">
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveMessage}
        </div>

        <LeaderboardToolbar
          finalSeriesStarted={finalSeriesStarted}
          editMode={editMode}
          saving={saving}
          compareMode={compareMode}
          editDisabled={finalSeriesStarted && !hasFinalData}
          onToggleEdit={toggleEditMode}
          onSave={handleSave}
          onToggleCompare={() => {
            setCompareMode((m) => !m);
            setSelectedBoatIds([]);
          }}
          onExport={() => setExportOpen(true)}
        />

        {/* Exports read the SAVED results (leaderboard, eventLeaderboard), never
            the edit draft (editableLeaderboard): a mid-edit export must not
            carry unsaved values. Mounted only while open, so each opening
            starts from the options remembered for this event. */}
        {exportOpen && (
          <ResultsExportDialog
            open
            onClose={() => setExportOpen(false)}
            event={event}
            finalSeriesStarted={finalSeriesStarted}
            leaderboard={leaderboard}
            eventLeaderboard={eventLeaderboard}
            discardProfiles={discardProfiles}
            hasUnsavedEdits={hasUnsavedChanges}
          />
        )}

        {editMode && (
          <div className="edit-mode-banner" role="status">
            <i className="fa fa-pen-to-square" aria-hidden="true" />
            <div>
              <strong>Editing results.</strong> Type a new place to move the
              boat there: the other boats in that race move up or down to make
              room. Pick a code such as DNF or DSQ under it: the boats behind
              move up one place. Redress (RDG) changes no other boat.
              <br />
              What you see is what is saved, when you press{' '}
              <strong>Save Changes</strong>. <strong>Cancel Editing</strong>{' '}
              throws the edits away.
              {invalidCount > 0 && (
                <div className="edit-mode-banner-error">
                  {invalidCount === 1
                    ? '1 result is marked in red and must be fixed before saving.'
                    : `${invalidCount} results are marked in red and must be fixed before saving.`}
                </div>
              )}
            </div>
          </div>
        )}

        {hasEventData && !finalSeriesStarted && (
          <QualifyingTable
            leaderboard={editMode ? editableLeaderboard : eventLeaderboard}
            editMode={editMode}
            compareMode={compareMode}
            selectedBoatIds={selectedBoatIds}
            compareInfo={compareInfo}
            rdg2Picker={rdg2Picker}
            setRdg2Picker={setRdg2Picker}
            onCompareRowClick={handleCompareRowClick}
            onRaceChange={handleRaceChange}
            confirmRdg2={confirmRdg2}
            getFlagCode={getFlagCode}
            onExplain={onExplain}
          />
        )}

        {finalSeriesStarted && (
          <>
            <SectionDivider label="Final Series" marginTop="20px" />

            {!hasFinalData ? (
              <>
                <EmptyState
                  title="Final series ready"
                  description="The final series is created, but no final races have been scored yet."
                />

                {/* Keep qualifying standings visible until first final race exists. */}
                <QualifyingTable
                  leaderboard={eventLeaderboard}
                  editMode={false}
                  compareMode={false}
                  selectedBoatIds={[]}
                  compareInfo={null}
                  rdg2Picker={null}
                  setRdg2Picker={setRdg2Picker}
                  onCompareRowClick={() => {}}
                  onRaceChange={handleRaceChange}
                  confirmRdg2={confirmRdg2}
                  getFlagCode={getFlagCode}
                  onExplain={onExplain}
                />
              </>
            ) : (
              sortedGroups.map((group) => (
                <FinalFleetTable
                  key={group}
                  group={group}
                  entries={groupedLeaderboard[group]}
                  editMode={editMode}
                  compareMode={compareMode}
                  selectedBoatIds={selectedBoatIds}
                  eventLeaderboard={eventLeaderboard}
                  compareInfo={compareInfo}
                  rdg2Picker={rdg2Picker}
                  setRdg2Picker={setRdg2Picker}
                  onCompareRowClick={handleCompareRowClick}
                  onRaceChange={handleRaceChange}
                  confirmRdg2={confirmRdg2}
                  getFlagCode={getFlagCode}
                  onExplain={onExplain}
                />
              ))
            )}
          </>
        )}

        {/* The RDG legend explains what RDG(x.x) cells mean. It must be visible in
          read mode too — that's the view most people (officials posting
          results, sailors checking standings) actually use, and a bare
          "RDG (3.4)" cell is otherwise only explained on hover. In read mode
          the RDG2 "selected races" labels aren't available (that detail is
          edit-only state), so it degrades to the general description. */}
        {(() => {
          const showingFinalData = finalSeriesStarted && hasFinalData;
          let legendSource = eventLeaderboard;
          if (editMode) {
            legendSource = editableLeaderboard;
          } else if (showingFinalData) {
            legendSource = sortedGroups.flatMap(
              (group) => groupedLeaderboard[group] || [],
            );
          }
          return (
            <RdgLegend
              editableLeaderboard={legendSource}
              rdgMeta={rdgMeta}
              racePrefix={showingFinalData ? 'F' : 'Q'}
            />
          );
        })()}

        <ScoreExplanationDialog
          eventId={eventId}
          target={explainTarget}
          onClose={closeExplanation}
        />
      </div>
    </EditValidityProvider>
  );
}

function LeaderboardPage() {
  const navigate = useNavigate();
  const { eventName } = useParams();
  const event = useRouteEvent(eventName);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  if (!event) {
    return <LoadingState label="Loading event…" />;
  }

  const navigateWithUnsavedCheck = async (target: {
    path: string;
    options?: NavigateOptions;
  }) => {
    if (hasUnsavedChanges) {
      const confirmed = await confirmAction(
        'You have unsaved leaderboard changes. Leave this page and discard them?',
        'Unsaved changes',
        { confirmLabel: 'Leave and discard', confirmClassName: 'btn-danger' },
      );
      if (!confirmed) return;
    }
    navigate(target.path, target.options);
  };

  return (
    <div>
      <Navbar
        onNavigateHome={() =>
          navigateWithUnsavedCheck({ path: '/', options: undefined })
        }
        historyEventId={event?.event_id ?? null}
      />
      <main
        id="main-content"
        className="leaderboard-page-content"
        tabIndex={-1}
      >
        <Breadcrumbs
          items={[
            {
              label: 'Home',
              onClick: () =>
                navigateWithUnsavedCheck({ path: '/', options: undefined }),
            },
            {
              label: event.event_name,
              onClick: () =>
                navigateWithUnsavedCheck({
                  path: `/event/${event.event_name}`,
                  options: { state: { event } },
                }),
            },
            { label: 'Leaderboard' },
          ]}
        />
        <LeaderboardContent
          event={event}
          onUnsavedChange={setHasUnsavedChanges}
        />
      </main>
    </div>
  );
}

export default LeaderboardPage;
