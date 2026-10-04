/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { marked } from '../../node_modules/marked/lib/marked.esm.js'
import { Component, Injector } from '@angular/core'
import { BaseTabComponent, HomeBaseService, PlatformService, TranslateService } from 'tabby-core'
import { ChangeGroup, ReleaseCommit, groupCommits, handwrittenBody, relativeDay, sameVersion, summarizeGroups } from '../releaseNotes'

const REPO = 'aylith-labs/torbie'
const PER_PAGE = 30
const CACHE_PREFIX = 'releaseNotesCommits:'

export interface Release {
    name: string
    version: string
    url: string
    date: Date
    prerelease: boolean
    /** The hand-written part of the body, rendered; empty when GitHub generated all of it. */
    content: string
    /** The release before this one, once it is known; null for the first release there is. */
    previous?: string|null
    state: 'idle'|'loading'|'ready'|'error'
    error?: string
    groups: ChangeGroup[]
    commitCount: number
    summary: string
    expanded: Set<string>
}

/** @hidden */
@Component({
    standalone: false,
    selector: 'release-notes-tab',
    templateUrl: './releaseNotesTab.component.pug',
    styleUrls: ['./releaseNotesTab.component.scss'],
})
export class ReleaseNotesComponent extends BaseTabComponent {
    releases: Release[] = []
    lastPage = 0
    exhausted = false
    loadingPage = false
    pageError: string|null = null
    appVersion: string|null

    constructor (
        translate: TranslateService,
        injector: Injector,
        homeBase: HomeBaseService,
        private platform: PlatformService,
    ) {
        super(injector)
        this.setTitle(translate.instant(_('Release notes')))
        this.appVersion = homeBase.appVersion
        this.loadNextPage()
    }

    get latest (): Release|undefined {
        return this.releases.find(r => !r.prerelease)
    }

    isInstalled (release: Release): boolean {
        return sameVersion(release.version, this.appVersion)
    }

    relative (date: Date): string {
        return relativeDay(date)
    }

    absolute (date: Date): string {
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }

    async loadNextPage () {
        if (this.loadingPage || this.exhausted) {
            return
        }
        this.loadingPage = true
        this.pageError = null
        const page = this.lastPage + 1
        try {
            const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=${PER_PAGE}&page=${page}`, {
                headers: { Accept: 'application/vnd.github.v3+json' },
            })
            if (!response.ok) {
                throw new Error(await describeFailure(response))
            }
            const list = (await response.json()).filter(r => !r.draft)
            const fresh: Release[] = list.map(r => {
                const body = handwrittenBody(r.body)
                return {
                    name: r.name || r.tag_name,
                    version: r.tag_name,
                    url: r.html_url,
                    date: new Date(r.published_at ?? r.created_at),
                    prerelease: !!r.prerelease,
                    content: body ? marked(body) : '',
                    state: 'idle',
                    groups: [],
                    commitCount: 0,
                    summary: '',
                    expanded: new Set(),
                }
            })
            this.releases = this.releases.concat(fresh)
            this.lastPage = page
            if (list.length < PER_PAGE) {
                this.exhausted = true
            }
            this.linkPrevious()
        } catch (error) {
            this.pageError = error.message ?? String(error)
        } finally {
            this.loadingPage = false
        }
    }

    onScrolled () {
        this.loadNextPage()
    }

    retry (release: Release) {
        release.state = 'idle'
        this.loadCommits(release)
    }

    toggleGroup (release: Release, group: ChangeGroup) {
        if (release.expanded.has(group.id)) {
            release.expanded.delete(group.id)
        } else {
            release.expanded.add(group.id)
        }
    }

    isOpen (release: Release, group: ChangeGroup): boolean {
        return group.prominent !== release.expanded.has(group.id)
    }

    open (url: string) {
        this.platform.openExternal(url)
    }

    compareURL (release: Release): string {
        return release.previous
            ? `https://github.com/${REPO}/compare/${release.previous}...${release.version}`
            : `https://github.com/${REPO}/commits/${release.version}`
    }

    commitURL (sha: string): string {
        return `https://github.com/${REPO}/commit/${sha}`
    }

    trackRelease (_index: number, release: Release) {
        return release.version
    }

    trackGroup (_index: number, group: ChangeGroup) {
        return group.id
    }

    trackEntry (_index: number, entry: { sha: string }) {
        return entry.sha
    }

    /**
     * Each release is compared against the next older one in the list, not
     * against the tag GitHub's own notes chose: a release that was never
     * published (a draft that stayed a draft) would otherwise drop out of
     * every comparison, and its commits with it.
     */
    private linkPrevious () {
        this.releases.forEach((release, i) => {
            if (release.previous !== undefined) {
                return
            }
            const older = this.releases[i + 1]
            if (older) {
                release.previous = older.version
            } else if (this.exhausted) {
                release.previous = null
            } else {
                return
            }
            this.loadCommits(release)
        })
    }

    private async loadCommits (release: Release) {
        if (release.state === 'loading' || release.state === 'ready') {
            return
        }
        if (!release.previous) {
            release.state = 'ready'
            return
        }
        release.state = 'loading'
        const key = `${CACHE_PREFIX}${release.previous}...${release.version}`
        try {
            let commits = readCache(key)
            if (!commits) {
                const response = await fetch(`https://api.github.com/repos/${REPO}/compare/${release.previous}...${release.version}?per_page=250`, {
                    headers: { Accept: 'application/vnd.github.v3+json' },
                })
                if (!response.ok) {
                    throw new Error(await describeFailure(response))
                }
                const data = await response.json()
                commits = (data.commits ?? []).map(c => ({ sha: c.sha, subject: c.commit.message.split('\n')[0] }))
                // A published tag never moves, so what lies between two of them never changes.
                writeCache(key, commits!)
            }
            release.groups = groupCommits(commits!)
            release.commitCount = release.groups.reduce((n, g) => n + g.entries.length, 0)
            release.summary = summarizeGroups(release.groups)
            release.state = 'ready'
        } catch (error) {
            release.state = 'error'
            release.error = error.message ?? String(error)
        }
    }
}

async function describeFailure (response: Response): Promise<string> {
    if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
        const minutes = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : null
        return minutes ? `GitHub's rate limit is used up; try again in ${minutes} min` : 'GitHub\'s rate limit is used up'
    }
    return `GitHub answered ${response.status} ${response.statusText}`.trim()
}

function readCache (key: string): ReleaseCommit[]|null {
    try {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

function writeCache (key: string, commits: ReleaseCommit[]) {
    try {
        localStorage.setItem(key, JSON.stringify(commits))
    } catch { }
}
