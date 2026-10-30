# Native configuration (Android + iOS)

> The `android/` and `ios/` native folders are **already generated and committed**
> in this repo, with the permissions below applied and the Bluetooth mesh wired
> up. This document records how they were produced and the toolchain they need.

The folders were generated once with the React Native CLI, then the `android/`
and `ios/` output was copied in:

```bash
npx @react-native-community/cli@latest init Pulse --version 0.75.4 --skip-install
```

## Build toolchain (important — version-sensitive)

React Native 0.75 is picky about versions. The working setup is:

| Tool | Version | Notes |
|------|---------|-------|
| **JDK** | **17** | RN 0.75's Gradle 8.8 rejects JDK 21/25 ("Unsupported class file major version"). A newer Android Studio bundles JDK 25 — do **not** use it for Gradle. |
| Android SDK Platform | 34 | `compileSdk`/`targetSdk` = 34 |
| Build-tools | 34.0.0 | |
| **NDK** | **26.1.10909125** | Required by `react-native-screens` (C++). Install via `sdkmanager`. |
| CMake | 3.22.1 | Native build tool for the NDK. |

Point Gradle at JDK 17 in `android/gradle.properties`:

```properties
org.gradle.java.home=C:/path/to/jdk-17
```

Install the SDK bits headlessly:

```bash
sdkmanager "ndk;26.1.10909125" "cmake;3.22.1" "platforms;android-34" "build-tools;34.0.0"
```

## Storage note (no NDK for MMKV)

The app uses **AsyncStorage** (pure Java) rather than `react-native-mmkv`
(native C++) so the storage layer needs no extra native toolchain. The
`src/services/storage.ts` API is synchronous either way, so swapping back to
MMKV later (once the NDK is set up) is a drop-in change.

---

The permissions below are already applied to the committed manifest.

---

## Android — `android/app/src/main/AndroidManifest.xml`

Add inside `<manifest>` (above `<application>`):

```xml
<!-- BLE mesh: scan for + advertise to nearby Pulse nodes -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<!-- Legacy BLE (API < 31) -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

<!-- Location: required for BLE scan results + SOS geotag -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

<!-- Keep the mesh alive in the background -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
```

`minSdkVersion` should be **23+** (24 recommended). Set in
`android/build.gradle` → `buildscript.ext.minSdkVersion`.

---

## iOS — `ios/Pulse/Info.plist`

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Pulse uses Bluetooth to form an offline safety mesh with nearby phones, so alerts can reach help even without internet.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>Pulse attaches your location to an SOS so responders and your trusted circle know where to find you.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Pulse can relay safety alerts in the background so the mesh keeps working when your screen is off.</string>

<key>UIBackgroundModes</key>
<array>
  <string>bluetooth-central</string>
  <string>bluetooth-peripheral</string>
  <string>location</string>
</array>
```

> **iOS reality check:** background BLE advertising is heavily restricted by
> Apple — the local service UUID is placed in an "overflow" area and is only
> discoverable by other foregrounded iOS devices in some cases. Android is the
> primary silent-relay platform; iOS ships as foreground-mesh + "keep app open
> while walking" mode. This is called out in onboarding (Phase 1) and the store
> notes (Phase 7).

---

## Permission request order (handled in-app, Phase 1)

Pulse requests permissions **contextually**, one at a time, each with a plain
explanation screen before the OS dialog:

1. Notifications (so SOS confirmations can reach you)
2. Bluetooth (to join the mesh)
3. Location (to geotag an SOS)

Never request all at once — see `src/services/permissions.ts`.
