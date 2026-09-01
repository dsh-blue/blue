/** Renderer-private contracts for canonical validation and editor composition.
 * @module @dsh-blue/blue-core/ui-contracts
 */

import type { BlueStackNode, BlueSurfaceNode, BlueUiChild, BlueUiNode } from '@dsh-blue/blue-api'

/** Validation failures emitted by the canonical renderer boundary. */
export type BlueUiErrorCode = 'BLUE_INVALID_CONTRIBUTION' | 'BLUE_LIMIT_EXCEEDED'

/** Renderer-local validation result; this is not a plugin action protocol. */
export type BlueValidationResult<Value> =
  | { readonly ok: true, readonly value: Value }
  | { readonly ok: false, readonly code: BlueUiErrorCode, readonly message: string }

export interface BlueEditorControlNode { readonly kind: 'editor-control' }
export interface BlueEditorChild extends Omit<BlueUiChild, 'node'> { readonly node: BlueEditorShellNode }
export interface BlueEditorStackNode extends Omit<BlueStackNode, 'children'> { readonly children: readonly BlueEditorChild[] }
export interface BlueEditorSurfaceNode extends Omit<BlueSurfaceNode, 'child' | 'footer'> {
  readonly child: BlueEditorShellNode
  readonly footer?: BlueEditorShellNode
}

/** Core-private tree that injects the one Blue-owned editor control. */
export type BlueEditorShellNode =
  | Exclude<BlueUiNode, BlueStackNode | BlueSurfaceNode>
  | BlueEditorStackNode
  | BlueEditorSurfaceNode
  | BlueEditorControlNode
