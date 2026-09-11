$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PackageName = 'com.chefvoice.app'
$MainActivity = 'com.chefvoice.app/.MainActivity'
$ApkPath = Join-Path $ProjectRoot 'app\build\outputs\apk\debug\app-debug.apk'
$LogPath = Join-Path $ProjectRoot 'build_install.log'
$SdkApi = 36
$BuildToolsVersion = '36.0.0'

function Banner([string]$text) {
    Write-Host ""
    Write-Host ('=' * 72) -ForegroundColor DarkGray
    Write-Host $text -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor DarkGray
}

function Find-AndroidSdk {
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk') }
    if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk') }
    $candidates += 'C:\Android\Sdk'

    foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
        if ((Test-Path $candidate) -and ((Test-Path (Join-Path $candidate 'platform-tools')) -or (Test-Path (Join-Path $candidate 'platforms')) -or (Test-Path (Join-Path $candidate 'cmdline-tools')))) {
            return (Resolve-Path $candidate).Path
        }
    }
    return $null
}

function Find-AndroidCli([string]$sdk) {
    $cmdRoot = Join-Path $sdk 'cmdline-tools'
    if (-not (Test-Path $cmdRoot)) { return $null }

    $candidateDirs = @()
    $latest = Join-Path $cmdRoot 'latest\bin'
    if (Test-Path $latest) { $candidateDirs += $latest }
    $candidateDirs += Get-ChildItem $cmdRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin' }

    foreach ($dir in $candidateDirs | Select-Object -Unique) {
        foreach ($name in @('android.bat','android.cmd','android.exe','android')) {
            $candidate = Join-Path $dir $name
            if (Test-Path $candidate) { return $candidate }
        }
    }
    return $null
}

function Find-SdkManager([string]$sdk) {
    $latest = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
    if (Test-Path $latest) { return $latest }

    $cmdRoot = Join-Path $sdk 'cmdline-tools'
    if (Test-Path $cmdRoot) {
        $found = Get-ChildItem $cmdRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'bin\sdkmanager.bat' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($found) { return $found }
    }
    return $null
}

function Get-MissingSdkPackages([string]$sdk) {
    $missing = @()
    if (-not (Test-Path (Join-Path $sdk 'platform-tools\adb.exe'))) { $missing += 'platform-tools' }
    if (-not (Test-Path (Join-Path $sdk ("platforms\android-{0}" -f $SdkApi)))) { $missing += ("platforms;android-{0}" -f $SdkApi) }
    if (-not (Test-Path (Join-Path $sdk ("build-tools\{0}" -f $BuildToolsVersion)))) { $missing += ("build-tools;{0}" -f $BuildToolsVersion) }
    return @($missing)
}

function Install-MissingSdkPackages([string]$sdk, [string[]]$missingPackages) {
    if ($missingPackages.Count -eq 0) { return }

    # Prefer the new Android CLI when present. Current command-line tools warn
    # that sdkmanager is deprecated and recommend `android sdk` instead.
    $androidCli = Find-AndroidCli $sdk
    if ($androidCli) {
        $cliPackages = @()
        foreach ($pkg in $missingPackages) {
            if ($pkg -eq 'platform-tools') { $cliPackages += 'platform-tools' }
            elseif ($pkg -like 'platforms;android-*') { $cliPackages += ($pkg -replace '^platforms;','platforms/') }
            elseif ($pkg -like 'build-tools;*') { $cliPackages += ($pkg -replace '^build-tools;','build-tools/') }
        }

        Write-Host 'Using the current Android CLI to install missing SDK packages...' -ForegroundColor Yellow
        $androidArgs = @('sdk', 'install') + $cliPackages
        & $androidCli @androidArgs
        if ($LASTEXITCODE -eq 0) { return }

        Write-Host 'Android CLI installation did not complete; trying sdkmanager fallback...' -ForegroundColor Yellow
    }

    $sdkManager = Find-SdkManager $sdk
    if ($sdkManager) {
        Write-Host 'Using sdkmanager fallback...' -ForegroundColor Yellow
        & $sdkManager @missingPackages
        if ($LASTEXITCODE -eq 0) { return }
    }

    throw @"
Android SDK package installation failed.
Open Android Studio -> Tools -> SDK Manager and install:
  - Android 16 / API 36 SDK Platform
  - Android SDK Build-Tools $BuildToolsVersion
  - Android SDK Platform-Tools
Then click Apply/OK, accept any license prompts, and run BUILD_AND_INSTALL.cmd again.
"@
}

