import {BaseSession} from 'tabby-terminal';
import {Logger} from 'tabby-core';
import {demos,screen} from './scenarios';
export class DemoSession extends BaseSession{
 line='';choice=0;insert=false;
 constructor(logger:Logger,public kind='claude'){super(logger)}
 async start(){this.open=true;this.draw()}
 draw(){this.emitOutput(Buffer.from(screen(this.kind,this.choice)))}
 resize(_columns:number,_rows:number){}
 write(data:Buffer){
  const input=data.toString();
  if(['shefrd','polygit'].includes(this.kind)){
   if(['\x1b[B','j'].includes(input)){this.choice++;this.draw();return}
   if(['\x1b[A','k'].includes(input)){this.choice=(this.choice+2)%3;this.draw();return}
   if(input===' '&&this.kind==='polygit'){this.emitOutput(Buffer.from('\r\n\x1b[32mResult: 3 repositories checked · 2 updated · 1 up-to-date · 0 errors\x1b[0m\r\n'));return}
   if(input==='\r'&&this.kind==='shefrd'){this.emitOutput(Buffer.from('\r\nSelected agent: '+['Claude','Codex','tests'][this.choice%3]+'\r\n'));return}
   if(input==='q'){this.kind='claude';this.draw();return}
  }
  if(this.kind==='neovim'){
   if(input==='i'&&!this.insert){this.insert=true;this.emitOutput(Buffer.from('\r\n-- INSERT (demo note) --\r\n'));return}
   if(input==='\x1b'){this.insert=false;this.emitOutput(Buffer.from('\r\n-- NORMAL --\r\n'));return}
   if(this.insert){this.emitOutput(data);return}
  }
  if(input==='q'&&this.kind==='btop'){this.kind='claude';this.draw();return}
  for(const char of input){
   if(char==='\r'){
    const command=this.line.trim();this.line='';this.emitOutput(Buffer.from('\r\n'));
    if(command===':q'){this.kind='claude';this.draw();continue}
    const demo=demos.find(d=>d.id===command);
    if(demo){this.kind=demo.id;this.draw();continue}
    if(command==='clear'){this.emitOutput(Buffer.from('\x1b[2J\x1b[H'));continue}
    const text=command==='help'?'Try: '+demos.map(d=>d.id).join(', ')+', test, clear':/^(npm test|test)$/.test(command)?'\x1b[32m✓ workspace\r\n✓ keyboard navigation\r\n✓ session recovery\r\n18 passed · 0 failed\x1b[0m\r\nDemo results; no host command was executed.':command?`“${command}” is outside this demo. Type help for supported commands.`:'';
    this.emitOutput(Buffer.from(text+'\r\n❯ '));
   }else if(char==='\x7f'){if(this.line){this.line=this.line.slice(0,-1);this.emitOutput(Buffer.from('\b \b'));}}
   else if(char>=' '){this.line+=char;this.emitOutput(Buffer.from(char));}
  }
 }
 kill(){this.open=false}async gracefullyKillProcess(){}supportsWorkingDirectory(){return true}async getWorkingDirectory(){return '/workspace/studio'}
}
