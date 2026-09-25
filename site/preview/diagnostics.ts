// Desktop lifecycle marks are represented as browser performance entries.
export function mark(name:string):void { performance.mark('torbie:'+name) }
