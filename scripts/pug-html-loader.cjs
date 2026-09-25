// Webpack 5 loader API; pug-html-loader still parses the legacy this.query.
const pug = require('pug')
module.exports = function (source) {
    const compiled = pug.compile(source, { filename: this.resourcePath, ...this.getOptions() })
    for (const dependency of compiled.dependencies) this.addDependency(dependency)
    return compiled()
}
