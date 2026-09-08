import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class UpstreamConfigProvider extends ConfigProvider {
    defaults = {
        upstream: {
            /** The checkout to report on. Empty means "find it from this build". */
            repositoryPath: '',
            /** The remote holding the project this fork tracks. */
            remote: 'upstream',
            /** The branch on it that `master` here mirrors. */
            branch: 'master',
            /**
             * Mark every setting this fork added with a filled diamond.
             *
             * Off by default: it is an answer to a question most sessions never
             * ask. Nothing in the running program said which behaviour is ours
             * and which is upstream's — every row is drawn identically whether
             * Tabby shipped it or this fork added it, which makes the divergence
             * invisible at exactly the moment you are deciding whether to change
             * something.
             */
            showForkMarks: false,
            /**
             * Mark, with a hollow diamond, settings that exist in upstream Tabby
             * but that it gives no control for — you can only set them by hand
             * in `config.yaml`. The lesser claim, so the quieter mark.
             */
            showConfigOnlyMarks: false,
        },
    }

    platformDefaults = { }
}
