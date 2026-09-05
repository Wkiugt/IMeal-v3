const RNScreens = require('react-native-screens');
const React = require('react');
const { View, StyleSheet } = require('react-native');

// Polyfill compatibilityFlags for react-native-screens v3 with React Navigation v7
if (!RNScreens.compatibilityFlags) {
  RNScreens.compatibilityFlags = {
    isNewBackTitleImplementation: true,
    usesNewAndroidHeaderHeightImplementation: false,
  };
}

// Polyfill ScreenStackItem for react-native-screens v3 with React Navigation v7
if (!RNScreens.ScreenStackItem) {
  RNScreens.ScreenStackItem = React.forwardRef(function ScreenStackItem(props, ref) {
    const {
      children,
      headerConfig,
      activityState,
      stackPresentation,
      contentStyle,
      style,
      screenId,
      ...rest
    } = props;

    let internalScreenStyle;
    if (stackPresentation === 'formSheet' && contentStyle) {
      const flatten = StyleSheet.flatten(contentStyle);
      internalScreenStyle = { backgroundColor: flatten?.backgroundColor };
    }

    return React.createElement(
      RNScreens.Screen,
      {
        ref,
        enabled: true,
        isNativeStack: true,
        activityState,
        stackPresentation,
        hasLargeHeader: headerConfig?.largeTitle ?? false,
        style: [style, internalScreenStyle],
        ...rest,
      },
      React.createElement(
        View,
        {
          style: [{ flex: 1 }, contentStyle],
        },
        children,
      ),
      headerConfig && RNScreens.ScreenStackHeaderConfig
        ? React.createElement(RNScreens.ScreenStackHeaderConfig, { ...headerConfig })
        : null,
    );
  });
}

import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
