<script lang="ts">
 import {faArrowUpRightFromSquare,faChevronDown,faXmark,faRotateLeft,faPuzzlePiece,faTableColumns,faExpand,faCompress,faPlus,faSun,faMoon,faEllipsis,faCheck} from '@fortawesome/free-solid-svg-icons';
 const icons={external:faArrowUpRightFromSquare,chevron:faChevronDown,close:faXmark,reset:faRotateLeft,plugins:faPuzzlePiece,split:faTableColumns,expand:faExpand,compress:faCompress,plus:faPlus,sun:faSun,moon:faMoon,more:faEllipsis,check:faCheck};
 let {name}:{name:keyof typeof icons}=$props();
 const glyph=$derived(icons[name].icon);
</script>
<svg aria-hidden="true" focusable="false" viewBox={`0 0 ${glyph[0]} ${glyph[1]}`} fill="currentColor">{#each typeof glyph[4]==='string'?[glyph[4]]:glyph[4] as path}<path d={path}/>{/each}</svg>
<style>svg{display:inline-block;width:1em;height:1em;flex:none;vertical-align:-.125em}</style>
