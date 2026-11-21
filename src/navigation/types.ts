import type {ConversationKind} from '@/types';
import type {CompositeNavigationProp} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

/** Bottom tabs — the primary footer navigation. */
export type MainTabParamList = {
  ChatsTab: undefined;
  NearbyTab: undefined;
  SOSTab: undefined;
  StatusTab: undefined;
  CallsTab: undefined;
};

/** Root stack — hosts the tabs plus full-screen detail pages. */
export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  Conversation: {conversationId: string; kind: ConversationKind; title: string};
  /** Everything shared in one chat: photos and videos, files, links. */
  Media: {conversationId: string; title: string};
  /** Invite more of my connections into a group (the group's admin only). */
  AddGroupMembers: {groupId: string};
  /** A group's link and QR code, and who has asked to join (admins approve there). */
  GroupInvite: {groupId: string};
  /** Opened from a group's link: ask to join. */
  JoinGroup: {id: string; admin: string; name: string};
  /** Everything about one message: sent, delivered, read, and how it travelled. */
  MessageInfo: {conversationId: string; messageId: string; kind: ConversationKind};
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
  SettingsChatLock: undefined;
  SettingsCalls: undefined;
  SettingsStorage: undefined;
  SettingsChats: undefined;
  Blocked: undefined;
  Starred: undefined;
  /** Accounts on this phone: switch, add, remove. */
  Accounts: undefined;
  /** My profile (reached from the picture at the top of every main screen). */
  Profile: undefined;
  /** Verify a phone number by text message (optional). */
  VerifyPhone: {from?: 'onboarding' | 'settings'} | undefined;
  SettingsAppearance: undefined;
  NewSecretChat: undefined;
  NewChat: undefined;
  SettingsInternet: undefined;
  /** Find people: by username, contacts, or a scanned/opened invite. */
  FindPeople: {invite?: {key: string; name: string}} | undefined;
  MyCode: undefined;
  /** Choose who sees my Status. */
  StatusPrivacy: undefined;
  /** A voice or video call over the internet. */
  InternetCall: undefined;
  /** Safety notes (location-based notes), now reached from the You tab. */
  SafetyNotes: undefined;
  /** start: open the camera, the gallery, or the keyboard straight away. */
  StatusComposer: {start?: 'camera' | 'gallery' | 'text'; editId?: string} | undefined;
  /** 'me' = my own updates, otherwise a person's key. */
  StatusViewer: {author: string};
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
