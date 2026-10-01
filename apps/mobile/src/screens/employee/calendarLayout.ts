import type { ViewStyle } from 'react-native';
export const weekHeadingRowStyle: Pick<
  ViewStyle,
  'flexDirection' | 'alignItems' | 'width'
> = {
  flexDirection: 'column',
  alignItems: 'stretch',
  width: '100%',
};

export const weekHeadingCopyStyle: Pick<ViewStyle, 'flex' | 'minWidth'> = {
  flex: 1,
  minWidth: 0,
};
