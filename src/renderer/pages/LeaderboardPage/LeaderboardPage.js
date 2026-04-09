/* eslint-disable react/require-default-props */
import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import useLeaderboard from '../../hooks/useLeaderboard';
import LeaderboardToolbar from '../../components/leaderboard/LeaderboardToolbar';
import SectionDivider from '../../components/leaderboard/SectionDivider';
import QualifyingTable from '../../components/leaderboard/QualifyingTable';
import FinalFleetTable from '../../components/leaderboard/FinalFleetTable';
import RdgLegend from '../../components/leaderboard/RdgLegend';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import EmptyState from '../../components/shared/EmptyState';
import LoadingState from '../../components/shared/LoadingState';
import { confirmAction } from '../../utils/userFeedback';
import './LeaderboardPage.css';

function LeaderboardContent({ eventId, onUnsavedChange = null }) {
  const {
    eventLeaderboard,
    loading,
    finalSeriesStarted,
    editMode,
    editableLeaderboard,
    shiftPositions,
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
    setShiftPositions,
    setCompareMode,
    setSelectedBoatIds,
    setRdg2Picker,
    toggleEditMode,
    handleSave,
    handleRaceChange,
    confirmRdg2,
    handleCompareRowClick,
    exportAs,
    getFlagCode,
  } = useLeaderboard(eventId);
  const [liveMessage, setLiveMessage] = useState('Leaderboard loaded.');

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
        `Tie detected. Winner by tie-break: ${compareInfo.tieBreak.winner.name} ${compareInfo.tieBreak.winner.surname}.`,
      );
      return;
    }

    if (compareInfo && !compareInfo.tied) {
      const leader =
        compareInfo.totalA < compareInfo.totalB
          ? compareInfo.boatA
          : compareInfo.boatB;
      setLiveMessage(
        `Comparison updated. ${leader.name} ${leader.surname} leads.`,
      );
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
    <div className="leaderboard">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>

      <LeaderboardToolbar
        finalSeriesStarted={finalSeriesStarted}
        editMode={editMode}
        compareMode={compareMode}
        shiftPositions={shiftPositions}
        onToggleEdit={toggleEditMode}
        onSave={handleSave}
        onShiftChange={(e) => setShiftPositions(e.target.checked)}
        onToggleCompare={() => {
          setCompareMode((m) => !m);
          setSelectedBoatIds([]);
        }}
        onExport={exportAs}
      />

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
              />
            ))
          )}
        </>
      )}

      {editMode && (
        <RdgLegend
          editableLeaderboard={editableLeaderboard}
          rdgMeta={rdgMeta}
        />
      )}
    </div>
  );
}

LeaderboardContent.propTypes = {
  eventId: PropTypes.number.isRequired,
  onUnsavedChange: PropTypes.func,
};

function LeaderboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { event } = location.state || {};
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  if (!event) {
    navigate('/');
    return null;
  }

  const navigateWithUnsavedCheck = async (target) => {
    if (hasUnsavedChanges) {
      const confirmed = await confirmAction(
        'You have unsaved leaderboard changes. Leave this page and discard them?',
        'Unsaved changes',
      );
      if (!confirmed) return;
    }
    navigate(target.path, target.options);
  };

  const handleBack = async () => {
    await navigateWithUnsavedCheck({
      path: `/event/${event.event_name}`,
      options: { state: { event } },
    });
  };

  return (
    <div>
      <Navbar onBack={handleBack} backLabel="Back to Event" />
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
          eventId={event.event_id}
          onUnsavedChange={setHasUnsavedChanges}
        />
      </main>
    </div>
  );
}

export default LeaderboardPage;
