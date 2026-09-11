// Shared from Lintel paths/. Run conformance/sync-paths.mjs to update.
export const pathPatterns = {
    "version": 1,
    "windows": "(?<![\\w/])(?:[A-Za-z]:[\\\\/]|\\\\\\\\[^\\s\\\\/]+[\\\\/])[^\\s<>\"\\x27`|;,()\\[\\]{}]+",
    "posix": "(?<![\\w:/\\\\])/(?!/)[^\\s<>\"\\x27`|;,()\\[\\]{}]+"
} as const
