import { LinkFileTypeGroup } from './api'

import { fileTypeCatalog } from './fileTypes.generated'

export const FILE_TYPE_GROUPS: Record<LinkFileTypeGroup, string[]> = Object.fromEntries(
    ['none','image','video','audio','media','sourceCode','document','archive','executable'].map(group => [group,
        fileTypeCatalog.types.filter(type => (type.groups as readonly string[]).includes(group)).flatMap(type => [...type.extensions]),
    ]),
) as Record<LinkFileTypeGroup, string[]>

export function fileTypeOf (target: string): typeof fileTypeCatalog.types[number] {
    const extension = extensionOf(target)
    const path = target.includes('://') ? target.split(/[?#]/)[0] : target
    const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
    return fileTypeCatalog.types.find(type => (type.extensions as readonly string[]).includes(extension)
        || (type.filenames as readonly string[]).some(filename => filename.toLowerCase() === name)) ?? fileTypeCatalog.types[fileTypeCatalog.types.length - 1]
}

export function revealLabel (platform: string): string {
    return (fileTypeCatalog.revealLabels as Record<string, string>)[platform] ?? fileTypeCatalog.revealLabels.default
}

export const FILE_TYPE_GROUP_LABELS: { value: LinkFileTypeGroup, label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: 'audio', label: 'Audio' },
    { value: 'media', label: 'Media (image, video, or audio)' },
    { value: 'sourceCode', label: 'Source code' },
    { value: 'document', label: 'Document' },
    { value: 'archive', label: 'Archive' },
    { value: 'executable', label: 'Executable' },
]

/**
 * The extension of a path or URI, lowercased and without the dot. Empty when
 * the last segment has none â€” note that the dot must come *after* the last
 * separator, or `/home/user.name/README` would report `name/README`.
 */
export function extensionOf (target: string): string {
    const withoutQuery = target.includes('://') ? target.split(/[?#]/)[0] : target
    const lastSep = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'))
    const lastDot = withoutQuery.lastIndexOf('.')
    if (lastDot <= lastSep + 1) {
        return ''
    }
    return withoutQuery.substring(lastDot + 1).toLowerCase()
}

export function matchesFileType (
    target: string,
    group: LinkFileTypeGroup,
    customExtensions: string[],
): boolean {
    const extension = extensionOf(target)
    const custom = customExtensions.map(x => x.trim().replace(/^\./, '').toLowerCase()).filter(x => x)
    return (fileTypeOf(target).groups as readonly string[]).includes(group) || (!!extension && custom.includes(extension))
}
