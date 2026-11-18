export function formatHoldDuration(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(remSeconds).padStart(2, '0')}s`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  return `${totalHours}h ${String(remMinutes).padStart(2, '0')}m`;
}

export function formatHoldMinutes(holdSeconds: number): string {
  const safeSec = Number.isFinite(holdSeconds) ? Math.max(0, holdSeconds) : 0;
  const mins = safeSec / 60;
  if (mins < 60) {
    return `${mins.toFixed(1)} min`;
  }
  return `${Math.round(mins)} min`;
}
