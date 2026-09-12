/** Geometry in viewport coordinates. Rectangles already include the cat's clearance. */
export type Point = {x:number;y:number};
export type Rect = {left:number;top:number;right:number;bottom:number};
export const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y);
export const inside = (p:Point,r:Rect) => p.x>r.left && p.x<r.right && p.y>r.top && p.y<r.bottom;
export function clearPath(a:Point,b:Point,blocks:Rect[]):boolean {
 return !blocks.some(r=>{
  let low=0,high=1;
  for(const [start,end,min,max] of [[a.x,b.x,r.left,r.right],[a.y,b.y,r.top,r.bottom]]) {
   const delta=end-start;
   if(Math.abs(delta)<.001){if(start<=min||start>=max)return false;continue;}
   const t1=(min-start)/delta,t2=(max-start)/delta;
   low=Math.max(low,Math.min(t1,t2));high=Math.min(high,Math.max(t1,t2));
   if(low>=high)return false;
  }
  return high>0 && low<1;
 });
}
export function safePoint(wanted:Point,area:Rect,blocks:Rect[]):Point|null {
 const clamp=(p:Point)=>({x:Math.max(area.left,Math.min(area.right,p.x)),y:Math.max(area.top,Math.min(area.bottom,p.y))});
 const p=clamp(wanted);
 const candidates=[p,...blocks.flatMap(r=>[
  {x:r.left-1,y:p.y},{x:r.right+1,y:p.y},{x:p.x,y:r.top-1},{x:p.x,y:r.bottom+1},
  ...[r.left-1,r.right+1].flatMap(x=>[r.top-1,r.bottom+1].map(y=>({x,y})))
 ])].map(clamp).filter(c=>!blocks.some(r=>inside(c,r)));
 return candidates.sort((a,b)=>distance(a,wanted)-distance(b,wanted))[0]??null;
}
/** Route around controls instead of easing straight through them. */
export function route(start:Point,end:Point,area:Rect,blocks:Rect[]):Point[] {
 if(clearPath(start,end,blocks))return[end];
 const nodes=[start,end,...blocks.flatMap(r=>[r.left-1,r.right+1].flatMap(x=>[r.top-1,r.bottom+1].map(y=>({x,y}))))]
  .filter((p,i)=>i<2||(p.x>=area.left&&p.x<=area.right&&p.y>=area.top&&p.y<=area.bottom&&!blocks.some(r=>inside(p,r))));
 const costs=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=new Set<number>();costs[0]=0;
 for(let iteration=0;iteration<nodes.length;iteration++) {
  let current=-1;
  for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(current<0||costs[i]<costs[current]))current=i;
  if(current<0||costs[current]===Infinity)return[];
  if(current===1){const result:Point[]=[];for(let i=1;i>0;i=previous[i])result.unshift(nodes[i]);return result;}
  done.add(current);
  for(let i=1;i<nodes.length;i++)if(!done.has(i)&&clearPath(nodes[current],nodes[i],blocks)){
   const next=costs[current]+distance(nodes[current],nodes[i]);
   if(next<costs[i]){costs[i]=next;previous[i]=current;}
  }
 }
 return[];
}
