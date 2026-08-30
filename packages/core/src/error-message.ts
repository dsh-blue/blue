/**
 * Descriptor-safe extraction for values thrown across plugin and renderer
 * boundaries.
 *
 * @module @dsh-blue/blue-core/error-message
 */

/**
 * Read a non-empty own data `message` without invoking user code.
 *
 * @param error - unknown value caught at a runtime boundary.
 * @returns the safe message, or undefined when the value is hostile or opaque.
 */
export function ownDataErrorMessage(error: unknown): string | undefined {
  try {
    if (typeof error !== 'object' || error === null) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
    if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') return undefined
    return descriptor.value.trim().length > 0 ? descriptor.value : undefined
  } catch {
    return undefined
  }
}
