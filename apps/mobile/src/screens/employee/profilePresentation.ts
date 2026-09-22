export type ProfileNotificationPermission =
  | 'undetermined'
  | 'granted'
  | 'denied'
  | 'simulator'
  | 'unavailable';

export type ProfileNotificationStatus = 'active' | 'inactive' | 'pending';

export type NotificationPresentationLabels = {
  enabled: string;
  disabled: string;
  notConfigured: string;
  unavailable: string;
};

export function getNotificationPresentation(
  permissionStatus: ProfileNotificationPermission,
  labels: NotificationPresentationLabels,
): {
  status: ProfileNotificationStatus;
  label: string;
  showWarning: boolean;
} {
  if (permissionStatus === 'granted') {
    return { status: 'active', label: labels.enabled, showWarning: false };
  }

  if (permissionStatus === 'denied') {
    return { status: 'inactive', label: labels.disabled, showWarning: true };
  }

  if (permissionStatus === 'undetermined') {
    return { status: 'pending', label: labels.notConfigured, showWarning: false };
  }

  return { status: 'inactive', label: labels.unavailable, showWarning: false };
}
