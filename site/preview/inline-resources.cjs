const ts = require('typescript');
// Reuse the app's templates and styles. The browser JIT compiler defaults to
// OnPush in Angular 22; preserve this legacy app's default-checking semantics.
module.exports = function (source) {
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
