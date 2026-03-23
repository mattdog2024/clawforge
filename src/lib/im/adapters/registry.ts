/**
 * Adapter self-registration registry (Layer 1).
 *
 * Each adapter file calls registerAdapter() at module level.
 * The Bridge Manager calls createAdapter() to instantiate the right class.
 */

import type { ChannelType } from '../types'
import type { ChannelAdapter } from './base'

type AdapterConstructor = new () => ChannelAdapter

const registry = new Map<ChannelType, AdapterConstructor>()

/** Register an adapter class for a channel type. */
export function registerAdapter(type: ChannelType, ctor: AdapterConstructor): void {
  registry.set(type, ctor)
}

/** Create a new adapter instance for the given channel type. */
export function createAdapter(type: ChannelType): ChannelAdapter {
  const Ctor = registry.get(type)
  if (!Ctor) throw new Error(`No adapter registered for channel type: ${type}`)
  return new Ctor()
}

/** List all registered channel types. */
export function getRegisteredTypes(): ChannelType[] {
  return [...registry.keys()]
}
