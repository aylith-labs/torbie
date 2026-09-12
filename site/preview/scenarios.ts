export const demos = [
 {id:'claude',name:'Claude Code',icon:'fas fa-robot'},
 {id:'codex',name:'Codex',icon:'fas fa-code'},
 {id:'shefrd',name:'Shefrd',icon:'fas fa-columns'},
 {id:'lazygit',name:'LazyGit',icon:'fab fa-git-alt'},
 {id:'neovim',name:'Neovim',icon:'fas fa-file-code'},
 {id:'btop',name:'btop',icon:'fas fa-chart-bar'},
 {id:'logs',name:'Live logs',icon:'fas fa-stream'},
 {id:'tests',name:'Build & tests',icon:'fas fa-check'},
];
const copper='\x1b[38;2;201;122;58m',green='\x1b[32m',blue='\x1b[34m',muted='\x1b[39m',reset='\x1b[0m';
export function screen(id:string,choice=0):string{
 const title=demos.find(d=>d.id===id)?.name || 'Shell';
 const header=`${copper}${title}${reset}  ${muted}· interactive demo${reset}\r\n${muted}/workspace/studio${reset}\r\n\r\n`;
 const content:Record<string,string[]>={
 claude:[`${copper}❯${reset} Arrange a workspace and check the changes.`, '', '● I’ll open a test pane beside the application.', '', `${muted}MCP · list_tabs${reset}`, '  agent · application', '', `${muted}MCP · split_tab${reset}`, '  A new test pane, alongside the current session.', '', `${muted}MCP · exec_command${reset}`, '  npm test', `${green}  ✓ All checks passed${reset}`, '', '● The result is in the test pane. Ready to review.', '', `${copper}❯${reset} Try a demo command: help, test, clear, shefrd`],
 codex:[`${blue}Codex${reset} · workspace review`, '', '› Review the keyboard navigation changes.', '', '• Read src/keyboard.ts', '• Read tests/keyboard.test.ts', '', '• Ran npm test', `${green}  ✓ Tab moves between controls`, '  ✓ Escape returns focus', `  ✓ Arrow keys move through options${reset}`, '', '• No regressions found in this demo run.', '', '› Type help to explore the demo'],
 shefrd:[`${copper}SHEFRD${reset}                        studio / feature/workspace`, '', '  spaces               agents', '', ...['Claude · implement layout · working','Codex · review changes · waiting','tests · npm test · done'].map((s,i)=>`${i===choice%3?green+'❯':' '} ${s}${reset}`), '', `${muted}────────────────────────────────────────────${reset}`, '', choice%3===0?'● Updating the terminal workspace.':choice%3===1?'› Review complete. Waiting for the next task.':'✓ 18 tests passed. No failed checks.', '', '  Each agent keeps its own terminal session.', '', `${muted}↑/↓ select an agent · Enter inspect · q return${reset}`],
 lazygit:[`${copper}LazyGit${reset}                        studio / feature/workspace`, '', '  Files                         Status', ...['src/workspace.ts','src/keyboard.ts','tests/workspace.test.ts'].map((s,i)=>`${i===choice%3?green+'❯':' '} ${s.padEnd(29)} modified${reset}`), '', `${muted}────────────────────────────────────────────${reset}`, '', `${green}+ return restoreSession(savedWorkspace)`, '+ // Restore the work, alongside the layout.', `${reset}`, `${muted}j/k select file · space stage · q return${reset}`],
 neovim:[`${blue}src/workspace.ts${reset}`, '', `${muted} 1${reset}  export function workspace() {`, `${muted} 2${reset}    return {`, `${muted} 3${reset}      name: 'studio',`, `${muted} 4${reset}      panes: ['agent', 'application', 'tests'],`, `${muted} 5${reset}      restore: true,`, `${muted} 6${reset}    }`, `${muted} 7${reset}  }`, '', '~', '~', '', `${blue} NORMAL ${reset} workspace.ts                 1:1`, `${muted}i insert a demo note · Esc normal · :q return${reset}`],
 btop:[`${copper}btop${reset} · demo process monitor`, '', `${green}CPU   ▰▰▰▰▱▱▱▱▱▱   38%${reset}`, `${blue}MEM   ▰▰▰▱▱▱▱▱▱▱   4.8 / 16 GB${reset}`, '', ' PID   PROCESS                CPU     MEMORY', ' 401   claude                 12%      412 MB', ' 402   codex                   8%      286 MB', ' 403   shefrd                  1%       42 MB', ' 404   node                    6%      180 MB', '', `${muted}Seeded process data · q return${reset}`],
 logs:[`${copper}Application logs${reset}`, '', `${muted}10:42:01${reset} INFO  Workspace opened: studio`, `${muted}10:42:02${reset} INFO  MCP client connected (demo)`, `${muted}10:42:03${reset} INFO  Agent requested list_tabs`, `${muted}10:42:04${reset} INFO  Pane created: tests`, `${muted}10:42:05${reset} INFO  Command started: npm test`, `${muted}10:42:06${reset} ${green}PASS${reset}  Keyboard navigation`, `${muted}10:42:06${reset} ${green}PASS${reset}  Session recovery`, `${muted}10:42:07${reset} INFO  Command completed: exit 0`, '', `${muted}Seeded log · type test to append another run${reset}`],
 tests:[`${copper}❯${reset} npm test`, '', '  workspace', `${green}    ✓ opens an agent session`, '    ✓ adds a test pane', `    ✓ restores the layout${reset}`, '', '  keyboard', `${green}    ✓ Tab advances focus`, '    ✓ Escape closes the menu', `    ✓ arrows select an option${reset}`, '', `${green}  18 passed · 0 failed${reset}`, `${muted}  Demo output; no commands run on your computer.${reset}`, '', '❯ Type test to run again'],
 };
 return '\x1b[2J\x1b[H'+header+(content[id]||['❯ Type help']).join('\r\n')+'\r\n';
}
