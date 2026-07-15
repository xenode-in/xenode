export interface TimelineWindow {
  totalRows: number;
  viewportRows: number;
  startRow: number;
  endRow: number;
  startIndex: number;
  endIndex: number;
}

export function getTimelineWindow(args: {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  columns: number;
  rowHeight: number;
  overscanRows?: number;
}): TimelineWindow {
  const {
    itemCount,
    scrollTop,
    viewportHeight,
    columns,
    rowHeight,
    overscanRows = 3,
  } = args;
  if (
    !Number.isSafeInteger(itemCount) ||
    itemCount < 0 ||
    !Number.isSafeInteger(columns) ||
    columns < 1 ||
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(rowHeight) ||
    viewportHeight <= 0 ||
    rowHeight <= 0
  ) {
    throw new Error("Invalid timeline window");
  }
  const totalRows = Math.ceil(itemCount / columns);
  const viewportRows = Math.ceil(viewportHeight / rowHeight);
  const startRow = Math.max(
    0,
    Math.floor(Math.max(scrollTop, 0) / rowHeight) - overscanRows,
  );
  const endRow = Math.min(
    totalRows,
    startRow + viewportRows + overscanRows * 2,
  );
  return {
    totalRows,
    viewportRows,
    startRow,
    endRow,
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRow * columns),
  };
}
