import { Component, Input, OnChanges } from '@angular/core'

import {
    ConfigNode,
    ConfigRow,
    containerPaths,
    countLabel,
    flattenTree,
    isLongValue,
    previewValue,
} from '../configView'

/**
 * A parsed config as a collapsible tree: read-only, filterable, annotated
 * against the defaults when it was built with them. Rows are flattened
 * (`flattenTree`) rather than drawn by a recursive template, so one `*ngFor`
 * tracked by path redraws only what a click changed.
 *
 * Expand state is keyed on paths, which survive a rebuild — a save, or the
 * config changing underneath — so the tree stays open where it was.
 */
@Component({
    standalone: false,
    selector: 'config-tree',
    templateUrl: './configTree.component.pug',
    styleUrls: ['./configTree.component.scss'],
})
export class ConfigTreeComponent implements OnChanges {
    @Input() nodes: ConfigNode[] = []
    /** Whether the nodes were compared with the defaults; decides the legend. */
    @Input() annotated = false

    filter = ''
    rows: ConfigRow[] = []
    expanded = new Set<string>()
    /** Branches shut by hand while a filter holds them open; cleared when the filter changes. */
    collapsed = new Set<string>()
    /** Long values drawn in full. */
    fullValues = new Set<string>()
    /** Rows whose notes are open. */
    openNotes = new Set<string>()

    countLabel = countLabel
    isLongValue = isLongValue

    ngOnChanges (): void {
        this.refresh()
    }

    refresh (): void {
        this.rows = flattenTree(this.nodes ?? [], this.expanded, this.filter, this.collapsed)
    }

    /** Open what is drawn shut, shut what is drawn open — whether the user or the filter opened it. */
    toggleRow (row: ConfigRow): void {
        const path = row.node.path
        if (row.expanded) {
            this.expanded.delete(path)
            this.collapsed.add(path)
        } else {
            this.expanded.add(path)
            this.collapsed.delete(path)
        }
        this.refresh()
    }

    onFilterChange (): void {
        this.collapsed.clear()
        this.refresh()
    }

    expandAll (): void {
        this.expanded = new Set(containerPaths(this.nodes ?? []))
        this.collapsed.clear()
        this.refresh()
    }

    collapseAll (): void {
        this.expanded.clear()
        this.collapsed = new Set(containerPaths(this.nodes ?? []))
        this.refresh()
    }

    clearFilter (): void {
        this.filter = ''
        this.onFilterChange()
    }

    toggleValue (node: ConfigNode): void {
        if (this.fullValues.has(node.path)) {
            this.fullValues.delete(node.path)
        } else {
            this.fullValues.add(node.path)
        }
    }

    toggleNotes (node: ConfigNode): void {
        if (this.openNotes.has(node.path)) {
            this.openNotes.delete(node.path)
        } else {
            this.openNotes.add(node.path)
        }
    }

    hasNotes (node: ConfigNode): boolean {
        return node.diff === 'changed' || node.diff === 'added' || node.forkAdded || !!node.configOnlyNote
    }

    preview (node: ConfigNode): { text: string, detail: string } {
        return previewValue(node.value)
    }

    /** A scalar as YAML would read it back: strings bare unless empty. */
    display (node: ConfigNode): string {
        const v = node.value
        if (v === null || v === undefined) {
            return 'null'
        }
        if (typeof v === 'string') {
            return v === '' ? '""' : v
        }
        if (v instanceof Date) {
            return v.toISOString()
        }
        return String(v)
    }

    trackRow (_index: number, row: ConfigRow): string {
        return row.node.path
    }
}
