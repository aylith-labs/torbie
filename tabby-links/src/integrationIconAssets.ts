/**
 * The bundled integration logos, keyed by the file name their manifests name.
 *
 * The only file in this package that knows webpack exists — `integrationIcons.ts`
 * takes this map as an argument so it stays testable without a bundle.
 *
 * The keys are file names rather than integration ids on purpose: stith's mark
 * is `aylith.png`, because the dashboard is stith and the brand is aylith's.
 * Renaming either without the other yields a manifest naming a file nothing
 * carries — which builds green and simply shows no logo, so the bijection
 * between this map and `src/integrations/icons/` is asserted in logic.test.js.
 */

/**
 * `type: 'asset/inline'` emits an ES module, so `require()` hands back
 * `{ default: 'data:…' }` rather than the string — unlike `svg-inline-loader`,
 * which is CommonJS and can be used directly. Unwrapping here rather than at
 * each use because `src="[object Object]"` renders as a broken image and fails
 * nothing at all.
 */
const asset = (mod: any): string => typeof mod === 'string' ? mod : mod?.default ?? ''

export const INTEGRATION_ICONS: Record<string, string> = {
    'github.png': asset(require('./integrations/icons/github.png')),
    'jira.png': asset(require('./integrations/icons/jira.png')),
    'slack.png': asset(require('./integrations/icons/slack.png')),
    'aylith.png': asset(require('./integrations/icons/aylith.png')),
    'unblocked.png': asset(require('./integrations/icons/unblocked.png')),
    'shefrd.png': asset(require('./integrations/icons/shefrd.png')),
}
