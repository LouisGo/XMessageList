export type DirectScrollSource =
  | 'custom-scrollbar-drag'
  | 'custom-scrollbar-track'

export type DirectScrollInput = {
  readonly source: DirectScrollSource
}

