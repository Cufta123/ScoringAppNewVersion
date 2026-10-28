import React from 'react';
import useScoringInput from '../hooks/useScoringInput';
import type { ScoringHeat } from '../hooks/useScoringInput';
import type { ScoredBoat } from '../utils/finishOrder';
import BoatPickerPanel from './scoring/BoatPickerPanel';
import FinishOrderPanel from './scoring/FinishOrderPanel';

export type { ScoredBoat, ScoringHeat };
export type { ScoringBoat } from '../hooks/useScoringInput';

interface ScoringInputComponentProps {
  heat: ScoringHeat;
  onSubmit: (boatPlaces: ScoredBoat[]) => void | Promise<void>;
  /** Notifies the parent when a not-yet-submitted finish order exists, so it
   * can guard navigation away from the scoring view. */
  onDirtyChange?: (dirty: boolean) => void;
}

const ignoreDirtyChange = () => {};

function ScoringInputComponent({
  heat,
  onSubmit,
  onDirtyChange = ignoreDirtyChange,
}: ScoringInputComponentProps) {
  const scoring = useScoringInput({ heat, onSubmit, onDirtyChange });

  return (
    <div className="scoring-layout">
      <BoatPickerPanel
        heatName={heat.heat_name}
        boats={heat.boats}
        entryKeyOf={scoring.entryKeyOf}
        boatNumbers={scoring.boatNumbers}
        penalties={scoring.penalties}
        getPlaceDisplay={scoring.getPlaceDisplay}
        isInvalidSail={scoring.isInvalidSail}
        fetchError={scoring.fetchError}
        onRetry={scoring.retryFetch}
        onBoatClick={scoring.addBoat}
        onPenaltyChange={scoring.changePenalty}
      />
      <FinishOrderPanel heat={heat} scoring={scoring} />
    </div>
  );
}

export default ScoringInputComponent;
