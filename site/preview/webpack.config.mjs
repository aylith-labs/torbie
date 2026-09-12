import path from 'node:path';
import fs from 'node:fs';
import {createEs2015LinkerPlugin} from '@angular/compiler-cli/linker/babel';
import {constructorParametersDownlevelTransform} from '@angular/compiler-cli/private/tooling';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const webpack=require('webpack');
const here=path.dirname(new URL(import.meta.url).pathname),root=path.resolve(here,'../..');
const alias=Object.fromEntries(['core','terminal','settings','web','claude'].map(n=>['tabby-'+n,path.join(root,'tabby-'+n,'src/index.ts')]));
export default {
 mode:'production',target:'web',devtool:false,context:root,entry:path.join(here,'entry.ts'),output:{path:path.join(here,'dist'),filename:'demo.[contenthash:12].js',publicPath:'auto',clean:true},
 resolve:{mainFields:['es2020','es2015','esm2015','browser','module','main'],extensions:['.ts','.js','.mjs'],alias,modules:[path.join(here,'node_modules'),path.join(root,'node_modules'),path.join(root,'app/node_modules'),path.join(root,'web/node_modules'),'node_modules'],fallback:{readline:require.resolve('./readline.cjs'),fs:false,'fs/promises':false,child_process:false,net:false,tls:false,os:require.resolve('./mock-os.cjs'),path:require.resolve('path-browserify'),crypto:false,stream:require.resolve('stream-browserify'),util:require.resolve('util/'),buffer:require.resolve('buffer/')}},
 module:{rules:[
 {test:/\.ts$/,use:[{loader:require.resolve('ts-loader'),options:{transpileOnly:false,reportFiles:['site/preview/**/*.ts'],getCustomTransformers:(program)=>({before:[constructorParametersDownlevelTransform(program)]}),configFile:path.join(here,'tsconfig.json')}},path.join(here,'inline-resources.cjs')]},
 {test:/\.pug$/,use:[require.resolve('apply-loader'),{loader:require.resolve('pug-loader'),options:{pretty:true}}]},
 {test:/\.scss$/,use:[require.resolve('@tabby-gang/to-string-loader'),require.resolve('css-loader'),require.resolve('sass-loader')],include:/(theme.*|component)\.scss/},
 {test:/\.scss$/,use:[require.resolve('style-loader'),require.resolve('css-loader'),require.resolve('sass-loader')],exclude:/(theme.*|component)\.scss/},
 {test:/\.css$/,include:/component\.css$/,use:[require.resolve('@tabby-gang/to-string-loader'),require.resolve('css-loader')]},
 {test:/\.css$/,exclude:/component\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]},
 {test:/\.svg$/,use:require.resolve('svg-inline-loader')},
 {test:/\.yaml$/,use:require.resolve('yaml-loader')},
 {test:/\.po$/,use:[require.resolve('json-loader'),require.resolve('po-gettext-loader')]},
 {test:/\.(woff2?|ttf|otf|eot|png|ogg)$/,type:'asset/resource'},
 {test:/\.m?js$/,resolve:{fullySpecified:false},use:{loader:require.resolve('babel-loader'),options:{plugins:[createEs2015LinkerPlugin({linkerJitMode:true,fileSystem:{resolve:path.resolve,exists:fs.existsSync,dirname:path.dirname,relative:path.relative,readFile:fs.readFileSync}})],compact:false,cacheDirectory:true}}}
 ]},plugins:[new webpack.NormalModuleReplacementPlugin(/(?:claudeSessions|claudeActions|herdr|stith|transcriptMetrics)\.service$/,path.join(here,'claude-services.ts')),new webpack.ProvidePlugin({Buffer:['buffer','Buffer'],process:require.resolve('./mock-process.cjs')}),new webpack.DefinePlugin({'process.env.TABBY_BUILD_VERSION':JSON.stringify('1.0.0-demo'),'process.env.TABBY_BUILD_SHA':JSON.stringify('browser demo'),'process.env.TABBY_BUILD_BRANCH':JSON.stringify('demo'),'process.env.TABBY_BUILD_DATE':JSON.stringify(''),'process.env.TABBY_BUILD_TIMESTAMP':JSON.stringify('0')})],stats:'errors-warnings'
};
