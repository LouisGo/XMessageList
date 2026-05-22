export const customScrollbarStyle = `
[data-custom-scrollbar="true"] [data-message-scroll-container]::-webkit-scrollbar {
  display: none;
}

[data-custom-scrollbar="true"] [data-message-scroll-container] {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

[data-custom-scrollbar="true"] .x-message-scrollbar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 18px;
  z-index: 3;
  pointer-events: auto;
  opacity: 0;
  transition: opacity 140ms linear;
  contain: layout paint;
}

[data-custom-scrollbar="true"] .x-message-scrollbar.is-scrollable.is-visible,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-scrollable.is-hovering,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-scrollable.is-dragging {
  opacity: 1;
}

[data-custom-scrollbar="true"] .x-message-scrollbar-thumb {
  position: absolute;
  right: 2px;
  width: 6px;
  border-radius: 999px;
  background: rgb(109 122 130 / 0.52);
  transition:
    width 120ms linear,
    right 120ms linear,
    background-color 120ms linear,
    transform 0ms linear;
  pointer-events: auto;
  touch-action: none;
}

[data-custom-scrollbar="true"] .x-message-scrollbar.is-visible .x-message-scrollbar-thumb,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-hovering .x-message-scrollbar-thumb,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-dragging .x-message-scrollbar-thumb {
  will-change: transform;
}

[data-custom-scrollbar="true"] .x-message-scrollbar.is-hovering .x-message-scrollbar-thumb,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-dragging .x-message-scrollbar-thumb,
body.x-message-scrollbar-dragging .x-message-scrollbar-thumb {
  right: 2px;
  width: 8px;
  background: rgb(109 122 130 / 0.72);
}

body.x-message-scrollbar-dragging {
  user-select: none;
}
`
