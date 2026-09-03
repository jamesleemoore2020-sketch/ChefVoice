param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$GradleArgs
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$GradleVersion = '9.5.0'
$GradleSha256 = '553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746'
$CacheRoot = Join-Path $env:USERPROFILE '.chefvoice\gradle'
$GradleHome = Join-Path $CacheRoot ("gradle-{0}" -f $GradleVersion)
$GradleBat = Join-Path $GradleHome 'bin\gradle.bat'

function Use-Java {
    $candidates = @()
    # Prefer Android Studio's bundled runtime because it is known to work with the
    # installed Android command-line tools. Fall back to JAVA_HOME afterwards.
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr') }
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Android\Android Studio\jbr') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr') }
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }

    foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
        $javaExe = Join-Path $candidate 'bin\java.exe'
        if (Test-Path $javaExe) {
            $env:JAVA_HOME = $candidate
            $env:Path = (Join-Path $candidate 'bin') + ';' + $env:Path
            return
        }
    }

    if (-not (Get-Command java.exe -ErrorAction SilentlyContinue)) {
        throw @"
Java was not found.
Install Android Studio, or install JDK 17+, then run BUILD_AND_INSTALL.cmd again.
"@
    }
}

Use-Java

if (-not (Test-Path $GradleBat)) {
    New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
    $zipPath = Join-Path $CacheRoot ("gradle-{0}-bin.zip" -f $GradleVersion)
    $downloadUrl = "https://services.gradle.org/distributions/gradle-$GradleVersion-bin.zip"

    Write-Host ""
    Write-Host "Gradle $GradleVersion is not cached yet." -ForegroundColor Yellow
    Write-Host "Downloading the official Gradle distribution (one-time setup)..."
    Write-Host $downloadUrl -ForegroundColor DarkGray

    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    if (Test-Path $GradleHome) { Remove-Item -Recurse -Force $GradleHome }

    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
        $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $GradleSha256) {
            throw "Gradle distribution checksum mismatch. Expected $GradleSha256 but received $actualHash."
        }
        Expand-Archive -LiteralPath $zipPath -DestinationPath $CacheRoot -Force
    }
    catch {
        if (Test-Path $zipPath) { Remove-Item -Force $zipPath -ErrorAction SilentlyContinue }
        throw "Could not download/extract Gradle $GradleVersion. Check the internet connection and try again. $($_.Exception.Message)"
    }
    finally {
        if (Test-Path $zipPath) { Remove-Item -Force $zipPath -ErrorAction SilentlyContinue }
    }
}

if (-not (Test-Path $GradleBat)) {
    throw "Gradle bootstrap failed: $GradleBat was not created."
}

& $GradleBat @GradleArgs
exit $LASTEXITCODE
