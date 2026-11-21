/**
 * Pulse — root component.
 *
 * Offline-first: not onboarded -> Onboarding; otherwise straight into the app
 * (bottom-tab navigation). No login gate — a local profile is all that's needed.
 */
import {themedStyles} from '@/theme/themed';
import React, {useCallback, useEffect} from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {NavigationContainer, DefaultTheme, DarkTheme, useFocusEffect} from '@react-navigation/native';
import type {NavigationState} from '@react-navigation/native';
import Reanimated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {Linking} from 'react-native';
import {parseLink, parseGroupLink} from '@/services/inviteLink';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {colors, themeInfo} from '@/theme/theme';
import {themed, useThemeVersion} from '@/theme/themed';
import {launchReady} from '@/theme/launch';
import {initStorage} from '@/services/storage';
import {useSettingsStore} from '@/store/settingsStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useLockStore} from '@/store/lockStore';
import {LockGate, DialogHost, CallBar} from '@/components';
import {useSessionStore} from '@/store/sessionStore';
import {bootstrapMesh} from '@/services/bootstrap';
import type {RootStackParamList, MainTabParamList} from '@/navigation/types';
import {TabBar} from '@/navigation/TabBar';
import {navigationRef} from '@/navigation/ref';

import OnboardingScreen from '@/screens/OnboardingScreen';
import NearbyScreen from '@/screens/NearbyScreen';
import SOSScreen from '@/screens/SOSScreen';
import ChatListScreen from '@/screens/ChatListScreen';
import ConversationScreen from '@/screens/ConversationScreen';
import CreateGroupScreen from '@/screens/CreateGroupScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import EditProfileScreen from '@/screens/EditProfileScreen';
import AboutScreen from '@/screens/AboutScreen';
import SafetyNotesScreen from '@/screens/SafetyNotesScreen';
import TrustedCircleScreen from '@/screens/TrustedCircleScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import CallScreen from '@/screens/CallScreen';
import ContactScreen from '@/screens/ContactScreen';
import GroupInfoScreen from '@/screens/GroupInfoScreen';
import SettingsNotificationsScreen from '@/screens/SettingsNotificationsScreen';
import SettingsPrivacyScreen from '@/screens/SettingsPrivacyScreen';
import SettingsChatLockScreen from '@/screens/SettingsChatLockScreen';
import MessageInfoScreen from '@/screens/MessageInfoScreen';
import MediaGalleryScreen from '@/screens/MediaGalleryScreen';
import AddGroupMembersScreen from '@/screens/AddGroupMembersScreen';
import GroupInviteScreen from '@/screens/GroupInviteScreen';
import JoinGroupScreen from '@/screens/JoinGroupScreen';
import SettingsCallsScreen from '@/screens/SettingsCallsScreen';
import SettingsStorageScreen from '@/screens/SettingsStorageScreen';
import BlockedScreen from '@/screens/BlockedScreen';
import StarredScreen from '@/screens/StarredScreen';
import SettingsChatsScreen from '@/screens/SettingsChatsScreen';
import AccountsScreen from '@/screens/AccountsScreen';
import VerifyPhoneScreen from '@/screens/VerifyPhoneScreen';
import SettingsAppearanceScreen from '@/screens/SettingsAppearanceScreen';
import NewSecretChatScreen from '@/screens/NewSecretChatScreen';
import NewChatScreen from '@/screens/NewChatScreen';
import SettingsInternetScreen from '@/screens/SettingsInternetScreen';
import FindPeopleScreen from '@/screens/FindPeopleScreen';
import MyCodeScreen from '@/screens/MyCodeScreen';
import StatusPrivacyScreen from '@/screens/StatusPrivacyScreen';
import InternetCallScreen from '@/screens/InternetCallScreen';
import StatusScreen from '@/screens/StatusScreen';
import CallsScreen from '@/screens/CallsScreen';
import StatusComposerScreen from '@/screens/StatusComposerScreen';
import StatusViewerScreen from '@/screens/StatusViewerScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

/** A tab's page eases in (fades and rises a little) every time it is opened, instead of switching instantly. */
function TabFade({children}: {children: React.ReactNode}) {
  const o = useSharedValue(0);
  useFocusEffect(
    useCallback(() => {
      o.value = 0;
      o.value = withTiming(1, {duration: 260, easing: Easing.out(Easing.cubic)});
    }, [o]),
  );
  const style = useAnimatedStyle(() => ({opacity: o.value, transform: [{translateY: (1 - o.value) * 10}]}));
  return <Reanimated.View style={[{flex: 1}, style]}>{children}</Reanimated.View>;
}
function tabScreen<P extends object>(C: React.ComponentType<P>) {
  return function TabScreen(props: P) {
    useThemeVersion(); // repaint in place when the theme changes
    return (
      <TabFade>
        <C {...props} />
      </TabFade>
    );
  };
}
const ChatsTabScreen = tabScreen(ChatListScreen);
const StatusTabScreen = tabScreen(StatusScreen);
const CallsTabScreen = tabScreen(CallsScreen);
const NearbyTabScreen = tabScreen(NearbyScreen);
const SOSTabScreen = tabScreen(SOSScreen);

