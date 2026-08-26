/** Remove only the known workspace build directories. @module script/clean-lib */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { BUILD_PACKAGE_DIRS, ROOT } from './package-contract.mjs'

for (const relativeDir of BUILD_PACKAGE_DIRS) rmSync(join(ROOT, relativeDir, 'lib'), { recursive: true, force: true })
rmSync(join(ROOT, 'node_modules', '.cache', 'blue-tsb'), { recursive: true, force: true })
