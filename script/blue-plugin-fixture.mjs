import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDir = resolve(process.argv.slice(2).find(value => value !== '--') ?? '.')
const install = process.argv.includes('--install')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const dir = await mkdtemp(join(tmpdir(), 'blue-plugin-fixture-'))
mkdirSync(join(dir, 'node_modules'), { recursive: true })
writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { [manifest.name]: `file:${packageDir}` } }, null, 2))
const scenarios = ['headless projection replay/resume', 'action abort and stale-result rejection', 'provider swap and plain fallback', 'width scan 20/40/80/120', 'unload followed by late event']
const executed = []
const observations = []
let imported
if (install) {
  const output = execFileSync('pnpm', ['pack', '--pack-destination', dir], { cwd: packageDir, encoding: 'utf8' })
  const tarball = output.trim().split('\n').at(-1)
  if (tarball === undefined || !existsSync(tarball)) throw new Error('pnpm pack did not produce a fixture tarball')
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: dir, stdio: 'inherit' })
  const entry = typeof manifest.exports?.['.'] === 'object' ? manifest.exports['.'].default : manifest.exports?.['.']
  if (typeof entry === 'string') imported = await import(pathToFileURL(join(dir, 'node_modules', manifest.name, entry)).href)
  if (imported?.FrontendHost !== undefined) {
    const host = new imported.FrontendHost()
    let latePublish
    await host.activateInitial({
      id: 'fixture-provider',
      activate: context => context.publish({ providerId: 'fixture-provider', capabilities: [], views: [{ kind: 'text', text: 'ready' }] }),
    })
    if (host.snapshot.providerId !== 'fixture-provider') throw new Error('fixture provider did not publish')
    await host.swap({ id: 'fixture-failing-provider', activate: () => { throw new Error('fixture failure') } })
    if (host.snapshot.providerId !== 'plain') throw new Error('provider failure did not fall back to plain')
    await host.activateInitial({
      id: 'fixture-late-provider',
      activate: context => {
        latePublish = () => context.publish({ providerId: 'fixture-late-provider', capabilities: [], views: [{ kind: 'text', text: 'late' }] })
        context.publish({ providerId: 'fixture-late-provider', capabilities: [], views: [] })
      },
    })
    await host.unload()
    latePublish?.()
    if (host.snapshot.providerId !== 'plain') throw new Error('late publish survived unload')
    executed.push('provider swap and plain fallback', 'unload followed by late event')
    observations.push('FrontendHost public lifecycle contract passed')
  }
}
console.log(JSON.stringify({ package: manifest.name, fixtureRoot: dir, independentInstall: existsSync(join(dir, 'package.json')), installed: install, scenarios, executed, observations }, null, 2))
