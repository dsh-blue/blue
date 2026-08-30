/**
 * Create a native ESM package importer whose resolution parent is a directory.
 *
 * Dynamic import stays in the generated loader module so Node applies the
 * installed package's real `import` conditions and package scope.
 *
 * @module script/import-from-directory
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LOADER_FILE = '.blue-esm-package-loader.mjs'
const LOADER_SOURCE = 'export const importPackage = specifier => import(specifier)\n'

/**
 * Build an importer rooted at an installed project's package scope.
 *
 * @param {string} directory - Project directory containing node_modules.
 * @returns {Promise<(specifier: string) => Promise<Record<string, unknown>>>}
 */
export async function createPackageImporter(directory) {
  const loaderPath = join(directory, LOADER_FILE)
  writeFileSync(loaderPath, LOADER_SOURCE)
  const loader = await import(pathToFileURL(loaderPath).href)
  return loader.importPackage
}
