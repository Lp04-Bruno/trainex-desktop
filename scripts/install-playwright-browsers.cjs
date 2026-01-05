const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function ensurePlaywrightOptionalDepStub() {
  const stubDir = path.join(
    __dirname,
    '..',
    'node_modules',
    'playwright',
    'node_modules',
    'fsevents'
  )

  if (fs.existsSync(stubDir)) return

  fs.mkdirSync(stubDir, { recursive: true })
  const pkgPath = path.join(stubDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: 'fsevents',
          version: '0.0.0-stub',
          description: 'Stub for Windows packaging (Playwright optionalDependency).',
          private: true
        },
        null,
        2
      ) + '\n',
      'utf8'
    )
  }
}

function removePlaywrightFfmpeg() {
  const browsersDir = path.join(
    __dirname,
    '..',
    'node_modules',
    'playwright-core',
    '.local-browsers'
  )

  if (!fs.existsSync(browsersDir)) return

  const entries = fs.readdirSync(browsersDir, { withFileTypes: true })
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (!/^ffmpeg-/i.test(ent.name)) continue
    try {
      fs.rmSync(path.join(browsersDir, ent.name), { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

function run() {
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: '0'
  }

  const binName = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
  const localBin = path.join(__dirname, '..', 'node_modules', '.bin', binName)

  let command
  let args

  if (fs.existsSync(localBin)) {
    command = localBin
    args = ['install', 'chromium']
  } else {
    command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    args = ['--no-install', 'playwright', 'install', 'chromium']
  }

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32'
  })

  if (result.status === 0) {
    ensurePlaywrightOptionalDepStub()
    removePlaywrightFfmpeg()
  }

  if (typeof result.status === 'number') process.exit(result.status)
  if (result.error) console.error(result.error)
  process.exit(1)
}

run()
