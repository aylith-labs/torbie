import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {AppService} from 'tabby-core';
const now=Date.now();
export const sessions:any[]=[
 {sessionId:'demo-claude',name:'Build the workspace',projectName:'studio',cwd:'/workspace/studio',status:'working',currentTool:'exec_command',model:'Claude',effort:'high',gitBranch:'feature/workspace',turns:8,toolCalls:24,subagentCount:2,waitingOnPermission:false,awaitingInput:false,startedAt:now-720000,lastActivityAt:now,envLabel:'Demo',machine:'browser',isRemote:false,compacting:false,transcriptPath:'',wslDistro:null,assistantTurns:8,compactions:0,transcriptBytes:0,lastError:null,waitingMessage:null,waitingSince:null,cliVersion:null,metrics:{contextTokens:32400,contextLimit:200000,contextFraction:.162,lastPrompt:'Arrange the workspace and run the checks.',aiTitle:'Build the workspace',mode:'normal',permissionMode:'default'}},
 {sessionId:'demo-review',name:'Review the changes',projectName:'studio',cwd:'/workspace/studio',status:'waiting',currentTool:null,model:'Claude',effort:'high',gitBranch:'feature/workspace',turns:4,toolCalls:12,subagentCount:0,waitingOnPermission:false,awaitingInput:true,startedAt:now-360000,lastActivityAt:now-45000,envLabel:'Shefrd · demo',machine:'browser',isRemote:false,compacting:false,transcriptPath:'',wslDistro:null,assistantTurns:4,compactions:0,transcriptBytes:0,lastError:null,waitingMessage:'The checks pass. Review the result?',waitingSince:now-45000,cliVersion:null,metrics:{contextTokens:18200,contextLimit:200000,contextFraction:.091,lastPrompt:'Review the layout and keyboard interactions.',mode:'normal',permissionMode:'default'}}
];
@Injectable({providedIn:'root'})
export class ClaudeSessionsService{
 sessions$=new BehaviorSubject(sessions);constructor(private app:AppService){}watch(){return{close(){}}}get all(){return sessions}get focusedSession(){return sessions[0]}forTab(){return sessions[0]}launchDirectory(s:any){return s.cwd}focusTab(){return false}
}
@Injectable({providedIn:'root'})
export class StithService{
 baseURL='https://demo.invalid';usage$=new BehaviorSubject([]);health$=new BehaviorSubject('ok');sessions$=new BehaviorSubject(sessions);watch(){return{close(){}}}refreshNow(){}async getSession(id:string){return sessions.find(s=>s.sessionId===id)}
}
@Injectable({providedIn:'root'})
export class HerdrService{enabled=true;warm(){}cachedPaneFor(id:string){return id==='demo-review'?{paneId:'w1:p2'}:null}async panes(){return []}async focus(){return{ok:true}}}
@Injectable({providedIn:'root'})
export class ClaudeActionsService{runDefault(_s:any,details:()=>void){details()}popupMenu(_s:any,details:()=>void){details()}}
@Injectable({providedIn:'root'})
export class TranscriptMetricsService{async read(s:any){return s.metrics}}
export type ClaudeSessionAction=string;
export interface ResumeCommandOptions{}
export interface HerdrPane{paneId:string}
export interface FocusOutcome{ok:boolean}
