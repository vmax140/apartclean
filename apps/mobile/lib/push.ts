import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushDevice, type NotificationClient } from '@apartclean/shared/notification';

// Prijava uređaja za Expo Push (SPEC sekcija 2).
//
// Push ne radi u Expo Go — treba razvojni build (SPEC sekcija 10, Faza 2C i
// uputstvo u docs/EAS.md). Zato ovde nema bacanja greške: ako token ne može da
// se dobije, aplikacija nastavlja, a korisnik obaveštenja vidi u spisku.

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'failed';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function enablePush(client: NotificationClient): Promise<PushResult> {
  // Simulator nema push token; samo pravi uređaj ga dobija.
  if (!Device.isDevice) return 'unsupported';

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return 'denied';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'ApartClean',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return 'unsupported';

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushDevice(client, token, Platform.OS === 'ios' ? 'ios' : 'android');
    return 'enabled';
  } catch {
    return 'failed';
  }
}
