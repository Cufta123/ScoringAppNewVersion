/**
 * Column widths for the printed list tables (starting list, heats). A name or
 * a club is never cut with an ellipsis: every column gets what its longest
 * text needs, the columns that can wrap (names, clubs, notes) share what is
 * left, and when the page is too narrow they give way first and their text
 * wraps onto a second line.
 */

export interface WidthColumn {
  /** Millimetres the column wants so that its text stays on one line. */
  need: number;
  /** The least it may be given (its longest word, so it can still wrap). */
  min: number;
  /** May take extra room and may wrap. */
  flex: boolean;
}

/** Rough width of text in the document font at list size, in millimetres. */
const CHAR_MM = 1.78;
const BOLD_CHAR_MM = 1.98;
const CELL_PADDING_MM = 4.4;

export const textWidthMm = (text: string, bold = false): number =>
  text.length * (bold ? BOLD_CHAR_MM : CHAR_MM) + CELL_PADDING_MM;

/** The widest of a header and its values; `min` is the longest single word. */
export const columnNeed = (
  header: string,
  values: ReadonlyArray<string>,
  bold = false,
  flex = false,
): WidthColumn => {
  const widest = Math.max(
    textWidthMm(header, true),
    ...values.map((value) => textWidthMm(value, bold)),
  );
  const longestWord = Math.max(
    textWidthMm(header, true),
    ...values.flatMap((value) =>
      value.split(/\s+/).map((word) => textWidthMm(word, bold)),
    ),
  );
  return {
    need: widest,
    min: flex
      ? Math.min(widest, Math.min(Math.max(longestWord, 26), 45))
      : widest,
    flex,
  };
};

/**
 * Widths that add up to `total`: needs are met, extra room goes to the
 * flexible columns, a shortage is taken from them first (down to their `min`).
 */
export const allocateWidths = (
  columns: ReadonlyArray<WidthColumn>,
  total: number,
): number[] => {
  const needs = columns.map((column) => column.need);
  const needSum = needs.reduce((sum, value) => sum + value, 0);
  const flexible = columns.filter((column) => column.flex).length;
  let widths: number[];

  if (needSum <= total) {
    const extra = total - needSum;
    const receivers = flexible || columns.length;
    widths = columns.map((column, index) =>
      !flexible || column.flex
        ? needs[index] + extra / receivers
        : needs[index],
    );
  } else {
    const over = needSum - total;
    const give = columns.map((column) =>
      column.flex ? column.need - column.min : 0,
    );
    const giveSum = give.reduce((sum, value) => sum + value, 0);
    if (giveSum >= over) {
      widths = columns.map(
        (column, index) =>
          column.need - (giveSum > 0 ? (give[index] / giveSum) * over : 0),
      );
    } else {
      // Everything flexible is at its minimum and it still does not fit:
      // squeeze all columns evenly in proportion.
      const minSum = columns.reduce(
        (sum, column) => sum + (column.flex ? column.min : column.need),
        0,
      );
      widths = columns.map(
        (column) => ((column.flex ? column.min : column.need) / minSum) * total,
      );
    }
  }
  return widths.map((width) => Math.round(width * 100) / 100);
};
