import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { pickupAPI, PickupOption } from '../../api/pickupAPI';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Check, Square } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'PickupIntent'>;

export const PickupIntentScreen: React.FC<Props> = ({ route }) => {
  const token = route.params.token;
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<PickupOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [timeLeft, setTimeLeft] = useState(5);

  const progressAnim = useRef(new Animated.Value(1)).current;

  const fetchOptions = async () => {
    try {
      const res = await pickupAPI.getPickupOptions(token);
      setOptions(res.options);
      // Auto-select one item by default
      if (res.options.length > 0) {
        setSelectedIds(new Set([res.options[0].registrationId]));
      } else {
        setSelectedIds(new Set());
      }
    } catch (error: unknown) {
      Alert.alert(
        'Error',
        error instanceof Error
          ? error.message
          : 'Unable to load pickup options',
      );
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void fetchOptions();
    }, [token]),
  );

  useEffect(() => {
    if (!isGenerating) {
      setQrValue(null);
      return;
    }

    let refreshInterval: NodeJS.Timeout | undefined;
    let countdownInterval: NodeJS.Timeout | undefined;
    let isMounted = true;

    const fetchQR = async () => {
      if (!isMounted) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        setIsGenerating(false);
        return;
      }
      try {
        setQrLoading(true);
        const res = await pickupAPI.generateQr(token, ids);
        if (isMounted) {
          setQrValue(res.qr);
          setTimeLeft(5);
          progressAnim.setValue(1);
          Animated.timing(progressAnim, {
            toValue: 0,
            duration: 5000,
            useNativeDriver: false,
          }).start();
        }
      } catch (error: unknown) {
        Alert.alert(
          'QR unavailable',
          error instanceof Error ? error.message : 'Unable to generate QR code',
        );
        setIsGenerating(false);
      } finally {
        if (isMounted) setQrLoading(false);
      }
    };

    void fetchQR();
    refreshInterval = setInterval(() => {
      if (isMounted) {
        void fetchQR();
      }
    }, 5000);

    countdownInterval = setInterval(() => {
      if (isMounted) {
        setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(refreshInterval);
      clearInterval(countdownInterval);
      progressAnim.stopAnimation();
    };
  }, [isGenerating, selectedIds]);

  const toggleSelection = (registrationId: string) => {
    const next = new Set(selectedIds);
    if (next.has(registrationId)) {
      next.delete(registrationId);
    } else {
      next.add(registrationId);
    }
    setSelectedIds(next);
  };

  const handleGenerate = () => {
    if (selectedIds.size === 0) {
      Alert.alert(
        'Selection Required',
        'Please select at least one meal to generate a QR code.',
      );
      return;
    }
    setIsGenerating(true);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (options.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Your Pickup Meals</Text>
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            You have no meals ready to pick up today.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Your Pickup Meals</Text>

      <ScrollView style={styles.list}>
        {options.map((opt) => {
          const isSelected = selectedIds.has(opt.registrationId);
          return (
            <TouchableOpacity
              key={opt.registrationId}
              style={[
                styles.optionCard,
                isSelected && styles.optionCardSelected,
              ]}
              onPress={() => toggleSelection(opt.registrationId)}
            >
              <View style={styles.cardHeader}>
                {isSelected ? (
                  <Check size={24} color="#4caf50" />
                ) : (
                  <Square size={24} color="#9e9e9e" />
                )}
                <Text style={styles.optionType}>
                  {opt.type === 'OWN' ? 'My Meal' : 'Delegated Meal'}
                </Text>
              </View>
              {opt.type === 'DELEGATED' && opt.owner && (
                <Text style={styles.ownerText}>
                  From: {opt.owner.name} ({opt.owner.email})
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.qrSection}>
        {!isGenerating ? (
          <TouchableOpacity style={styles.generateBtn} onPress={handleGenerate}>
            <Text style={styles.generateBtnText}>Generate QR</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.qrContainer}>
            {qrValue ? (
              <View style={styles.qrWrapper}>
                <QRCode value={qrValue} size={200} />
                <Text style={styles.qrHelper}>
                  Show this QR code to the Kitchen Staff.
                </Text>

                <View style={styles.timerWrapper}>
                  <Text style={styles.timerText}>
                    Refreshing in {timeLeft}s
                  </Text>
                  <View style={styles.progressBarContainer}>
                    <Animated.View
                      style={[
                        styles.progressBar,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <ActivityIndicator size="large" />
            )}
            {qrLoading && qrValue && (
              <ActivityIndicator size="small" style={styles.refreshIndicator} />
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  optionCardSelected: {
    borderColor: '#4caf50',
    backgroundColor: '#e8f5e9',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  optionType: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
  ownerText: {
    fontSize: 14,
    color: '#757575',
    marginLeft: 36,
  },
  qrSection: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#eeeeee',
  },
  generateBtn: {
    backgroundColor: '#2196f3',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrWrapper: {
    alignItems: 'center',
    width: '100%',
  },
  qrHelper: {
    marginTop: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  timerWrapper: {
    width: '80%',
    alignItems: 'center',
  },
  timerText: {
    fontSize: 14,
    color: '#757575',
    marginBottom: 6,
  },
  progressBarContainer: {
    height: 4,
    width: '100%',
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4caf50',
  },
  refreshIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  emptyText: {
    fontSize: 16,
    color: '#757575',
    textAlign: 'center',
  },
});
