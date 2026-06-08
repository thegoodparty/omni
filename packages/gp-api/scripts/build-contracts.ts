import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'

const root = join(__dirname, '..')
const contractsRoot = join(root, '..', 'contracts')
const dist = join(contractsRoot, 'dist/index.js')
const srcDir = join(contractsRoot, 'src')
const scriptsDir = join(contractsRoot, 'scripts')

const isUpToDate = (): boolean => {
  if (!existsSync(dist)) return false

  const newerSrc = execSync(
    `find ${srcDir} ${scriptsDir} -name "*.ts" -newer ${dist}`,
    { encoding: 'utf8' },
  ).trim()

  return newerSrc.length === 0
}

if (isUpToDate()) {
  console.log('contracts: up to date, skipping build')
  process.exit(0)
}

execSync('npm run build', {
  stdio: 'inherit',
  cwd: contractsRoot,
})
