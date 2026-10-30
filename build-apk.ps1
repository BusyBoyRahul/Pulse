# ============================================================
#  Build the Pulse standalone APK (one command).
#  Right-click this file -> "Run with PowerShell",  OR
#  in a terminal:   cd C:\Users\16692\Desktop\Pulse ;  .\build-apk.ps1
# ============================================================

$ErrorActionPreference = "Stop"

# Toolchain (must match docs/NATIVE_SETUP.md)
$env:JAVA_HOME    = "C:\Users\16692\.jdks\jdk-17.0.20+8"
$env:ANDROID_HOME = "C:\Users\16692\AppData\Local\Android\Sdk"

Write-Host "Building Pulse APK... (this takes a few minutes)" -ForegroundColor Cyan

Set-Location "$PSScriptRoot\android"
.\gradlew.bat :app:assembleRelease --no-daemon

$apk = "$PSScriptRoot\android\app\build\outputs\apk\release\app-release.apk"
if (Test-Path $apk) {
    # Drop a friendly copy on the Desktop.
    Copy-Item $apk "$env:USERPROFILE\Desktop\Pulse.apk" -Force
    Write-Host ""
    Write-Host "DONE. Your app is here:" -ForegroundColor Green
    Write-Host "   $env:USERPROFILE\Desktop\Pulse.apk"
    Write-Host "Copy that file to any Android phone and open it to install."
} else {
    Write-Host "Build finished but the APK was not found. Check the messages above." -ForegroundColor Yellow
}
