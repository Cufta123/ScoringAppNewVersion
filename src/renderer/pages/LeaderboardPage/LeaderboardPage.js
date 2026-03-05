import React from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import useLeaderboard from '../../hooks/useLeaderboard';
import LeaderboardToolbar from '../../components/leaderboard/LeaderboardToolbar';
import SectionDivider from '../../components/leaderboard/SectionDivider';
import QualifyingTable from '../../components/leaderboard/QualifyingTable';
import FinalFleetTable from '../../components/leaderboard/FinalFleetTable';
import RdgLegend from '../../components/leaderboard/RdgLegend';
import ComparePanel from '../../components/leaderboard/ComparePanel';
import './LeaderboardPage.css';

function LeaderboardContent({ eventId }) {
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
    exportToExcel,
    getFlagCode,
  } = useLeaderboard(eventId);

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--navy)' }}>Loading…</div>
    );
  }

  if (!hasEventData && !hasFinalData) {
    return (
      <div style={{ padding: '24px', color: '#666' }}>
        No results available for this event yet.
      </div>
    );
  }

  return (
    <div className="leaderboard">
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
        onExport={exportToExcel}
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
            <div
              style={{
                padding: '24px',
                color: '#666',
                textAlign: 'center',
                border: '1px solid var(--border,#dde3ea)',
                borderRadius: '10px',
              }}
            >
              The final series has been created but no races have been scored
              yet.
            </div>
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

      <ComparePanel
        compareMode={compareMode}
        compareInfo={compareInfo}
        selectedBoatIds={selectedBoatIds}
      />
    </div>
  );
}

LeaderboardContent.propTypes = {
  eventId: PropTypes.number.isRequired,
};

function LeaderboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { event } = location.state || {};

  if (!event) {
    navigate('/');
    return null;
  }

  const handleBack = () => {
    navigate(`/event/${event.event_name}`, { state: { event } });
  };

  return (
    <div>
      <Navbar onBack={handleBack} backLabel="Back to Event" />
      <div className="leaderboard-page-content">
        <LeaderboardContent eventId={event.event_id} />
      </div>
    </div>
  );
}

export default LeaderboardPage;
