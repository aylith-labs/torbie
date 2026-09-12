// Rule presets, driven through the real settings page.
//
// `logic.test.js` proves the presets themselves — that they compile, pass the
// ReDoS guard, and match what they claim to. This asserts the two things only
// the running app can answer: that both entry points render and produce a rule,
// and that the rule they produce is one `LinkRulesService` then actually
// resolves against a real link.
//
// The profile is reused and may hold rules someone typed, so the rule list is
// snapshotted and put back before this exits.
const { connect } = require('./cdp')

let passed = 0
let failed = 0
function check (name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        passed++
        console.log(`  ok   ${name}`)
    } else {
        failed++
        console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`)
    }
}
function note (text) {
    console.log(`       ${text}`)
}

const ROOT = `window.ng.getComponent(document.querySelector('app-root'))`
const PAGE = `window.ng.getComponent(document.querySelector('link-tooltip-settings-tab'))`

// A real click, not `el.click()`.
//
// ng-bootstrap closes a dropdown from a `mousedown`/`mouseup` pair, not from the
// `click` event, so a bare `.click()` picks the item and leaves the menu open —
// which nothing in the app ever does, and which made this suite pass and fail on
// alternate runs as the leftover open state toggled the next run's caret shut.
const CLICK = `
    const realClick = el => {
        for (const type of ['mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
        }
    }
`

// The *live* rules service — the one the terminal's own decorator holds, not a
// fresh instance. `pluginModules` carries only each plugin's NgModule class, so
// there is no token to hand an injector; a decorator on a real tab is the way
// in. That also means what is asserted here is what a hover would do.
const RULES = `
    (() => {
        const cmp = ${ROOT}
        const all = cmp.app.tabs.flatMap(t => t.getAllTabs ? t.getAllTabs() : [t])
        const term = all.find(t => t.decorators && t.frontend && t.frontend.xterm)
        if (!term) { throw new Error('no terminal tab to read the decorator from') }
        const decorator = term.decorators.find(d => d.constructor.name === 'LinkTooltipDecorator')
        if (!decorator) { throw new Error('the link decorator is not attached') }
        return decorator.rules
    })()
`

async function main () {
    const { evaluate, close } = await connect()

    console.log('\n── open Settings → Link Tooltip ──')
    const opened = await evaluate(`
        const cmp = ${ROOT}
        const provider = (cmp.toolbarButtonProviders || []).find(x => x.constructor.name === 'ButtonProvider')
        await provider.open()
        await new Promise(r => setTimeout(r, 600))
        const tab = cmp.app.tabs.find(t => t.constructor.name === 'SettingsTabComponent')
        cmp.app.selectTab(tab)
        await new Promise(r => setTimeout(r, 900))
        window.ng.applyChanges(cmp)
        // Polled, not slept on: on a cold instance the settings tab's nav takes
        // longer than any fixed wait worth writing, and a missing nav link then
        // reads as "the page is gone" rather than "it was not there yet".
        let nav = null
        for (let i = 0; i < 40 && !nav; i++) {
            nav = [...document.querySelectorAll('settings-tab .nav-link')]
                .find(x => x.textContent.includes('Link Tooltip'))
            if (!nav) { await new Promise(r => setTimeout(r, 250)) }
        }
        if (!nav) { return { error: 'the Link Tooltip nav link never appeared' } }
        nav.click()
        let page = null
        for (let i = 0; i < 40 && !page; i++) {
            await new Promise(r => setTimeout(r, 250))
            page = ${PAGE}
        }
        if (!page) { return { error: 'page did not render' } }
        // Put the rule list back exactly as it was, whatever happens below.
        window.__PRESETS = { saved: JSON.parse(JSON.stringify(page.rules)) }
        return { rules: page.rules.length, presets: page.presets.map(p => p.id) }
    `)
    check('the page rendered', opened.error, undefined)
    check('every preset reached the page', opened.presets, [
        'jira-issue-keys', 'jira-issue-links',
        'github-pull-requests', 'github-issues', 'github-commits', 'github-repo-number',
        'slack-messages',
        'stith-session-uris', 'stith-web-links', 'stith-session-ids',
        'shefrd-pane-ids',
        'git-commit-hashes', 'media-files', 'source-code-files', 'text-files', 'pdf-files', 'office-document-files',
        'unblocked-task-ids', 'unblocked-task-links',
    ])
    note(`${opened.rules} rule(s) already on this profile`)

    console.log('\n── entry point 1: the "Add rule" split button ──')
    // Through the DOM, not the component: the point of this suite is that the
    // flyout is reachable, so the caret is clicked and the menu item is clicked.
    const viaMenu = await evaluate(`
        ${CLICK}
        const page = ${PAGE}
        // The caret is a toggle, so a menu left open by anything else would make
        // this click *close* it. Clear that first — the profile is shared.
        for (let i = 0; i < 4 && document.querySelector('.preset-menu.show'); i++) {
            realClick(document.body)
            await new Promise(r => setTimeout(r, 200))
        }
        const before = page.rules.length
        const host = document.querySelector('link-tooltip-settings-tab')
        const toggle = host.querySelector('.btn-group .dropdown-toggle-split')
        if (!toggle) { return { error: 'no split-button caret' } }
        realClick(toggle)
        await new Promise(r => setTimeout(r, 400))
        // container='body' moves the menu out of the component's subtree, so it
        // is found in the document and by the class ng-bootstrap sets when open.
        const menu = document.querySelector('.add-rule-presets.show')
        if (!menu) { return { error: 'the menu did not open' } }
        const items = [...menu.querySelectorAll('.dropdown-item')]
        const styled = getComputedStyle(items[0].querySelector('.preset-description'))
        const labels = items.map(i => i.querySelector('.preset-name').textContent.trim())
        const wanted = items.find(i => i.textContent.includes('Pull request'))
        realClick(wanted)
        await new Promise(r => setTimeout(r, 400))
        window.ng.applyChanges(page)
        const rule = page.currentRule
        return {
            headers: [...menu.querySelectorAll('.preset-group')].map(h => h.textContent.trim()),
            count: items.length,
            expected: page.presets.length,
            labels,
            // The menu is styled from the component's stylesheet even after
            // ng-bootstrap reparents it to <body>.
            descriptionStyled: styled.fontSize,
            stillOpen: !!document.querySelector('.add-rule-presets.show'),
            added: page.rules.length - before,
            opened: page.currentRule === page.rules[page.rules.length - 1],
            error: page.patternError,
            rule: rule && {
                name: rule.name, match: rule.match, integration: rule.integration,
                pattern: rule.pattern, enabled: rule.enabled,
            },
        }
    `)
    check('the flyout opened', viaMenu.error, '')
    // Against the page's own list, not a constant: this said 13 while the
    // catalogue had grown to 19, and failed for that reason alone.
    check('it lists every preset', viaMenu.count, viaMenu.expected)
    // One "Start from a preset" heading became a header per group.
    check('under a header per group', viaMenu.headers,
        ['Jira', 'GitHub', 'Slack', 'Stith', 'shefrd', 'Git', 'Files', 'Unblocked Code'])
    check('exactly one rule was added', viaMenu.added, 1)
    check('and opened in the editor', viaMenu.opened, true)
    check('filled in from the preset', viaMenu.rule, {
        name: 'GitHub: Pull request links',
        match: 'link',
        integration: 'github',
        pattern: '^https://github\\.com/(?<owner>[^/]+)/(?<repo>[^/]+)/(?<ispull>pull)/(?<number>\\d+)',
        enabled: true,
    })
    check('the pattern was not refused by the guard', viaMenu.error, '')
    check('the menu keeps the component\'s styles after moving to body',
        viaMenu.descriptionStyled, '12px')
    check('picking one closes the menu', viaMenu.stillOpen, false)
    note(`menu: ${viaMenu.labels.join(' | ')}`)

    console.log('\n── the rule it made actually resolves ──')
    // Straight through the service the terminal uses, so this is the rule
    // firing rather than the settings page describing itself.
    const resolved = await evaluate(`
        const page = ${PAGE}
        const rules = page.rules
        const svc = ${RULES}
        const hit = svc.resolve('link', 'https://github.com/Eugeny/tabby/pull/11383', '', null)
        const miss = svc.resolve('link', 'https://github.com/Eugeny/tabby/issues/11383', '', null)
        return {
            hit: hit.rule && hit.rule.name,
            hitIntegration: hit.integration,
            miss: miss.rule && miss.rule.name,
            ruleCount: rules.length,
        }
    `)
    check('a pull request URL picks the preset rule', resolved.hit, 'GitHub: Pull request links')
    check('and asks GitHub for the preview', resolved.hitIntegration, 'github')
    check('an issue URL does not', resolved.miss === 'GitHub: Pull request links', false)
    note(`issue URL resolved to: ${resolved.miss ?? 'no rule'}`)

    console.log('\n── entry point 2: "Apply preset" inside the editor ──')
    const viaEditor = await evaluate(`
        ${CLICK}
        const page = ${PAGE}
        const rule = page.currentRule
        // A custom action the user wrote. Applying a preset must not eat it.
        rule.actions = [{ name: 'Show', icon: '', type: 'sendInput', value: 'git show %u' }]
        rule.showDelay = 1234
        rule.suppressOpen = true
        page.saveConfiguration()
        window.ng.applyChanges(page)
        await new Promise(r => setTimeout(r, 200))
        const before = page.rules.length
        const host = document.querySelector('link-tooltip-settings-tab')
        const toggles = [...host.querySelectorAll('.rule-editor [ngbdropdowntoggle], .rule-editor .dropdown button')]
        const toggle = toggles.find(t => t.textContent.includes('Apply preset'))
        if (!toggle) { return { error: 'no Apply preset button in the editor' } }
        realClick(toggle)
        await new Promise(r => setTimeout(r, 400))
        const menu = document.querySelector('.apply-preset.show')
        if (!menu) { return { error: 'the editor menu did not open' } }
        const items = [...menu.querySelectorAll('.dropdown-item')]
        // By its label. The item no longer repeats "Media:", which is part of
        // the rule's name but not of what the menu shows under "Files".
        const wanted = items.find(i => i.textContent.includes('Images, audio and video'))
        realClick(wanted)
        await new Promise(r => setTimeout(r, 400))
        window.ng.applyChanges(page)
        return {
            error: '',
            stillOpen: !!document.querySelector('.apply-preset.show'),
            added: page.rules.length - before,
            sameObject: page.currentRule === rule,
            name: rule.name,
            match: rule.match,
            schemes: rule.schemes,
            fileTypeGroup: rule.fileTypeGroup,
            pattern: rule.pattern,
            showDelay: rule.showDelay,
            suppressOpen: rule.suppressOpen,
            actions: rule.actions.length,
            patternError: page.patternError,
            summary: page.summary(rule),
        }
    `)
    check('the editor dropdown opened', viaEditor.error, '')
    check('picking one closes it', viaEditor.stillOpen, false)
    check('it rewrote the open rule rather than adding one', viaEditor.added, 0)
    check('in place', viaEditor.sameObject, true)
    check('criteria replaced', {
        name: viaEditor.name, match: viaEditor.match,
        schemes: viaEditor.schemes, fileTypeGroup: viaEditor.fileTypeGroup, pattern: viaEditor.pattern,
    }, {
        name: 'Media: Images, audio and video', match: 'link',
        schemes: ['file', 'http', 'https'], fileTypeGroup: 'media', pattern: '',
    })
    check('the override went back to inheriting', viaEditor.showDelay, null)
    check('button suppression reset', viaEditor.suppressOpen, false)
    check('the custom action survived', viaEditor.actions, 1)
    check('no pattern error', viaEditor.patternError, '')
    note(`summary line: ${viaEditor.summary}`)

    console.log('\n── the file-type preset resolves against a real path ──')
    const media = await evaluate(`
        const svc = ${RULES}
        // The second pass the decorator makes, once the link has a resolved path.
        const image = svc.resolve('link', '/home/steve/a.png', '/home/steve/a.png', null)
        const text = svc.resolve('link', '/home/steve/a.md', '/home/steve/a.md', null)
        return { image: image.rule && image.rule.name, text: text.rule && text.rule.name }
    `)
    check('an image path picks the media rule', media.image, 'Media: Images, audio and video')
    check('a markdown path does not', media.text === 'Media: Images, audio and video', false)

    console.log('\n── both menus: grouped, searchable, focused, keyboard-navigable ──')
    // Through the real toggles and real key events. The rule list is restored
    // below, so rules are added freely here: one made from the first preset
    // makes the first item in both menus disabled, which is what lets
    // "ArrowDown reaches the first item that can be picked" mean more than
    // "ArrowDown reaches the first item".
    const MENUS = [
        ['Add rule', '.add-rule-presets', `host.querySelector('.btn-group .dropdown-toggle-split')`],
        ['Apply preset', '.apply-preset',
            `[...host.querySelectorAll('.rule-editor .dropdown button')].find(t => t.textContent.includes('Apply preset'))`],
    ]
    for (const [name, menuClass, toggleExpression] of MENUS) {
        const m = await evaluate(`
            ${CLICK}
            const sleep = ms => new Promise(r => setTimeout(r, ms))
            const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
            const page = ${PAGE}
            const host = document.querySelector('link-tooltip-settings-tab')
            const zone = window.ng.getInjector(host).get(window.nodeRequire('@angular/core').NgZone)
            for (let i = 0; i < 4 && document.querySelector('.preset-menu.show'); i++) {
                realClick(document.body)
                await sleep(200)
            }
            // The editor is closed and built again inside NgZone, never through
            // window.ng.applyChanges from here. This script evaluates in the
            // root zone, and a view built by a pass started from the root zone
            // registers its DOM listeners there as well: its input events then
            // schedule no tick, and the menu falls behind what is typed.
            // Measured with the editor built that way: 3, 3, 3, 8 groups drawn
            // against a model of 3, 1, 0, 8, with the handler reporting it was
            // outside Angular's zone. No real path builds it like that; the
            // hover card's "open this rule" goes through NgZone.run.
            zone.run(() => { page.currentRule = null })
            await sleep(200)
            zone.run(() => {
                const first = page.presets[0]
                if (!page.presetInUse(first)) { page.addRuleFromPreset(first) }
                // The editor needs an open rule that is not that preset, or its
                // own menu would offer the preset again as "re-sync me".
                page.addRule()
            })
            await sleep(300)
            const toggle = ${toggleExpression}
            if (!toggle) { return { error: 'no toggle' } }
            realClick(toggle)
            await sleep(400)
            const menu = document.querySelector('${menuClass}.show')
            if (!menu) { return { error: 'the menu did not open' } }
            const input = menu.querySelector('.preset-search input')
            const describe = el => el === input ? 'search'
                : el?.classList.contains('dropdown-item') ? el.querySelector('.preset-name').textContent.trim()
                : el ? el.tagName.toLowerCase() : 'nothing'
            // Headers and their item counts, read off the menu's children in order.
            const groups = () => {
                const out = []
                for (const el of menu.children) {
                    if (el.classList.contains('preset-group')) { out.push([el.textContent.trim(), 0]) }
                    else if (el.classList.contains('dropdown-item') && out.length) { out[out.length - 1][1]++ }
                }
                return out
            }
            const type = async value => {
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await sleep(250)
            }
            const focusedOnOpen = describe(document.activeElement)

            // Insets from fractional boxes only. The box around the input and
            // an item are both full-width children of the menu, so the input's
            // inset inside the one is directly comparable with the text's inset
            // inside the other, and a scrollbar counts for neither. Not
            // clientLeft/clientWidth: they are integers, and at 1.5x the menu's
            // border is 0.667px, which made a symmetric input measure 16/17.
            // Refused if nothing has layout: an unshown menu measures 0
            // everywhere, and 0 === 0 proves nothing.
            const searchBox = menu.querySelector('.preset-search').getBoundingClientRect()
            const inputBox = input.getBoundingClientRect()
            const itemBox = menu.querySelector('.dropdown-item').getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(menu.querySelector('.dropdown-item .preset-name'))
            const textBox = range.getBoundingClientRect()
            const laidOut = searchBox.width > 0 && inputBox.width > 0 && textBox.width > 0

            const all = groups()
            await type('commit')
            const commit = groups()
            await type('zzzz-no-such-preset')
            const emptyState = menu.querySelector('.dropdown-header:not(.preset-group)')
            const none = { groups: groups().length, says: emptyState ? emptyState.textContent.trim() : null }
            await type('')

            input.focus()
            key(input, 'ArrowDown')
            const down1 = describe(document.activeElement)
            key(document.activeElement, 'ArrowDown')
            const down2 = describe(document.activeElement)
            key(document.activeElement, 'ArrowUp')
            key(document.activeElement, 'ArrowUp')
            const up2 = describe(document.activeElement)
            const firstEnabled = describe(menu.querySelector('.dropdown-item:not(:disabled)'))
            const firstItemDisabled = menu.querySelector('.dropdown-item').disabled

            const restingTop = Math.round(input.getBoundingClientRect().top - menu.getBoundingClientRect().top)
            menu.scrollTop = menu.scrollHeight
            await sleep(100)
            const scrolled = menu.scrollTop
            const stuckTop = Math.round(input.getBoundingClientRect().top - menu.getBoundingClientRect().top)
            menu.scrollTop = 0

            await type('slack')
            realClick(document.body)
            await sleep(300)
            const closed = !document.querySelector('${menuClass}.show')
            realClick(toggle)
            await sleep(400)
            const reopened = document.querySelector('${menuClass}.show')
            const reopenedInput = reopened?.querySelector('.preset-search input')
            const again = {
                value: reopenedInput ? reopenedInput.value : null,
                groups: reopened ? reopened.querySelectorAll('.preset-group').length : null,
                focused: !!reopenedInput && document.activeElement === reopenedInput,
            }
            realClick(document.body)
            await sleep(300)
            const tenth = x => Math.round(x * 10) / 10
            return {
                error: '', focusedOnOpen, laidOut,
                inputLeft: tenth(inputBox.left - searchBox.left),
                inputRight: tenth(searchBox.right - inputBox.right),
                textLeft: tenth(textBox.left - itemBox.left),
                sameColumn: Math.abs(searchBox.left - itemBox.left) < 0.5 && Math.abs(searchBox.right - itemBox.right) < 0.5,
                all, commit, none, down1, down2, up2, firstEnabled, firstItemDisabled,
                restingTop, scrolled, stuckTop, closed, again, total: page.presets.length,
            }
        `)
        check(`${name}: the menu opened`, m.error, '')
        check(`${name}: the search box has focus as soon as it opens`, m.focusedOnOpen, 'search')
        check(`${name}: the menu was laid out, so the insets below mean something`, m.laidOut, true)
        check(`${name}: the box and the items span the same width`, m.sameColumn, true)
        check(`${name}: the input is inset from both edges`, m.inputLeft > 0 && m.inputRight > 0, true)
        check(`${name}: by the same amount on each side`, Math.abs(m.inputLeft - m.inputRight) < 0.5, true)
        check(`${name}: which lines it up with the item text`, Math.abs(m.inputLeft - m.textLeft) < 0.5, true)
        check(`${name}: every preset sits under a header`, m.all.reduce((n, g) => n + g[1], 0), m.total)
        check(`${name}: the headers`, m.all.map(g => g[0]),
            ['Jira', 'GitHub', 'Slack', 'Stith', 'shefrd', 'Git', 'Files', 'Unblocked Code'])
        check(`${name}: a search drops the groups it empties`,
            m.commit.every(g => g[1] > 0) && m.commit.length > 0 && m.commit.length < m.all.length, true)
        check(`${name}: nothing matching shows no header, and says so`,
            m.none, { groups: 0, says: 'No presets match your search' })
        check(`${name}: the first item is disabled, so the next check is not vacuous`, m.firstItemDisabled, true)
        check(`${name}: ArrowDown from the box reaches the first item that can be picked`, m.down1, m.firstEnabled)
        check(`${name}: ArrowDown again carries on down the list`, m.down2 !== m.down1 && m.down2 !== 'search', true)
        check(`${name}: ArrowUp from the top item goes back to the box`, m.up2, 'search')
        check(`${name}: the list is long enough to scroll`, m.scrolled > 0, true)
        check(`${name}: and the box stays put while it does`, m.stuckTop, m.restingTop)
        check(`${name}: clicking away closes it`, m.closed, true)
        check(`${name}: closing cleared the search`, m.again.value, '')
        check(`${name}: so it reopens on every group`, m.again.groups, m.all.length)
        check(`${name}: with the box focused again`, m.again.focused, true)
        note(`${name}: box inset ${m.inputLeft}px / ${m.inputRight}px, item text at ${m.textLeft}px, ` +
            `"commit" → ${m.commit.map(g => `${g[0]} ${g[1]}`).join(', ')}`)
    }

    console.log('\n── the profile is left as it was found ──')
    const restored = await evaluate(`
        const page = ${PAGE}
        const cmp = ${ROOT}
        // In place: the getter hands back the stored array itself, and
        // assigning over the ConfigProxy member is the one thing that would not
        // reach the file.
        page.rules.splice(0, page.rules.length, ...window.__PRESETS.saved)
        page.currentRule = null
        await cmp.config.save()
        window.ng.applyChanges(page)
        return { rules: page.rules.length, saved: window.__PRESETS.saved.length }
    `)
    check('the rule list is back', restored.rules, restored.saved)

    await close()
    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
