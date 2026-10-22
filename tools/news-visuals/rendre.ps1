# Rend un visuel de nouvelle en PNG (Edge sans interface).
# Ex. : .\rendre.ps1 -Sortie assets\news\abc.png -T update -H "Titre" -L "Point 1|Point 2"
param(
  [Parameter(Mandatory)][string]$Sortie,
  [string]$T = 'new', [string]$H = '', [string]$S = '', [string]$L = '', [string]$C = '', [string]$P = '', [string]$B = '',
  [ValidateSet('wide','square')][string]$F = 'wide'
)
$racine = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$q = @{ t = $T; h = $H; s = $S; l = $L; c = $C; p = $P; b = $B; f = $F }
$qs = ($q.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { $_.Key + '=' + [uri]::EscapeDataString($_.Value) }) -join '&'
$url = 'file:///' + ((Join-Path $PSScriptRoot 'gabarit.html') -replace '\\','/' -replace ' ','%20') + '?' + $qs
$out = if ([IO.Path]::IsPathRooted($Sortie)) { $Sortie } else { Join-Path $racine $Sortie }
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$size = if ($F -eq 'square') { '1080,1080' } else { '1200,630' }
Start-Process $edge -Wait -ArgumentList '--headless=new','--disable-gpu','--no-first-run',"--user-data-dir=$env:TEMP\edge-nv",'--hide-scrollbars',"--window-size=$size",'--virtual-time-budget=8000',"--screenshot=`"$out`"","`"$url`""
if (Test-Path $out) { Get-Item $out | Select-Object Name, Length } else { Write-Error 'Rendu échoué' }
