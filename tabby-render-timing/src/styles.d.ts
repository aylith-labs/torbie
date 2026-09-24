/**
 * Stylesheets imported for their side effect.
 *
 * TypeScript 6 refuses a side-effect import of a module it has no declaration
 * for; webpack resolves these through its own loader chain, so an ambient
 * declaration is all the compiler needs to know they are legitimate.
 */
declare module "*.scss"
declare module "*.css"
