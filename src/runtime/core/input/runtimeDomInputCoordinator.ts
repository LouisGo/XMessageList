import type { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import type { DomRegistry } from '../../dom/domRegistry'
import type { ScrollFrameCoordinator } from '../viewport/scrollFrameCoordinator'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type {
  DirectScrollInput,
  RuntimeState,
} from '../../types'
import type {
  RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'

type RuntimeDomInputDeps<TMessage, TOptimistic> = {
  registry: DomRegistry
  scrollIntent: ScrollIntentEngine
  motion: DestinationMotionCoordinator<TMessage, TOptimistic>
  scrollFrame: ScrollFrameCoordinator<TMessage, TOptimistic>
  getState: () => RuntimeState
  getCurrentFrame: () => number
  setScrollbarDragIntentActive: (active: boolean) => void
  setScrollbarDragEdgeIntent: (edge: 'before' | 'after' | null) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class RuntimeDomInputCoordinator<TMessage, TOptimistic> {
  constructor(
    private readonly deps: RuntimeDomInputDeps<TMessage, TOptimistic>,
  ) {}

  // direct-scroll 是自定义滚动条等外部几何输入进入 runtime 的正式入口：
  // 它必须按用户滚动处理，负责取消目的地 motion，并维持 bottom lock/edge 检查语义。
  beginDirectScroll(input: DirectScrollInput): void {
    if (this.deps.getState() === 'DESTROYED') {
      return
    }

    this.deps.setScrollbarDragIntentActive(true)
    this.markUserScrollIntent()
    this.emitDirectScrollDiagnostic('scroll.direct.begin', input)
  }

  writeDirectScrollTop(scrollTop: number, input: DirectScrollInput): boolean {
    const container = this.deps.registry.getContainer()

    if (!container || this.deps.getState() === 'DESTROYED') {
      return false
    }

    this.deps.setScrollbarDragIntentActive(true)
    this.markUserScrollIntent()
    // 自定义滚动条的 thumb/track 已经完成几何换算，runtime 只接受目标 scrollTop，
    // 并立即安排 scroll frame，避免依赖浏览器是否同步派发原生 scroll 事件。
    container.scrollTop = Math.max(0, scrollTop)
    this.deps.scrollFrame.scheduleScrollRaf()
    this.emitDirectScrollDiagnostic('scroll.direct.write', input, {
      scrollTop: container.scrollTop,
    })
    return true
  }

  endDirectScroll(input: DirectScrollInput): void {
    if (this.deps.getState() === 'DESTROYED') {
      return
    }

    this.clearScrollbarDragIntent()
    this.emitDirectScrollDiagnostic('scroll.direct.end', input)
  }

  attachDomListeners(container: HTMLElement): void {
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    container.addEventListener('wheel', this.handleUserScrollIntent, { passive: true })
    container.addEventListener('touchstart', this.handleUserScrollIntent, {
      passive: true,
    })
    container.addEventListener('pointerdown', this.handlePointerScrollIntent)
    container.addEventListener('mousedown', this.handleMouseScrollIntent)
    container.addEventListener('keydown', this.handleUserScrollIntent)
    const ownerWindow = container.ownerDocument.defaultView
    ownerWindow?.addEventListener('pointerup', this.handleScrollbarDragEnd)
    ownerWindow?.addEventListener('mouseup', this.handleScrollbarDragEnd)
    ownerWindow?.addEventListener('blur', this.handleScrollbarDragEnd)
  }

  detachDomListeners(container: HTMLElement): void {
    container.removeEventListener('scroll', this.handleScroll)
    container.removeEventListener('wheel', this.handleUserScrollIntent)
    container.removeEventListener('touchstart', this.handleUserScrollIntent)
    container.removeEventListener('pointerdown', this.handlePointerScrollIntent)
    container.removeEventListener('mousedown', this.handleMouseScrollIntent)
    container.removeEventListener('keydown', this.handleUserScrollIntent)
    const ownerWindow = container.ownerDocument.defaultView
    ownerWindow?.removeEventListener('pointerup', this.handleScrollbarDragEnd)
    ownerWindow?.removeEventListener('mouseup', this.handleScrollbarDragEnd)
    ownerWindow?.removeEventListener('blur', this.handleScrollbarDragEnd)
  }

  private readonly handleScroll = (): void => {
    this.deps.scrollFrame.scheduleScrollRaf()
  }

  private readonly handleUserScrollIntent = (): void => {
    this.markUserScrollIntent()
  }

  private readonly handlePointerScrollIntent = (event: PointerEvent): void => {
    if (this.isLikelyScrollbarPointerEvent(event)) {
      this.deps.setScrollbarDragIntentActive(true)
    }

    this.markUserScrollIntent()
  }

  private readonly handleMouseScrollIntent = (event: MouseEvent): void => {
    if (this.isLikelyScrollbarPointerEvent(event)) {
      this.deps.setScrollbarDragIntentActive(true)
    }

    this.markUserScrollIntent()
  }

  private readonly handleScrollbarDragEnd = (): void => {
    this.clearScrollbarDragIntent()
  }

  private markUserScrollIntent(): void {
    this.deps.scrollIntent.markUserIntent(this.deps.getCurrentFrame())
    this.deps.motion.cancel('user-interrupt')
  }

  private clearScrollbarDragIntent(): void {
    this.deps.setScrollbarDragIntentActive(false)
    this.deps.setScrollbarDragEdgeIntent(null)
  }

  private isLikelyScrollbarPointerEvent(event: MouseEvent | PointerEvent): boolean {
    const container = this.deps.registry.getContainer()

    if (!container || event.target !== container) {
      return false
    }

    const rect = container.getBoundingClientRect()
    const verticalScrollbarWidth = container.offsetWidth - container.clientWidth

    if (verticalScrollbarWidth <= 0) {
      return true
    }

    return event.clientX >= rect.right - verticalScrollbarWidth - 2
  }

  private emitDirectScrollDiagnostic(
    name: string,
    input: DirectScrollInput,
    extra: Record<string, unknown> = {},
  ): void {
    this.deps.emitDiagnostic({
      channel: 'scroll',
      severity: 'debug',
      name,
      details: () => ({
        source: input.source,
        ...extra,
      }),
    })
  }
}
