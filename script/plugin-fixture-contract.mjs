/**
 * Pure package-closure and Harness-instance helpers for the packed plugin
 * fixture. Keeping these operations free of process side effects makes the
 * machine-report invariants independently testable.
 *
 * @module script/plugin-fixture-contract
 */

/**
 * Resolve the complete local package closure used by a packed fixture.
 * Development-only dependencies deliberately do not participate.
 *
 * @param {Iterable<string>} initialNames - Root and fixture-required packages.
 * @param {(name: string) => boolean} hasPackage - Whether a package is local.
 * @param {(name: string) => object} readManifest - Read a local package manifest.
 * @returns {string[]} Local package names in deterministic breadth-first order.
 */
export function collectLocalPackageClosure(initialNames, hasPackage, readManifest) {
  const names = new Set(initialNames)
  const queue = [...names]
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || !hasPackage(name)) continue
    const manifest = readManifest(name)
    for (const dependencyName of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      if (!hasPackage(dependencyName) || names.has(dependencyName)) continue
      names.add(dependencyName)
      queue.push(dependencyName)
    }
  }
  return [...names]
}
/**
 * Aggregate every installed Harness instance before line mismatches are
 * rejected, so a failed report still describes the complete install tree.
 *
 * @param {{ name: string, version: string, path: string }[]} instances - Installed instances.
 * @returns {Record<string, string | string[]>} Sorted versions keyed by package.
 */
export function summarizeHarnessPackageInstances(instances) {
  const versionsByName = new Map()
  for (const instance of instances) {
    const versions = versionsByName.get(instance.name) ?? new Set()
    versions.add(instance.version)
    versionsByName.set(instance.name, versions)
  }
  return Object.fromEntries([...versionsByName.keys()].sort().map(name => {
    const versions = [...(versionsByName.get(name) ?? [])].sort()
    return [name, versions.length === 1 ? versions[0] : versions]
  }))
}
