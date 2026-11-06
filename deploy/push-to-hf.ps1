# Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
# Publish the committed code to a Hugging Face Space.
# Spaces need a YAML header at the top of README.md, so this builds a one-off copy with that header
# and force-pushes it to the Space. GitHub's README stays unchanged.
#   Usage:  .\deploy\push-to-hf.ps1 -Space itsaminzare/gower-street-terminal
param([Parameter(Mandatory)] [string] $Space)
$ErrorActionPreference = "Stop"
$git = "C:\Program Files\Git\cmd\git.exe"
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("gst-hf-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory $tmp | Out-Null
try {
  # Exactly what is committed on main (no .env, data or node_modules)
  & $git -C $root archive --format=tar -o "$tmp\src.tar" HEAD
  tar -xf "$tmp\src.tar" -C $tmp; Remove-Item "$tmp\src.tar"
  $header = Get-Content (Join-Path $root "deploy\hf-space-header.md") -Raw
  $readme = Get-Content (Join-Path $tmp "README.md") -Raw
  [IO.File]::WriteAllText((Join-Path $tmp "README.md"), $header + $readme, (New-Object Text.UTF8Encoding $false))
  $sha = (& $git -C $root rev-parse --short HEAD).Trim()
  & $git -C $tmp init -q -b main
  & $git -C $tmp -c user.name="Mohammadamin Zare" -c user.email="aminzare2005@gmail.com" add -A
  & $git -C $tmp -c user.name="Mohammadamin Zare" -c user.email="aminzare2005@gmail.com" commit -q -m "Deploy $sha from GitHub itsaminzare/gower-street-terminal"
  Write-Host "Pushing $sha to https://huggingface.co/spaces/$Space ..."
  & $git -C $tmp push --force "https://huggingface.co/spaces/$Space" main
  if ($LASTEXITCODE -ne 0) { throw "git push failed" }
  Write-Host "Done. The Space rebuilds in a few minutes: https://huggingface.co/spaces/$Space"
} finally {
  Remove-Item -Recurse -Force $tmp
}
