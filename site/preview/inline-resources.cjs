const ts = require('typescript');
// Reuse the app's templates and styles. The browser JIT compiler defaults to
// OnPush in Angular 22; preserve this legacy app's default-checking semantics.
module.exports = function (source) {
 // The embedded app uses browser font readiness, not the hosted terminal's
 // fixed one-second workaround. Stop async attachment if its tab was closed.
 if (this.resourcePath.replaceAll('\\', '/').endsWith('/frontends/xtermFrontend.ts')) {
  const wait='await new Promise(resolve => setTimeout(resolve, this.hostApp.platform === Platform.Web ? 1000 : 0))';
  if (!source.includes(wait)) throw new Error('Review the preview font-readiness adaptation: upstream attach changed');
  source=source.replace(wait, 'await document.fonts.ready\n        if (this.destroyed.isStopped) return');
  for (const delay of [100,0]) source=source.replace(`await new Promise(r => setTimeout(r, ${delay}))`, 'await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))\n        if (this.destroyed.isStopped) return');
  source=source.replace('const doResize = () => {', 'const doResize = () => {\n            if (this.destroyed.isStopped) return');
  source=source.replace('this.resizeHandler = () => {', 'this.resizeHandler = () => {\n            if (this.destroyed.isStopped) return');
 }

 source = source.replace(/templateUrl:\s*(['"])([^'"]+)\1/g, (_,quote,file) => `template: require(${JSON.stringify(file)})`)
  .replace(/styleUrls:\s*\[([^\]]+)\]/g, (_,files) => `styles: [${files.replace(/(['"])([^'"]+)\1/g,(_m,_q,file)=>`require(${JSON.stringify(file)})`)}]`);
 const file=ts.createSourceFile(this.resourcePath,source,ts.ScriptTarget.Latest,true);
 const result=ts.transform(file,[context=>{
  const visit=node=>{
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Component'&&node.arguments[0]&&ts.isObjectLiteralExpression(node.arguments[0])){
    const meta=node.arguments[0];
    if(!meta.properties.some(p=>p.name?.getText(file)==='changeDetection')){
     return ts.factory.updateCallExpression(node,node.expression,node.typeArguments,[ts.factory.updateObjectLiteralExpression(meta,[ts.factory.createPropertyAssignment('changeDetection',ts.factory.createNumericLiteral(1)),...meta.properties]),...node.arguments.slice(1)]);
    }
   }
   return ts.visitEachChild(node,visit,context);
  };
  return node=>ts.visitNode(node,visit);
 }]);
 const output=ts.createPrinter().printFile(result.transformed[0]);result.dispose();return output;
};
