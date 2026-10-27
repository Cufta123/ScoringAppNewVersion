import React from 'react';

/**
 * Lets each race cell being edited tell the leaderboard that it holds input
 * that cannot be saved (e.g. place 15 in a 10-boat heat), so Save can refuse
 * and say which cells to fix. `report(key, null)` clears the cell.
 */
export type ReportInvalidCell = (key: string, message: string | null) => void;

const EditValidityContext = React.createContext<ReportInvalidCell>(() => {});

export const EditValidityProvider = EditValidityContext.Provider;

export function useReportInvalidCell(): ReportInvalidCell {
  return React.useContext(EditValidityContext);
}