// A function, so it reads the colours of the current theme each time the app is drawn.
const makeNavTheme = () => ({
  ...(themeInfo.isDark ? DarkTheme : DefaultTheme),
  colors: {
    ...(themeInfo.isDark ? DarkTheme : DefaultTheme).colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
});

/** Where the user was in the app, kept so a theme change repaints on the very same screen. */
const navSnapshot: {state?: NavigationState; launched: boolean} = {launched: false};

function MainTabs() {
  useThemeVersion();
  // Bring the whole mesh + social layer online once, for the session.
  useEffect(() => {
    bootstrapMesh();
  }, []);

  return (
    <Tab.Navigator
      tabBar={props => <TabBar {...props} />}
      initialRouteName="ChatsTab"
      sceneContainerStyle={{backgroundColor: colors.bg}}
      screenOptions={{headerShown: false}}>
      <Tab.Screen name="ChatsTab" component={ChatsTabScreen} />
      <Tab.Screen name="StatusTab" component={StatusTabScreen} />
      <Tab.Screen name="CallsTab" component={CallsTabScreen} />
      <Tab.Screen name="NearbyTab" component={NearbyTabScreen} />
      <Tab.Screen name="SOSTab" component={SOSTabScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const {hydrated, isReady, hydrate} = useSessionStore();
  useThemeVersion(); // the navigator, header colours and status bar are re-read when the theme changes

  // An invite link (pulse://add?...) opens "Find people" with that person ready to connect.
  useEffect(() => {
    const open = (url: string | null) => {
      const inv = url ? parseLink(url) : null;
      if (inv) {
        const go = () => navigationRef.isReady() && navigationRef.navigate('FindPeople', {invite: inv});
        if (!go()) {
          setTimeout(go, 1500);
        }
      }
      // A group's link (pulse://group?...) opens the "join this group" screen.
      const grp = url ? parseGroupLink(url) : null;
      if (grp) {
        const go = () => navigationRef.isReady() && navigationRef.navigate('JoinGroup', {id: grp.id, admin: grp.admin, name: grp.name});
        if (!go()) {
          setTimeout(go, 1500);
        }
      }
    };
    if (!navSnapshot.launched) {
      void Linking.getInitialURL().then(open); // only at real start-up, not again when the theme repaints the app
    }
    const sub = Linking.addEventListener('url', e => open(e.url));
    return () => sub.remove();
  }, []);

  // The blue start-up screen (owned by Boot) is told the first screen is drawn, and fades itself away.
  const hideCover = () => {
    navSnapshot.launched = true;
    setTimeout(launchReady, 250);
  };

  useEffect(() => {
    void initStorage().then(() => {
      useSettingsStore.getState().hydrate();
      usePrefsStore.getState().hydrate();
      useLockStore.getState().hydrate();
      hydrate();
    });
  }, [hydrate]);

  if (!hydrated) {
    // Still loading: stay on plain brand blue, exactly like the start-up screen above it (no spinner, no second logo).
    return <View style={styles.splash} />;
  }

  const detailOptions = {
    // Transparent: the soft background glow runs behind the title, so there is no hard line under it.
    // Screen leaves room for the header itself.
    headerTransparent: true,
    animation: 'slide_from_right' as const,
    headerTintColor: colors.text,
    headerShadowVisible: false,
    headerTitleStyle: {fontWeight: '700' as const, color: colors.text},
    contentStyle: {backgroundColor: colors.bg},
  };

  return (
    <GestureHandlerRootView style={styles.root}>
    <SafeAreaProvider>
      <StatusBar barStyle={themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={styles.root}>
      <NavigationContainer ref={navigationRef} theme={makeNavTheme()} initialState={navSnapshot.state} onStateChange={s => { navSnapshot.state = s; }} onReady={hideCover}>
        <Stack.Navigator screenOptions={detailOptions}>
          {!isReady ? (
            <>
              <Stack.Screen name="Onboarding" component={themed(OnboardingScreen)} options={{headerShown: false}} />
              <Stack.Screen name="VerifyPhone" component={themed(VerifyPhoneScreen)} options={{title: 'Verify phone'}} />
            </>
          ) : (
            <>
              <Stack.Screen name="Main" component={themed(MainTabs)} options={{headerShown: false}} />
              {/* One screen per chat: opening another chat never reuses this one (no draft, selection or scroll carried over). */}
              <Stack.Screen name="Conversation" component={themed(ConversationScreen)} options={{title: 'Chat'}} getId={({params}) => params?.conversationId} />
              <Stack.Screen name="MessageInfo" component={themed(MessageInfoScreen)} options={{title: 'Message info'}} />
              <Stack.Screen name="Media" component={themed(MediaGalleryScreen)} options={{title: 'Media'}} />
              <Stack.Screen name="AddGroupMembers" component={themed(AddGroupMembersScreen)} options={{title: 'Add people'}} />
              <Stack.Screen name="GroupInvite" component={themed(GroupInviteScreen)} options={{title: 'Invite to group'}} />
              <Stack.Screen name="JoinGroup" component={themed(JoinGroupScreen)} options={{title: 'Join group'}} />
              <Stack.Screen name="CreateGroup" component={themed(CreateGroupScreen)} options={{title: 'New Group'}} />
              <Stack.Screen name="EditProfile" component={themed(EditProfileScreen)} options={{title: 'Edit Profile'}} />
              <Stack.Screen name="TrustedCircle" component={themed(TrustedCircleScreen)} options={{title: 'Trusted Circle'}} />
              <Stack.Screen name="Settings" component={themed(SettingsScreen)} options={{title: 'Settings'}} />
              <Stack.Screen name="About" component={themed(AboutScreen)} options={{title: 'About'}} />
              <Stack.Screen name="Contact" component={themed(ContactScreen)} options={{title: 'Profile'}} />
              <Stack.Screen name="GroupInfo" component={themed(GroupInfoScreen)} options={{title: 'Group info'}} />
              <Stack.Screen name="SettingsNotifications" component={themed(SettingsNotificationsScreen)} options={{title: 'Notifications'}} />
              <Stack.Screen name="SettingsPrivacy" component={themed(SettingsPrivacyScreen)} options={{title: 'Privacy & security'}} />
              <Stack.Screen name="SettingsChatLock" component={themed(SettingsChatLockScreen)} options={{title: 'Chat lock'}} />
              <Stack.Screen name="SettingsCalls" component={themed(SettingsCallsScreen)} options={{title: 'Calls'}} />
              <Stack.Screen name="SettingsStorage" component={themed(SettingsStorageScreen)} options={{title: 'Storage & data'}} />
              <Stack.Screen name="Blocked" component={themed(BlockedScreen)} options={{title: 'Blocked people'}} />
              <Stack.Screen name="Starred" component={themed(StarredScreen)} options={{title: 'Starred messages'}} />
              <Stack.Screen name="SettingsChats" component={themed(SettingsChatsScreen)} options={{title: 'Chats'}} />
              <Stack.Screen name="Accounts" component={themed(AccountsScreen)} options={{title: 'Accounts'}} />
              <Stack.Screen name="Profile" component={themed(ProfileScreen)} options={{title: 'My profile'}} />
              <Stack.Screen name="VerifyPhone" component={themed(VerifyPhoneScreen)} options={{title: 'Verify phone'}} />
              <Stack.Screen name="SettingsAppearance" component={themed(SettingsAppearanceScreen)} options={{title: 'Appearance'}} />
              <Stack.Screen name="NewSecretChat" component={themed(NewSecretChatScreen)} options={{title: 'New secret chat'}} />
              <Stack.Screen name="FindPeople" component={themed(FindPeopleScreen)} options={{title: 'Find people'}} />
              <Stack.Screen name="StatusPrivacy" component={themed(StatusPrivacyScreen)} options={{title: 'Status privacy'}} />
              <Stack.Screen name="MyCode" component={themed(MyCodeScreen)} options={{title: 'My code'}} />
              <Stack.Screen name="InternetCall" component={themed(InternetCallScreen)} options={{headerShown: false, presentation: 'fullScreenModal', animation: 'fade'}} />
              <Stack.Screen name="SettingsInternet" component={themed(SettingsInternetScreen)} options={{title: 'Internet'}} />
              <Stack.Screen name="NewChat" component={themed(NewChatScreen)} options={{title: 'New chat'}} />
              <Stack.Screen name="SafetyNotes" component={themed(SafetyNotesScreen)} options={{title: 'Safety notes'}} />
              <Stack.Screen name="StatusComposer" component={themed(StatusComposerScreen)} options={{headerShown: false, animation: 'slide_from_bottom'}} />
              <Stack.Screen name="StatusViewer" component={themed(StatusViewerScreen)} options={{headerShown: false, presentation: 'fullScreenModal', animation: 'fade'}} />
              <Stack.Screen
                name="Call"
                component={themed(CallScreen)}
                options={{headerShown: false, presentation: 'fullScreenModal', animation: 'fade'}}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {/* A call is still going while you look at something else: a green pill at the top takes you back to it. */}
      {isReady ? <CallBar /> : null}
      {/* Pulse's own confirm / notice pop-ups (instead of the grey system alert). */}
      <DialogHost />
      {/* Drawn last so the PIN screen covers everything when the app is locked. */}
      {isReady ? <LockGate /> : null}
      </View>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  splash: {flex: 1, backgroundColor: '#2F8BFF', alignItems: 'center', justifyContent: 'center'},
}));
