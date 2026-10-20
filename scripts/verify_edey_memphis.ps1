param(
  [string]$Url = "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-grizzlies",
  [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $root "artifacts"
$profile = Join-Path ([System.IO.Path]::GetTempPath()) ("edey-chart-chrome-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $profile | Out-Null
$chrome = $null
$socket = $null
$script:commandId = 0

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Receive-CdpMessage {
  $stream = [System.IO.MemoryStream]::new()
  try {
    do {
      $buffer = New-Object byte[] 65536
      $segment = [ArraySegment[byte]]::new($buffer)
      $cancel = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(20))
      try {
        $result = $socket.ReceiveAsync($segment, $cancel.Token).GetAwaiter().GetResult()
      } finally {
        $cancel.Dispose()
      }
      if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        throw "Chrome DevTools closed the WebSocket unexpectedly."
      }
      $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)
    $json = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
    return $json | ConvertFrom-Json
  } finally {
    $stream.Dispose()
  }
}

function Send-Cdp([string]$Method, [hashtable]$Params = @{}) {
  $script:commandId += 1
  $id = $script:commandId
  $json = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 100
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $null = $socket.SendAsync(
    $segment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [System.Threading.CancellationToken]::None
  ).GetAwaiter().GetResult()
  do {
    $message = Receive-CdpMessage
  } while ($message.id -ne $id)
  if ($message.error) { throw "CDP $Method failed: $($message.error.message)" }
  return $message.result
}

function Invoke-JavaScript([string]$Expression) {
  $result = Send-Cdp "Runtime.evaluate" @{
    expression = $Expression
    awaitPromise = $true
    returnByValue = $true
  }
  if ($result.exceptionDetails) {
    throw "Browser evaluation failed: $($result.exceptionDetails.text)"
  }
  return $result.result.value
}

function Wait-ForChart {
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  do {
    $state = Invoke-JavaScript @'
(() => {
  const root = document.querySelector('[data-edey-memphis-chart]');
  return root ? { state: root.dataset.edeyState || '', ranks: root.querySelectorAll('.edey-rank__row').length, panels: root.querySelectorAll('.edey-onoff__panel').length } : null;
})()
'@
    if ($state.state -eq "ready" -and $state.ranks -eq 4 -and $state.panels -eq 2) { return }
    if ($state.state -eq "error") { throw "Edey chart entered its error state." }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for the Edey chart."
}

function Save-ChartScreenshot([string]$Filename) {
  $clip = Invoke-JavaScript @'
(() => {
  const rect = document.querySelector('[data-edey-memphis-chart]').getBoundingClientRect();
  return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
})()
'@
  $result = Send-Cdp "Page.captureScreenshot" @{
    format = "png"
    captureBeyondViewport = $true
    fromSurface = $true
    clip = @{ x = [double]$clip.x; y = [double]$clip.y; width = [double]$clip.width; height = [double]$clip.height; scale = 1 }
  }
  [System.IO.File]::WriteAllBytes((Join-Path $artifacts $Filename), [Convert]::FromBase64String($result.data))
}

try {
  Write-Host "Browser check: starting Chrome"
  $arguments = @(
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-allow-origins=*", "--remote-debugging-port=0", "--user-data-dir=$profile", "about:blank"
  )
  $chrome = Start-Process -FilePath $ChromePath -ArgumentList $arguments -PassThru -WindowStyle Hidden
  $portFile = Join-Path $profile "DevToolsActivePort"
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path -LiteralPath $portFile)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw "Timed out waiting for Chrome DevTools." }
    Start-Sleep -Milliseconds 100
  }
  $port = (Get-Content -LiteralPath $portFile -TotalCount 1).Trim()
  $targets = Invoke-RestMethod "http://127.0.0.1:$port/json/list"
  $page = $targets | Where-Object type -eq "page" | Select-Object -First 1
  Assert-True ($null -ne $page) "No Chrome page target was available."
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $socket.Options.SetRequestHeader("Origin", "http://localhost")
  $null = $socket.ConnectAsync([uri]$page.webSocketDebuggerUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()

  Write-Host "Browser check: enabling domains"
  Send-Cdp "Page.enable" | Out-Null
  Send-Cdp "Runtime.enable" | Out-Null
  Send-Cdp "Emulation.setDeviceMetricsOverride" @{ width = 1280; height = 900; deviceScaleFactor = 1; mobile = $false } | Out-Null
  Send-Cdp "Page.addScriptToEvaluateOnNewDocument" @{ source = @'
window.__edeyBrowserErrors = [];
addEventListener('error', (event) => window.__edeyBrowserErrors.push(event.message || 'window error'));
addEventListener('unhandledrejection', (event) => window.__edeyBrowserErrors.push(String(event.reason || 'unhandled rejection')));
const originalConsoleError = console.error.bind(console);
console.error = (...args) => { window.__edeyBrowserErrors.push(args.map(String).join(' ')); originalConsoleError(...args); };
'@ } | Out-Null
  Send-Cdp "Page.navigate" @{ url = $Url } | Out-Null
  Write-Host "Browser check: waiting for chart"
  Wait-ForChart

  Write-Host "Browser check: desktop assertions"
  $desktop = Invoke-JavaScript @'
(() => {
  const root = document.querySelector('[data-edey-memphis-chart]');
  const chart = root.edeyMemphisChart;
  const rankErrors = [];
  root.querySelectorAll('.edey-rank__row').forEach((row, index) => {
    const state = chart.rankPositions[index];
    const expected = d3.scaleLinear().domain([72, 1]).range(state.range)(state.rank);
    const actual = Number(row.querySelector('.edey-rank__marker').getAttribute('cx'));
    if (Math.abs(actual - expected) > 0.01) rankErrors.push([state.key, actual, expected]);
  });
  const onOffErrors = [];
  chart.onOffStates.forEach((state, panelIndex) => {
    const panel = root.querySelectorAll('.edey-onoff__panel')[panelIndex];
    panel.querySelectorAll('.edey-onoff__mark').forEach((mark) => {
      const row = chart.onOff.find((candidate) => candidate.season === mark.dataset.season && candidate.split === mark.dataset.split);
      const actual = mark.tagName === 'circle' ? Number(mark.getAttribute('cx')) : Number(mark.getAttribute('x')) + Number(mark.getAttribute('width')) / 2;
      const expected = state.x(Number(row[state.key]));
      if (Math.abs(actual - expected) > 0.01) onOffErrors.push([state.key, mark.dataset.season, mark.dataset.split, actual, expected]);
    });
  });
  const style = getComputedStyle(root);
  const intro = root.parentElement.querySelector('.story--grizzlies-intro');
  const continuation = root.parentElement.querySelector('.story--grizzlies-continuation');
  return {
    busy: root.getAttribute('aria-busy'), peers: chart.peers.length, profile: chart.profile.length, onOff: chart.onOff.length,
    title: root.querySelector('.edey-package__title').textContent, subtitle: root.querySelector('.edey-package__subtitle').textContent,
    sample: root.querySelector('.edey-package__sample').textContent,
    rankRows: root.querySelectorAll('.edey-rank__row').length, rankHits: root.querySelectorAll('.edey-rank__hit').length,
    rankLabels: [...root.querySelectorAll('.edey-rank__label')].map((node) => node.textContent),
    profileTableRows: root.querySelectorAll('.edey-package__profile-table-wrap tbody tr').length,
    panels: root.querySelectorAll('.edey-onoff__panel').length, marks: root.querySelectorAll('.edey-onoff__mark').length,
    connectors: root.querySelectorAll('.edey-onoff__connector').length, valueLabels: root.querySelectorAll('.edey-onoff__value').length,
    deltas: [...root.querySelectorAll('.edey-onoff__delta')].map((node) => node.textContent),
    minutes: [...root.querySelectorAll('.edey-onoff__minutes')].map((node) => node.textContent),
    ratingRows: root.querySelectorAll('.edey-package__ratings-table tbody tr').length,
    ratingText: root.querySelector('.edey-package__ratings-table').textContent.replace(/\s+/g, ' ').trim(),
    notes: root.querySelector('.edey-package__notes').textContent.replace(/\s+/g, ' ').trim(),
    rankErrors, onOffErrors,
    theme: ['--team-identity', '--team-secondary', '--team-surface'].map((token) => style.getPropertyValue(token).trim().toLowerCase()),
    story: { intro: intro.children.length, continuation: continuation.children.length, adjacency: intro.nextElementSibling === root && root.nextElementSibling === continuation }
  };
})()
'@
  Assert-True ($desktop.busy -eq "false" -and $desktop.peers -eq 72 -and $desktop.profile -eq 4 -and $desktop.onOff -eq 4) "Loaded data counts are incorrect."
  Assert-True ($desktop.title -like "Edey*biggest contributions come around the basket") ("Primary title changed: " + $desktop.title)
  Assert-True ($desktop.subtitle.Contains("72 qualifying centers and center/forwards") -and $desktop.sample.Contains("Zach Edey") -and $desktop.sample.Contains("77 games") -and $desktop.sample.Contains("1,700 minutes")) ("Subtitle or sample changed: " + $desktop.sample)
  Assert-True ($desktop.rankRows -eq 4 -and $desktop.rankHits -eq 4 -and $desktop.profileTableRows -eq 4) "Rank rows, focus targets or table are incomplete."
  $rankText = $desktop.rankLabels -join " | "
  foreach ($label in @("17.3%", "5 of 72", "20.9%", "14 of 72", "5.7%", "16 of 72", "63.2%", "27 of 72")) {
    Assert-True ($rankText.Contains($label)) "Missing rank label fragment $label."
  }
  Assert-True ($desktop.rankErrors.Count -eq 0) "Rank marker positions are incorrect."
  Assert-True ($desktop.panels -eq 2 -and $desktop.marks -eq 8 -and $desktop.connectors -eq 4 -and $desktop.valueLabels -eq 8) "Companion marks or labels are incomplete."
  Assert-True (($desktop.deltas -join "|") -eq "+9.0 pp|+4.1 pp|+3.9 pp|+13.5 pp") "Rebound change labels are incorrect."
  Assert-True (($desktop.minutes -contains "1,418 on min.") -and ($desktop.minutes -contains "284 on min.")) "On-court samples are missing."
  Assert-True ($desktop.onOffErrors.Count -eq 0) "On/off marker positions are incorrect."
  Assert-True ($desktop.ratingRows -eq 2 -and $desktop.ratingText.Contains("+1.1") -and $desktop.ratingText.Contains("+25.4") -and $desktop.ratingText.Contains("284")) "Ratings table is incomplete."
  Assert-True ($desktop.notes.Contains("do not isolate") -and $desktop.notes.Contains("causal contribution") -and $desktop.notes.Contains("two-minute discrepancy") -and $desktop.notes.Contains("No two-season rates are pooled")) "Methodology is incomplete."
  Assert-True (($desktop.theme -join "|") -eq "#5d76a9|#12173f|#eceff5") "Memphis theme tokens are incorrect."
  Assert-True ($desktop.story.intro -eq 9 -and $desktop.story.continuation -eq 3 -and $desktop.story.adjacency) "Story placement is incorrect."
  Save-ChartScreenshot "edey-memphis-desktop.png"

  Write-Host "Browser check: interaction assertions"
  $interaction = Invoke-JavaScript @'
(async () => {
  const root = document.querySelector('[data-edey-memphis-chart]');
  const rank = root.querySelector('.edey-rank__hit');
  rank.focus(); rank.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const rankText = root.querySelector('.edey-package__inspection').textContent;
  const touch = [...root.querySelectorAll('.edey-onoff__hit')].find((node) => node.getAttribute('aria-label').includes('2025') && node.getAttribute('aria-label').includes('on court'));
  touch.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  const touchText = root.querySelector('.edey-package__inspection').textContent;
  const card = root.closest('details'); card.open = false;
  await new Promise((resolve) => setTimeout(resolve, 50)); card.open = true;
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { rankText, touchText, svgs: root.querySelectorAll('svg').length, roots: document.querySelectorAll('[data-edey-memphis-chart]').length, initialized: root.dataset.edeyInitialized };
})()
'@
  Assert-True ($interaction.rankText.Contains("17.3%") -and $interaction.rankText.Contains("5 of 72")) "Keyboard inspection failed."
  Assert-True ($interaction.touchText.Contains("284 minutes")) "Touch inspection failed."
  Assert-True ($interaction.svgs -eq 7 -and $interaction.roots -eq 1 -and $interaction.initialized -eq "true") "Reopening duplicated chart elements."

  Send-Cdp "Emulation.setDeviceMetricsOverride" @{ width = 390; height = 844; deviceScaleFactor = 1; mobile = $true } | Out-Null
  Write-Host "Browser check: mobile assertions"
  Invoke-JavaScript "new Promise((resolve) => { window.dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 220); })" | Out-Null
  $mobile = Invoke-JavaScript @'
(() => {
  const root = document.querySelector('[data-edey-memphis-chart]');
  const first = root.querySelector('.edey-rank__hit'); first.focus();
  return {
    columns: getComputedStyle(root.querySelector('.edey-package__onoff-plot')).gridTemplateColumns,
    pageWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth,
    metrics: [...root.querySelectorAll('.edey-rank__metric strong')].map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
    rankLabels: [...root.querySelectorAll('.edey-rank__label')].map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
    panels: root.querySelectorAll('.edey-onoff__panel').length, ratingRows: root.querySelectorAll('.edey-package__ratings-table tbody tr').length,
    focused: document.activeElement === first, role: first.getAttribute('role'), tabIndex: first.tabIndex
  };
})()
'@
  Assert-True (-not $mobile.columns.Contains(" ") -and $mobile.panels -eq 2) "Companion panels did not stack at 390px."
  Assert-True ($mobile.pageWidth -le $mobile.viewportWidth) "Mobile page overflowed horizontally."
  $mobileText = ($mobile.metrics + $mobile.rankLabels) -join " | "
  Assert-True ($mobileText.Contains("Offensive rebound percentage") -and $mobileText.Contains("17.3%") -and $mobileText.Contains("5 of 72") -and $mobileText.Contains("True shooting percentage") -and $mobileText.Contains("63.2%") -and $mobileText.Contains("27 of 72")) "Mobile rank labels are incomplete."
  Assert-True ($mobile.ratingRows -eq 2 -and $mobile.focused -and $mobile.role -eq "button" -and $mobile.tabIndex -eq 0) "Mobile table or focus state is incomplete."
  Save-ChartScreenshot "edey-memphis-mobile.png"

  Send-Cdp "Emulation.setEmulatedMedia" @{ media = "screen"; features = @(@{ name = "prefers-reduced-motion"; value = "reduce" }) } | Out-Null
  Assert-True (Invoke-JavaScript "matchMedia('(prefers-reduced-motion: reduce)').matches") "Reduced-motion mode is not active."
  $errors = Invoke-JavaScript "window.__edeyBrowserErrors"
  Assert-True ($errors.Count -eq 0) ("Browser runtime errors: " + ($errors -join " | "))

  Write-Output "PASS: 72-player rank profile, direct labels, exact coordinates and accessible four-row table."
  Write-Output "PASS: four on/off rows, rebound changes, ratings differences and samples match processed data."
  Write-Output "PASS: keyboard/touch inspection, reopening, resize, 390px stacking, no overflow and reduced motion."
  Write-Output "PASS: Memphis theme, story placement and browser console are clean."
  Write-Output "Wrote artifacts/edey-memphis-desktop.png and artifacts/edey-memphis-mobile.png"
} finally {
  if ($socket) {
    try { $socket.Dispose() } catch {}
  }
  if ($chrome -and -not $chrome.HasExited) {
    try { Stop-Process -Id $chrome.Id -Force } catch {}
    try { Wait-Process -Id $chrome.Id -Timeout 5 -ErrorAction SilentlyContinue } catch {}
  }
  if (Test-Path -LiteralPath $profile) {
    try { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction Stop } catch {}
  }
}
