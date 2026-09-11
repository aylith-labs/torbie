import { Integration } from '../api'
import { httpRequest } from './httpFetch'

export interface AccountIdentity {
    state: 'connected' | 'disabled' | 'unconfigured' | 'unsupported' | 'error'
    name?: string
    login?: string
    avatar?: string
    link?: string
    source?: string
    message: string
    organizations: { login: string, avatar?: string }[]
    discoveryMessage?: string
}

export function preferredOwners (value: string): string[] {
    const seen = new Set<string>()
    return value.split(/[\s,]+/).filter(owner => {
        const key = owner.toLowerCase()
        if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function runGitHubToken (_commandLine: string, _stdin: string, timeoutMs: number): Promise<{stdout: string, stderr: string}> {
    return new Promise(resolve => {
        const { execFile } = require('child_process')
        execFile('gh', ['auth', 'token', '--hostname', 'github.com'], { windowsHide: true, timeout: timeoutMs, maxBuffer: 65536 }, (error: Error | null, stdout: string) => {
            resolve({ stdout: error ? '' : stdout, stderr: '' })
        })
    })
}

export async function githubAuthentication (fallback: string, command = runGitHubToken): Promise<{token: string, source: string}> {
    try {
        const result = await command('gh auth token --hostname github.com', '', 4000)
        const token = result.stdout.trim()
        if (/^[A-Za-z0-9_]+$/.test(token)) return { token, source: 'GitHub CLI' }
    } catch { /* A missing CLI falls back to the saved token. */ }
    return { token: fallback, source: fallback ? 'Personal access token' : 'No credentials' }
}

/** Read-only account checks. Tokens never enter the result or error messages. */
export async function checkIntegrationAccount (integration: Integration, request = httpRequest, command = runGitHubToken, includeOrganizations = false): Promise<AccountIdentity> {
    const result: AccountIdentity = { state: 'error', message: '', organizations: [] }
    if (!integration.enabled) return { ...result, state: 'disabled', message: 'Integration disabled' }
    if (!integration.configured) return { ...result, state: 'unconfigured', message: 'Complete the required settings and credentials' }
    const provider = integration.manifest.account?.provider
    if (!provider) return { ...result, state: 'unsupported', message: 'This integration does not provide an account check' }
    let token = integration.credentials.token ?? ''
    let authorization = `Bearer ${token}`
    const get = async (url: string): Promise<any> => {
        const response = await request({ url, method: 'GET', headers: { authorization, accept: 'application/json', 'user-agent': 'Torbie' }, timeoutMs: 8000 })
        if (response.status !== 200) throw new Error(`Connection check failed (HTTP ${response.status})`)
        const json = JSON.parse(response.body)
        if (json.ok === false) throw new Error('The service rejected these credentials or their permissions')
        return json
    }
    try {
        if (provider === 'github') {
            const auth = await githubAuthentication(token, command)
            token = auth.token
            result.source = auth.source
            if (!token) throw new Error('Sign in with GitHub CLI or save a personal access token')
            authorization = `Bearer ${token}`
            const user = await get('https://api.github.com/user')
            if (!user.login) throw new Error('The account response did not identify a user')
            Object.assign(result, { name: user.name || user.login, login: user.login, avatar: user.avatar_url, link: user.html_url })
            const found = new Map<string, {login: string, avatar?: string}>()
            const add = (org: any) => { if (org?.login && preferredOwners(org.login).length) found.set(org.login.toLowerCase(), { login: org.login, avatar: org.avatar_url }) }
            // Fine-grained tokens can return no memberships. Accessible repository
            // owners supply organizations visible to that same token as well.
            let incomplete = false
            for (const resource of includeOrganizations ? ['orgs', 'repos'] : []) {
                try {
                    for (let page = 1; page <= 3; page++) {
                        const rows = await get(`https://api.github.com/user/${resource}?per_page=100&page=${page}`)
                        if (!Array.isArray(rows)) throw new Error('Unexpected organization response')
                        for (const row of rows) { if (resource === 'orgs') add(row); else if (row.owner?.type === 'Organization') add(row.owner) }
                        if (rows.length < 100) break
                        if (page === 3) incomplete = true
                    }
                } catch { incomplete = true }
            }
            result.organizations = [...found.values()].sort((a,b) => a.login.localeCompare(b.login))
            result.discoveryMessage = incomplete ? 'Some organizations may be missing because of token permissions or the discovery limit. You can add them manually.' : 'Organizations visible to the active credentials'
        } else if (provider === 'jira') {
            const raw = integration.settings.host ?? ''
            const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
            if (!host) throw new Error('Set the Jira site host')
            authorization = `Basic ${Buffer.from(`${integration.credentials.email ?? ''}:${token}`).toString('base64')}`
            const user = await get(`https://${host}/rest/api/3/myself`)
            if (!user.accountId && !user.name) throw new Error('The account response did not identify a user')
            Object.assign(result, { name: user.displayName || user.name, login: user.emailAddress || user.accountId || user.name, avatar: user.avatarUrls?.['48x48'], link: `https://${host}/jira/people/${encodeURIComponent(user.accountId || user.name)}`, source: 'API token' })
        } else if (provider === 'slack') {
            const user = await get('https://slack.com/api/auth.test')
            if (!user.user_id) throw new Error('The account response did not identify a user')
            Object.assign(result, { name: user.user, login: user.team, link: user.url, source: 'Slack token' })
            try {
                const details = await get(`https://slack.com/api/users.info?user=${encodeURIComponent(user.user_id)}`)
                result.name = details.user?.profile?.display_name || details.user?.real_name || result.name
                result.avatar = details.user?.profile?.image_72
            } catch { /* Identity is verified even without users:read. */ }
        } else return { ...result, state: 'unsupported', message: 'Account checks are unavailable for this provider' }
        result.state = 'connected'
        result.message = 'Connected'
    } catch (error) {
        // Use only our own messages; malformed JSON/network errors can contain
        // response bodies or request details and do not belong in the UI.
        const message = error instanceof Error ? error.message : ''
        result.message = /^(Connection check failed|The service rejected|Sign in with|Set the Jira|The account response)/.test(message) ? message : 'Could not verify the connection. Check the credentials and network, then retry.'
    }
    return result
}