try {
    if (Test-Path $LogPath) { Remove-Item -Force $LogPath -ErrorAction SilentlyContinue }
    Start-Transcript -Path $LogPath -Force | Out-Null

    Banner 'ChefVoice v0.10.1 - Production Trust - Build & Install'
    Write-Host "Project: $ProjectRoot"

    $sdk = Find-AndroidSdk
    if (-not $sdk) {
        throw @"
Android SDK was not found.
Open Android Studio -> Tools -> SDK Manager, install the Android SDK,
then run BUILD_AND_INSTALL.cmd again.
"@
    }

    Write-Host "Android SDK: $sdk" -ForegroundColor Green
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk

    # Gradle also reads this file, so make the SDK location explicit.
    $sdkForProperties = $sdk -replace '\\','/'
    Set-Content -LiteralPath (Join-Path $ProjectRoot 'local.properties') -Value ("sdk.dir={0}" -f $sdkForProperties) -Encoding ASCII

    Banner 'Checking stable Android SDK packages'
    $missingPackages = Get-MissingSdkPackages $sdk
    if ($missingPackages.Count -gt 0) {
        Write-Host ('Missing: ' + ($missingPackages -join ', ')) -ForegroundColor Yellow
        Install-MissingSdkPackages $sdk $missingPackages

        $stillMissing = Get-MissingSdkPackages $sdk
        if ($stillMissing.Count -gt 0) {
            throw ('SDK installation finished but these packages are still missing: ' + ($stillMissing -join ', '))
        }
    }
    else {
        Write-Host 'Required SDK packages are present.' -ForegroundColor Green
    }

    Banner 'Building debug APK'
    $gradlew = Join-Path $ProjectRoot 'gradlew.bat'
    if (-not (Test-Path $gradlew)) { throw "gradlew.bat is missing: $gradlew" }

    Push-Location $ProjectRoot
    try {
        # No --no-daemon/clean here: this is the fast iterative dev loop, so let
        # Gradle keep its daemon (and the Kotlin compiler daemon it manages) warm
        # across runs and rebuild incrementally. If a build ever looks stale,
        # run `gradlew.bat clean` once by hand.
        & $gradlew assembleDebug
        $buildExit = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($buildExit -ne 0) {
        throw "Gradle build failed with exit code $buildExit. See build_install.log for the full output."
    }

    if (-not (Test-Path $ApkPath)) {
        throw "Build reported success but the APK was not found at: $ApkPath"
    }

    Write-Host ""
    Write-Host 'APK built successfully:' -ForegroundColor Green
    Write-Host $ApkPath -ForegroundColor White

    Banner 'Installing on connected Android device'
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    if (-not (Test-Path $adb)) {
        Write-Host 'ADB is not available, so installation is skipped.' -ForegroundColor Yellow
        Start-Process explorer.exe -ArgumentList "/select,`"$ApkPath`""
        exit 0
    }

    & $adb start-server | Out-Null
    $deviceOutput = & $adb devices
    $serials = @()
    $unauthorized = @()
    foreach ($line in $deviceOutput) {
        if ($line -match '^([^\s]+)\s+device$') { $serials += $Matches[1] }
        elseif ($line -match '^([^\s]+)\s+unauthorized$') { $unauthorized += $Matches[1] }
    }

    if ($serials.Count -eq 0) {
        if ($unauthorized.Count -gt 0) {
            Write-Host 'A phone is connected but USB debugging is not authorized.' -ForegroundColor Yellow
            Write-Host 'Unlock the phone, tap Allow on the USB debugging/RSA prompt, then run this file again.'
        }
        else {
            Write-Host 'No authorized Android device is connected.' -ForegroundColor Yellow
            Write-Host 'The APK IS built. Connect your phone with USB debugging enabled and run this file again.'
        }
        Start-Process explorer.exe -ArgumentList "/select,`"$ApkPath`""
        exit 0
    }

    $serial = $serials[0]
    if ($serials.Count -gt 1) {
        Write-Host "Multiple devices detected; using the first one: $serial" -ForegroundColor Yellow
    }
    else {
        Write-Host "Device: $serial" -ForegroundColor Green
    }

    $installOutput = & $adb -s $serial install -r $ApkPath 2>&1
    $installExit = $LASTEXITCODE
    $installText = ($installOutput | Out-String)
    Write-Host $installText

    if ($installExit -ne 0 -and $installText -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') {
        Write-Host 'The existing ChefVoice app was signed with a different key.' -ForegroundColor Yellow
        Write-Host 'Android cannot update it in-place.' -ForegroundColor Yellow
        $answer = Read-Host 'Uninstall the old ChefVoice app and install this build? This clears the app data. Type Y to continue'
        if ($answer -match '^[Yy]$') {
            & $adb -s $serial uninstall $PackageName
            if ($LASTEXITCODE -ne 0) { throw 'Could not uninstall the old ChefVoice package.' }
            & $adb -s $serial install $ApkPath
            if ($LASTEXITCODE -ne 0) { throw 'APK installation failed after uninstalling the old package.' }
            $installExit = 0
        }
    }

    if ($installExit -ne 0) {
        throw 'APK installation failed. Review the ADB error above and build_install.log.'
    }

    Banner 'Launching ChefVoice'
    & $adb -s $serial shell am start -n $MainActivity | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'ChefVoice installed, but Android could not launch MainActivity automatically.' }

    Write-Host ""
    Write-Host 'SUCCESS - ChefVoice built, installed and launched.' -ForegroundColor Green
    Write-Host "Log: $LogPath" -ForegroundColor DarkGray
    exit 0
}
catch {
    Write-Host ""
    Write-Host 'BUILD / INSTALL FAILED' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Full log: $LogPath" -ForegroundColor Yellow
    exit 1
}
finally {
    try { Stop-Transcript | Out-Null } catch { }
}
