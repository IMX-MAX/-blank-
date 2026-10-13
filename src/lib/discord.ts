import { Capacitor, registerPlugin } from '@capacitor/core';

type DiscordNative = {
  /** False when the app was built without the Discord Social SDK. */
  isAvailable(): Promise<{ available: boolean }>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
};

/** Shows what is playing as "Listening to [blank]" in the Discord app. Null on the web. */
export const discordPresence: DiscordNative | null = Capacitor.isNativePlatform() ? registerPlugin<DiscordNative>('DiscordPresence') : null;
