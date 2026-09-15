export function buildMonthRows(month: Date): Array<Array<Date | null>> {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount / 7 }, (_, rowIndex) =>
    Array.from({ length: 7 }, (_, columnIndex) => {
      const dayOfMonth = rowIndex * 7 + columnIndex - offset + 1;
      return dayOfMonth >= 1 && dayOfMonth <= daysInMonth
        ? new Date(year, monthIndex, dayOfMonth)
        : null;
    }),
  );
}
