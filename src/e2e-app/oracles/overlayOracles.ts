import type { E2EEvidence } from '../bridge/e2eBridge.ts'
import type { E2EOracleResult } from './oracleResult.ts'

export function expectOverlayMirrorsNative(
  evidence: E2EEvidence,
  options: { tolerancePx: number },
): E2EOracleResult {
  const overlay = evidence.overlay

  if (!overlay) {
    return {
      oracleId: 'overlay-native-mirror',
      ok: false,
      message: 'overlay evidence missing',
    }
  }

  const topDelta = Math.abs(overlay.thumbTop - overlay.expectedThumbTop)
  const heightDelta = Math.abs(overlay.thumbHeight - overlay.expectedThumbHeight)

  return {
    oracleId: 'overlay-native-mirror',
    ok: overlay.visible &&
      topDelta <= options.tolerancePx &&
      heightDelta <= options.tolerancePx,
    message: `visible=${overlay.visible} topDelta=${topDelta} heightDelta=${heightDelta}`,
  }
}

export function expectOverlayThumbRebounded(
  before: E2EEvidence,
  after: E2EEvidence,
  options: { edge: 'before' | 'after'; tolerancePx: number },
): E2EOracleResult {
  const beforeTop = before.overlay?.thumbTop
  const afterTop = after.overlay?.thumbTop
  const ok = typeof beforeTop === 'number' &&
    typeof afterTop === 'number' &&
    (
      options.edge === 'before'
        ? afterTop > beforeTop + options.tolerancePx
        : afterTop < beforeTop - options.tolerancePx
    )

  return {
    oracleId: 'overlay-thumb-rebounded',
    ok,
    message: `edge=${options.edge} before=${beforeTop ?? 'missing'} after=${afterTop ?? 'missing'}`,
  }
}

export function expectSessionOverlayVisible(
  evidence: E2EEvidence,
  visible: boolean,
): E2EOracleResult {
  return {
    oracleId: visible ? 'session-overlay-visible' : 'session-overlay-hidden',
    ok: evidence.sessionOverlay.visible === visible,
    message: `visible=${evidence.sessionOverlay.visible}`,
  }
}

export function expectSessionOverlayOutsideScrollContainer(
  evidence: E2EEvidence,
): E2EOracleResult {
  return {
    oracleId: 'session-overlay-outside-scroll-container',
    ok: !evidence.sessionOverlay.inScrollContainer,
    message: `inScrollContainer=${evidence.sessionOverlay.inScrollContainer}`,
  }
}
