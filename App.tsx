/**
 * Pulse — root component.
 *
 * Offline-first: not onboarded -> Onboarding; otherwise straight into the app
 * (bottom-tab navigation). No login gate — a local profile is all that's needed.
 */
import React, {useEffect} from 'react';
import {ActivityIndicator, StatusBar, StyleSheet, View} from 'react-native';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {colors} from '@/theme/theme';
import {initStorage} from '@/services/storage';
import {useSettingsStore} from '@/store/settingsStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useLockStore} from '@/store/lockStore';
import {LockGate} from '@/components';
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
import SettingsCallsScreen from '@/screens/SettingsCallsScreen';
import SettingsStorageScreen from '@/screens/SettingsStorageScreen';
import BlockedScreen from '@/screens/BlockedScreen';
import StarredScreen from '@/screens/StarredScreen';
import SettingsChatsScreen from '@/screens/SettingsChatsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

function MainTabs() {
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
      <Tab.Screen name="ChatsTab" component={ChatListScreen} />
      <Tab.Screen name="NearbyTab" component={NearbyScreen} />
      <Tab.Screen name="SOSTab" component={SOSScreen} />
      <Tab.Screen name="NotesTab" component={SafetyNotesScreen} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const {hydrated, isReady, hydrate} = useSessionStore();

  useEffect(() => {
    void initStorage().then(() => {
      useSettingsStore.getState().hydrate();
      usePrefsStore.getState().hydrate();
      useLockStore.getState().hydrate();
      hydrate();
    });
  }, [hydrate]);

  if (!hydrated) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const detailOptions = {
    headerStyle: {backgroundColor: colors.bg},
    headerTintColor: colors.text,
    headerShadowVisible: false,
    headerTitleStyle: {fontWeight: '700' as const, color: colors.text},
    contentStyle: {backgroundColor: colors.bg},
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.root}>
      <NavigationContainer ref={navigationRef} theme={navTheme}>
        <Stack.Navigator screenOptions={detailOptions}>
          {!isReady ? (
            <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{headerShown: false}} />
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} options={{headerShown: false}} />
              <Stack.Screen name="Conversation" component={ConversationScreen} options={{title: 'Chat'}} />
              <Stack.Screen name="CreateGroup" component={CreateGroupScreen} options={{title: 'New Group'}} />
              <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{title: 'Edit Profile'}} />
              <Stack.Screen name="TrustedCircle" component={TrustedCircleScreen} options={{title: 'Trusted Circle'}} />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{title: 'Settings'}} />
              <Stack.Screen name="About" component={AboutScreen} options={{title: 'About'}} />
              <Stack.Screen name="Contact" component={ContactScreen} options={{title: 'Profile'}} />
              <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{title: 'Group info'}} />
              <Stack.Screen name="SettingsNotifications" component={SettingsNotificationsScreen} options={{title: 'Notifications'}} />
              <Stack.Screen name="SettingsPrivacy" component={SettingsPrivacyScreen} options={{title: 'Privacy & security'}} />
              <Stack.Screen name="SettingsCalls" component={SettingsCallsScreen} options={{title: 'Calls'}} />
              <Stack.Screen name="SettingsStorage" component={SettingsStorageScreen} options={{title: 'Storage & data'}} />
              <Stack.Screen name="Blocked" component={BlockedScreen} options={{title: 'Blocked people'}} />
              <Stack.Screen name="Starred" component={StarredScreen} options={{title: 'Starred messages'}} />
              <Stack.Screen name="SettingsChats" component={SettingsChatsScreen} options={{title: 'Chats'}} />
              <Stack.Screen
                name="Call"
                component={CallScreen}
                options={{headerShown: false, presentation: 'fullScreenModal', animation: 'fade'}}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {/* Drawn last so the PIN screen covers everything when the app is locked. */}
      {isReady ? <LockGate /> : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  splash: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center'},
});
