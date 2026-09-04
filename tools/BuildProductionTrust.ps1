$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SdkApi = 36

# Single source of truth. The version was typed here as well as in
# app/build.gradle.kts, and both had drifted from README.md.
$GradleFile = Join-Path $ProjectRoot 'app\build.gradle.kts'
$GradleText = Get-Content -LiteralPath $GradleFile -Raw
if ($GradleText -notmatch 'versionName\s*=\s*"([^"]+)"') { throw "Could not read versionName from $GradleFile." }
$Version = $Matches[1]
if ($GradleText -notmatch 'versionCode\s*=\s*(\d+)') { throw "Could not read versionCode from $GradleFile." }
$VersionCode = [int]$Matches[1]

# Play distributes App Bundles. assembleRelease produced a universal APK that
# carried the WebRTC native libraries for every ABI.
$AabInput = Join-Path $ProjectRoot 'app\build\outputs\bundle\release\app-release.aab'
$ApkInput = Join-Path $ProjectRoot 'app\build\outputs\apk\release\app-release.apk'
$AabOutput = Join-Path $ProjectRoot "ChefVoice-v$Version-Production.aab"
$ApkOutput = Join-Path $ProjectRoot "ChefVoice-v$Version-Production.apk"
$HashOutput = "$AabOutput.sha256"

function Find-AndroidSdk {
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk') }
    if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk') }
    $candidates += 'C:\Android\Sdk'
    foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
        if ((Test-Path (Join-Path $candidate "platforms\android-$SdkApi\android.jar"))) { return (Resolve-Path $candidate).Path }
    }
    return $null
}

function Require-Secret([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing required release-signing environment variable: $Name" }
    return $value
}

function Find-LatestBuildTool([string]$Sdk, [string]$ExeName) {
    $root = Join-Path $Sdk 'build-tools'
    if (-not (Test-Path $root)) { return $null }
    $candidate = Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name -Descending | ForEach-Object {
        $path = Join-Path $_.FullName $ExeName
        if (Test-Path $path) { $path }
    } | Select-Object -First 1
    return $candidate
}

Write-Host ''
Write-Host "ChefVoice Android v$Version (versionCode $VersionCode) - signed production release" -ForegroundColor Cyan
$sdk = Find-AndroidSdk
if (-not $sdk) { throw "Android SDK API $SdkApi was not found. Install Android 16 / API 36 in Android Studio, then rerun this file." }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
Set-Content -LiteralPath (Join-Path $ProjectRoot 'local.properties') -Value ("sdk.dir={0}" -f ($sdk -replace '\\','/')) -Encoding ASCII

$storeFile = Require-Secret 'CHEFVOICE_RELEASE_STORE_FILE'
$null = Require-Secret 'CHEFVOICE_RELEASE_STORE_PASSWORD'
$null = Require-Secret 'CHEFVOICE_RELEASE_KEY_ALIAS'
$null = Require-Secret 'CHEFVOICE_RELEASE_KEY_PASSWORD'
if (-not (Test-Path $storeFile)) { throw "Release keystore does not exist: $storeFile" }

Push-Location $ProjectRoot
try {
    # bundleRelease produces the Play upload artifact; assembleRelease produces the
    # APK the signature gate below inspects. Both come from the same signed config.
    & (Join-Path $ProjectRoot 'gradlew.bat') --no-daemon clean bundleRelease assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Gradle release build failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

if (-not (Test-Path $AabInput)) { throw "Release build completed without an App Bundle: $AabInput" }
if (-not (Test-Path $ApkInput)) { throw "Release build completed without a signed APK: $ApkInput" }
$apksigner = Find-LatestBuildTool $sdk 'apksigner.bat'
if (-not $apksigner) { throw 'Android apksigner was not found under SDK build-tools.' }
$priorErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$verify = & $apksigner verify --verbose --print-certs $ApkInput 2>&1
$apksignerExitCode = $LASTEXITCODE
$ErrorActionPreference = $priorErrorActionPreference
# apksigner prints harmless JDK "restricted method" warnings to stderr on newer JDKs;
# 2>&1 merges those into $verify, so only the real exit code decides pass/fail.
if ($apksignerExitCode -ne 0) { throw "APK signature verification failed.`n$($verify -join [Environment]::NewLine)" }
$verifyText = $verify -join [Environment]::NewLine
if ($verifyText -match 'Android Debug') { throw 'Release gate refused an APK signed with the Android Debug certificate.' }

Copy-Item -Force $AabInput $AabOutput
Copy-Item -Force $ApkInput $ApkOutput
$hash = (Get-FileHash -LiteralPath $AabOutput -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath $HashOutput -Value "$hash  ChefVoice-v$Version-Production.aab" -Encoding ASCII

$mapping = Join-Path $ProjectRoot 'app\build\outputs\mapping\release\mapping.txt'
$mappingOutput = Join-Path $ProjectRoot "ChefVoice-v$Version-mapping.txt"
if (Test-Path $mapping) { Copy-Item -Force $mapping $mappingOutput }

Write-Host ''
Write-Host "Signed production build v$Version (versionCode $VersionCode):" -ForegroundColor Green
Write-Host "  Upload to Play : $AabOutput"
Write-Host "  Sideload/test  : $ApkOutput"
if (Test-Path $mappingOutput) { Write-Host "  R8 mapping     : $mappingOutput  (upload with the release)" }
Write-Host "SHA-256 (aab): $hash"
Write-Host ($verify | Select-String 'Signer #1 certificate DN|Verified using v2 scheme|Verified using v3 scheme' | ForEach-Object { $_.Line })
