import type { Plugin } from 'vite'

const HTML_FILE_EXTENSION = '.html'

type DemoBundleAsset = {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}

type DemoBundleChunk = {
  type: 'chunk'
  fileName: string
  code: string
}

type DemoOutputBundle = Record<string, DemoBundleAsset | DemoBundleChunk>

export function demoStandaloneHtmlPlugin(): Plugin {
  return {
    name: 'x-message-list-demo-standalone-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const demoBundle = bundle as DemoOutputBundle
      const htmlAsset = Object.values(demoBundle).find(
        (item) => item.type === 'asset' && item.fileName.endsWith(HTML_FILE_EXTENSION),
      )

      if (!htmlAsset || htmlAsset.type !== 'asset') {
        throw new Error('standalone demo build could not find the generated HTML asset')
      }

      let html = readAssetText(htmlAsset.source)
      const inlinedFiles = new Set<string>()

      html = removeIconLinks(html)
      html = inlineStylesheets(html, demoBundle, inlinedFiles)
      html = inlineModuleScripts(html, demoBundle, inlinedFiles)
      assertStandaloneHtml(html)

      htmlAsset.source = `${html.trimEnd()}\n`

      for (const fileName of inlinedFiles) {
        delete demoBundle[fileName]
      }
    },
  }
}

function inlineStylesheets(
  html: string,
  bundle: DemoOutputBundle,
  inlinedFiles: Set<string>,
): string {
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!hasRel(tag, 'stylesheet')) {
      return tag
    }

    const href = getAttribute(tag, 'href')
    const fileName = href ? resolveBundleFileName(href, bundle) : null
    const asset = fileName ? bundle[fileName] : null

    if (!fileName || !asset || asset.type !== 'asset') {
      return tag
    }

    inlinedFiles.add(fileName)

    return `<style>\n${escapeStyle(readAssetText(asset.source))}\n</style>`
  })
}

function inlineModuleScripts(
  html: string,
  bundle: DemoOutputBundle,
  inlinedFiles: Set<string>,
): string {
  return html.replace(
    /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*<\/script>/gi,
    (tag) => {
      const src = getAttribute(tag, 'src')
      const fileName = src ? resolveBundleFileName(src, bundle) : null
      const chunk = fileName ? bundle[fileName] : null

      if (!fileName || !chunk || chunk.type !== 'chunk') {
        return tag
      }

      inlinedFiles.add(fileName)

      return `<script type="module">\n${escapeScript(chunk.code)}\n</script>`
    },
  )
}

function removeIconLinks(html: string): string {
  return html.replace(/^\s*<link\b[^>]*>\s*$/gim, (tag) =>
    hasRel(tag, 'icon') ? '' : tag,
  )
}

function assertStandaloneHtml(html: string): void {
  const externalReferencePatterns = [
    /<script\b[^>]*\bsrc\s*=/i,
    /<link\b[^>]*\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|[^\s>]*\bstylesheet\b[^\s>]*)[^>]*\bhref\s*=/i,
    /<link\b[^>]*\brel\s*=\s*(?:"[^"]*\bmodulepreload\b[^"]*"|'[^']*\bmodulepreload\b[^']*'|[^\s>]*\bmodulepreload\b[^\s>]*)/i,
    /\b(?:src|href)\s*=\s*(?:"\/assets\/|'\/assets\/|\/assets\/)/i,
  ]

  const externalReference = externalReferencePatterns.find((pattern) =>
    pattern.test(html),
  )

  if (externalReference) {
    throw new Error(
      `standalone demo build still contains an external asset reference: ${externalReference}`,
    )
  }
}

function readAssetText(source: string | Uint8Array): string {
  return typeof source === 'string' ? source : new TextDecoder().decode(source)
}

function resolveBundleFileName(
  url: string,
  bundle: DemoOutputBundle,
): string | null {
  const cleanUrl = url.split(/[?#]/)[0] ?? ''
  const normalized = cleanUrl.replace(/^\.?\//, '')

  if (normalized in bundle) {
    return normalized
  }

  return null
}

function hasRel(tag: string, expectedRel: string): boolean {
  return (
    getAttribute(tag, 'rel')
      ?.split(/\s+/)
      .some((rel) => rel.toLowerCase() === expectedRel) ?? false
  )
}

function getAttribute(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  )

  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null
}

function escapeScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script')
}

function escapeStyle(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}
