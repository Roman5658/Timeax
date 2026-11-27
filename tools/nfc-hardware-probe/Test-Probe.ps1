$ErrorActionPreference = 'Stop'
$build = Join-Path ([System.IO.Path]::GetTempPath()) ('timeax-nfc-probe-test-' + [guid]::NewGuid().ToString('N'))
New-Item -Path $build -ItemType Directory | Out-Null
$javaFiles = @(
    'windows/PcscReaderProbe.java',
    'android/app/src/main/java/pl/timeax/hardwareprobe/HttpsObservation.java',
    'tests/PcscReaderProbeTest.java',
    'tests/HttpsObservationTest.java'
) | ForEach-Object { Join-Path $PSScriptRoot $_ }
& javac --release 17 -encoding UTF-8 -d $build @javaFiles
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& java -cp $build PcscReaderProbeTest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& java -cp $build pl.timeax.hardwareprobe.HttpsObservationTest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$manifestPath = Join-Path $PSScriptRoot 'android/app/src/main/AndroidManifest.xml'
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$permissions = $manifest.SelectNodes('/manifest/uses-permission')
if ($permissions.Count -ne 1 -or $permissions[0].GetAttribute('name','http://schemas.android.com/apk/res/android') -ne 'android.permission.NFC') {
    throw 'Probe must request only NFC permission.'
}
foreach ($locale in 'values','values-ru') {
    [xml]$resources = Get-Content -LiteralPath (Join-Path $PSScriptRoot "android/app/src/main/res/$locale/strings.xml") -Raw -Encoding UTF8
    if ($resources.resources.string.Count -lt 15) { throw 'Missing localized resources.' }
}
Write-Output 'Restricted Android manifest and localized resource XML checked'
