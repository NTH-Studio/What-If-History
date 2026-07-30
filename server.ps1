$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) {
    throw 'What If: History requires Node.js 24 or newer.'
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
    npm install
}

npm run build
npm run db:migrate
npm start
