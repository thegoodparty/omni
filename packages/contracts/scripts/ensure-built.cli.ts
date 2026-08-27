import { join } from 'path'
import { ensureContractsBuilt } from './ensure-built'

// CJS entry, run by tsx from the consumers' build and typecheck scripts.
ensureContractsBuilt(join(__dirname, '..'))
