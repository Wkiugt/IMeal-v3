import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSession } from '../../auth/session';
import { useLanguage } from '../../i18n/LanguageProvider';
import { ActionButton, AppText, TextField } from '../../ui/components';
import { BrandMark } from '../../ui/BrandMotion';
import { designTokens, getElevationStyle } from '../../ui/designTokens';

export function EmailOtpScreen() {
  const { authError, isRequestingOtp, isVerifyingOtp, requestOtp, verifyOtp } =
    useSession();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [requested, setRequested] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(
    null,
  );

  const normalizedEmail = email.trim();
  const canRequest =
    normalizedEmail.length > 0 && !isRequestingOtp && !isVerifyingOtp;
  const canVerify = requested && code.trim().length > 0 && !isVerifyingOtp;
  const submitEmail = async () => {
    if (!canRequest) return;
    try {
      const response = await requestOtp(normalizedEmail);
      setRequested(true);
      setRetryAfterSeconds(response.retryAfterSeconds ?? null);
      setCode('');
    } catch {
      setRequested(false);
      setRetryAfterSeconds(null);
    }
  };

  const submitCode = async () => {
    if (!canVerify) return;
    try {
      await verifyOtp(normalizedEmail, code.trim());
    } catch {
      // SessionProvider owns the safe, non-enumerating error state.
    }
  };

  return (
    <View style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.canvas}>
            <View style={styles.card}>
              <BrandMark size={32} containerSize={72} style={styles.mark} />
              <AppText variant="pageTitle" style={styles.title}>
                {t('auth.welcome')}
              </AppText>
              <AppText variant="body" tone="secondary" style={styles.subtitle}>
                {t('auth.emailOtpHint')}
              </AppText>
              <TextField
                label={t('auth.email')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                editable={!isVerifyingOtp}
                containerStyle={styles.field}
              />
              <ActionButton
                variant="primary"
                size="lg"
                label={requested ? t('auth.resendCode') : t('auth.requestCode')}
                disabled={!canRequest}
                loading={isRequestingOtp}
                onPress={() => void submitEmail()}
                style={styles.button}
              />
              {requested && (
                <View style={styles.codeSection}>
                  <AppText
                    variant="supporting"
                    tone="secondary"
                    style={styles.codeHint}
                  >
                    {t('auth.otpSent')}
                  </AppText>
                  {retryAfterSeconds !== null && retryAfterSeconds > 0 && (
                    <AppText
                      variant="caption"
                      tone="secondary"
                      style={styles.codeHint}
                    >
                      {t('auth.otpRetryAfter', { seconds: retryAfterSeconds })}
                    </AppText>
                  )}
                  <TextField
                    label={t('auth.verificationCode')}
                    value={code}
                    onChangeText={setCode}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    maxLength={8}
                    editable={!isVerifyingOtp}
                    containerStyle={styles.field}
                  />
                  <ActionButton
                    variant="secondary"
                    size="lg"
                    label={t('auth.verifyCode')}
                    disabled={!canVerify}
                    loading={isVerifyingOtp}
                    onPress={() => void submitCode()}
                    style={styles.button}
                  />
                </View>
              )}
              <AppText
                variant="caption"
                tone="secondary"
                style={styles.footnote}
              >
                {t('auth.otpPrivacy')}
              </AppText>
              {authError && (
                <AppText
                  variant="supporting"
                  tone="critical"
                  style={styles.error}
                >
                  {authError}
                </AppText>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: designTokens.color.background.page,
  },
  keyboard: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    padding: designTokens.space['2xl'],
  },
  canvas: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 346,
    padding: 26,
    borderWidth: 1,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.floating,
    backgroundColor: designTokens.color.surface.standard,
    ...getElevationStyle(1),
  },
  mark: {
    alignSelf: 'center',
    marginBottom: 18,
    borderRadius: designTokens.radius.full,
  },
  title: { textAlign: 'center' },
  subtitle: {
    textAlign: 'center',
    marginTop: designTokens.space.sm,
    marginBottom: designTokens.space['2xl'],
  },
  field: { marginBottom: 14 },
  button: { marginTop: 4 },
  codeSection: {
    marginTop: designTokens.space.lg,
    paddingTop: designTokens.space.lg,
    borderTopWidth: 1,
    borderTopColor: designTokens.color.border.standard,
  },
  codeHint: { marginBottom: designTokens.space.md },
  footnote: {
    flexShrink: 1,
    textAlign: 'center',
    marginTop: 18,
  },
  error: {
    textAlign: 'center',
    marginTop: 16,
  },
});
