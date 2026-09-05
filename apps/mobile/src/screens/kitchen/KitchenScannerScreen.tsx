import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Button,
  Alert,
  Modal,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { servingAPI, ResolveServingResponse } from '../../api/servingAPI';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'KitchenScanner'>;

export function KitchenScannerScreen({ route, navigation }: Props) {
  const token = route.params.token;

  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servingIntent, setServingIntent] =
    useState<ResolveServingResponse | null>(null);

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>
          We need your permission to show the camera
        </Text>
        <Button onPress={requestPermission} title="Grant permission" />
      </View>
    );
  }

  const handleBarCodeScanned = async ({
    type,
    data,
  }: {
    type: string;
    data: string;
  }) => {
    if (scanned || loading) return;
    setScanned(true);
    resolveCode(data);
  };

  const resolveCode = async (payload: string) => {
    setLoading(true);
    try {
      const response = await servingAPI.resolveServing(
        { qrPayload: payload },
        token,
      );
      setServingIntent(response);
    } catch (error: unknown) {
      Alert.alert(
        'Error resolving serving',
        error instanceof Error ? error.message : 'Unable to resolve serving',
      );
    } finally {
      setLoading(false);
    }
  };

  const confirmServing = async () => {
    if (!servingIntent) return;
    setLoading(true);
    try {
      await servingAPI.confirmServing(
        { pickupSessionToken: servingIntent.pickupSessionToken },
        token,
      );
      Alert.alert('Success', 'Serving confirmed successfully!', [
        {
          text: 'OK',
          onPress: () => {
            setServingIntent(null);
            setScanned(false);
          },
        },
      ]);
    } catch (error: unknown) {
      Alert.alert(
        'Confirmation Error',
        error instanceof Error ? error.message : 'Unable to confirm serving',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Scanner View */}
      {isFocused && !servingIntent && (
        <>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
          />
          <View style={styles.overlay}>
            <TouchableOpacity
              style={styles.backDashboardBtn}
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.navigate('KitchenDashboard', { token });
                }
              }}
            >
              <Text style={styles.backDashboardText}>← Quay lại</Text>
            </TouchableOpacity>
            <View style={styles.scanBox} />
            <Text style={styles.scanText}>Scan QR to resolve serving</Text>
          </View>
        </>
      )}

      {/* Confirmation Modal */}
      <Modal visible={!!servingIntent} animationType="slide" transparent>
        <View style={styles.modalBackground}>
          <View style={styles.modalContent}>
            <Text style={styles.title}>Serving Confirmation</Text>

            {servingIntent?.intent.isProxy && (
              <Text style={styles.warningText}>[PROXY PICKUP]</Text>
            )}

            <Text style={styles.subtitle}>Items to serve:</Text>
            <ScrollView style={styles.itemList}>
              {servingIntent?.intent.items.map((item, index) => (
                <View key={index} style={styles.itemRow}>
                  <Text style={styles.itemName}>{item.itemName}</Text>
                  <Text style={styles.itemQuantity}>x{item.quantity}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Items:</Text>
              <Text style={styles.totalValue}>
                {servingIntent?.intent.totalCount}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.confirmCTA, loading && styles.disabledCTA]}
              onPress={confirmServing}
              disabled={loading}
            >
              <Text style={styles.confirmCTAText}>
                {loading ? 'PROCESSING...' : 'XÁC NHẬN'}
              </Text>
            </TouchableOpacity>

            <Button
              title="Cancel"
              color="red"
              onPress={() => {
                setServingIntent(null);
                setScanned(false);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  text: {
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backDashboardBtn: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  backDashboardText: {
    color: '#1f5fc2',
    fontWeight: '700',
    fontSize: 14,
  },
  scanBox: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#0f0',
    backgroundColor: 'transparent',
  },
  scanText: {
    color: '#fff',
    marginTop: 20,
    fontSize: 18,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 10,
  },
  warningText: {
    color: '#ff9800',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
    marginVertical: 5,
  },
  itemList: {
    maxHeight: 200,
    marginBottom: 20,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  itemName: {
    fontSize: 16,
  },
  itemQuantity: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderTopWidth: 2,
    borderTopColor: '#000',
    marginBottom: 20,
  },
  totalLabel: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2e7d32',
  },
  confirmCTA: {
    backgroundColor: '#4caf50',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 15,
  },
  disabledCTA: {
    backgroundColor: '#9e9e9e',
  },
  confirmCTAText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },
});
