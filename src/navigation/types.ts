import type {ConversationKind} from '@/types';
import type {CompositeNavigationProp} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

/** Bottom tabs — the primary footer navigation. */
export type MainTabParamList = {
  ChatsTab: undefined;
  NearbyTab: undefined;
  SOSTab: undefined;
  NotesTab: undefined;
  ProfileTab: undefined;
};

/** Root stack — hosts the tabs plus full-screen detail pages. */
export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  Conversation: {conversationId: string; kind: ConversationKind; title: string};
  CreateGroup: undefined;
  TrustedCircle: undefined;
  Settings: undefined;
  EditProfile: undefined;
  About: undefined;
  Call: undefined;
  /** Anyone's profile — a connected person or someone nearby. */
  Contact: {publicKey: string};
  GroupInfo: {groupId: string};
  SettingsNotifications: undefined;
  SettingsPrivacy: undefined;
  SettingsCalls: undefined;
  SettingsStorage: undefined;
  SettingsChats: undefined;
  Blocked: undefined;
  Starred: undefined;
};

/** Navigation prop for screens hosted inside the bottom tabs (can reach both
 *  tab routes and root-stack detail screens). */
export type AppNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
