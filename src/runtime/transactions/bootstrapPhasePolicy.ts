const BOOTSTRAP_PHASE_POLICY = {
  MOUNTING: {
    projection: true,
    measurement: false,
    correction: false,
    trim: false,
    edgeNeed: false,
  },
  MEASURING: {
    projection: true,
    measurement: true,
    correction: false,
    trim: false,
    edgeNeed: false,
  },
  STABILIZING: {
    projection: true,
    measurement: true,
    correction: true,
    trim: false,
    edgeNeed: false,
  },
  READY: {
    projection: true,
    measurement: true,
    correction: true,
    trim: true,
    edgeNeed: true,
  },
} as const

export function assertBootstrapPolicy(
  phase: keyof typeof BOOTSTRAP_PHASE_POLICY,
  capability: keyof typeof BOOTSTRAP_PHASE_POLICY.READY,
): void {
  if (!BOOTSTRAP_PHASE_POLICY[phase][capability]) {
    throw new Error(`bootstrap-${phase}-forbids-${capability}`)
  }
}
