import test from 'node:test';
import assert from 'node:assert/strict';
import {clearPath,inside,route,safePoint} from '../src/lib/guide-motion.ts';
const area={left:42,top:42,right:1358,bottom:858};
test('guide routes around the preview instead of crossing it',()=>{
 const blocks=[{left:160,top:200,right:1240,bottom:700}],start={x:1300,y:780},end={x:100,y:120};
 const path=route(start,end,area,blocks);assert.ok(path.length>1);
 let last=start;for(const point of path){assert.ok(clearPath(last,point,blocks));last=point;}assert.deepEqual(last,end);
});
test('guide finds clearance from intersecting input and menu rectangles',()=>{
 const blocks=[{left:500,top:200,right:900,bottom:300},{left:500,top:280,right:950,bottom:600}];
 const point=safePoint({x:700,y:250},area,blocks);assert.ok(point);assert.ok(blocks.every(r=>!inside(point,r)));
});
test('guide tucks away when an immersive preview leaves no free area',()=>{
 assert.equal(safePoint({x:700,y:500},area,[{left:0,top:0,right:1400,bottom:900}]),null);
});
