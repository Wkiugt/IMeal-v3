export const OTP_INPUT_PROPS = {
  secureTextEntry: true,
  autoCapitalize: 'none' as const,
  autoCorrect: false,
  keyboardType: 'number-pad' as const,
  textContentType: 'oneTimeCode' as const,
  maxLength: 8,
};
