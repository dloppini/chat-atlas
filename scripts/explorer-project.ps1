param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9+.-]*$')][string]$Scheme,
    [Parameter(Mandatory)][string]$Folder
)
$ErrorActionPreference = 'Stop'
$folderPath = [IO.Path]::GetFullPath($Folder)
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($folderPath)).TrimEnd('=').Replace('+','-').Replace('/','_')
Start-Process -FilePath ("${Scheme}://lpx.lpx-conversation-board/new-project?" + $encoded)
