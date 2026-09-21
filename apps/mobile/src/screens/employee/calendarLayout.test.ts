import { describe, expect, it } from 'vitest';
import {
  registrationDayIndexes,
  weekHeadingCopyStyle,
  weekHeadingRowStyle,
} from './calendarLayout';

describe('weekly registration heading layout', () => {
  it('keeps the heading and count badge inside the mobile content width', () => {
    expect(weekHeadingCopyStyle).toMatchObject({
      flex: 1,
      minWidth: 0,
    });
    expect(weekHeadingRowStyle).toMatchObject({
      flexDirection: 'column',
      alignItems: 'stretch',
      width: '100%',
    });
  });

  it('only exposes Monday through Friday registration rows', () => {
    expect(registrationDayIndexes).toEqual([0, 1, 2, 3, 4]);
  });
});
