import { MODULE_IDS } from '@circle/shared';

/** Modules a group can switch on (all registered modules are data in @circle/shared). */
export function availableModules(): string[] {
  return MODULE_IDS;
}
