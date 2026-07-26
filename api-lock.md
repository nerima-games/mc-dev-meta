# API lock — @nerima-games/mc-dev-meta

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 56
supporting declarations: 0

## Exported

### ALLOWED_URL_PATTERN  `const`

```ts
const ALLOWED_URL_PATTERN: RegExp;
```

### DEPENDENCY_GRAPH  `const`

```ts
const DEPENDENCY_GRAPH: ReadonlyMap<string, ReadonlySet<string>>;
```

### DESTRUCTIVE_GIT_ARGUMENTS  `const`

```ts
const DESTRUCTIVE_GIT_ARGUMENTS: ReadonlyArray<string>;
```

### DEV_ONLY_REPOSITORY  `const`

```ts
const DEV_ONLY_REPOSITORY = "mc-playground-kit";
```

### KERNEL_REPOSITORY  `const`

```ts
const KERNEL_REPOSITORY = "mc-kernel";
```

### MANAGED_REPOSITORY_NAMES  `const`

```ts
const MANAGED_REPOSITORY_NAMES: ReadonlyArray<string>;
```

### MANIFEST_FILENAME  `const`

```ts
const MANIFEST_FILENAME = "repos.json";
```

### MANIFEST_VERSION  `const`

```ts
const MANIFEST_VERSION = 1;
```

### Manifest  `type`

```ts
type Manifest = {
    readonly manifestVersion: number;
    readonly repositories: ReadonlyArray<ManifestEntry>;
};
```

### ManifestEntry  `type`

```ts
type ManifestEntry = {
    readonly name: string;
    readonly url: string;
    readonly ref: RepositoryRef;
};
```

### ManifestError  `type`

```ts
type ManifestError = {
    readonly _tag: 'NotJson';
    readonly detail: string;
} | {
    readonly _tag: 'NotAnObject';
} | {
    readonly _tag: 'UnsupportedManifestVersion';
    readonly found: unknown;
    readonly supported: number;
} | {
    readonly _tag: 'RepositoriesNotAnArray';
} | {
    readonly _tag: 'EntryNotAnObject';
    readonly index: number;
} | {
    readonly _tag: 'MissingField';
    readonly index: number;
    readonly field: string;
} | {
    readonly _tag: 'InvalidRef';
    readonly name: string;
    readonly ref: string;
} | {
    readonly _tag: 'InvalidUrl';
    readonly name: string;
    readonly url: string;
} | {
    readonly _tag: 'UrlNameMismatch';
    readonly name: string;
    readonly url: string;
    readonly found: string;
} | {
    readonly _tag: 'DuplicateRepository';
    readonly name: string;
} | {
    readonly _tag: 'UnknownRepository';
    readonly name: string;
} | {
    readonly _tag: 'MissingRepository';
    readonly name: string;
};
```

### ORG_SCOPE  `const`

```ts
const ORG_SCOPE = "@nerima-games";
```

### PINNED_REF_PATTERN  `const`

```ts
const PINNED_REF_PATTERN: RegExp;
```

### Parsed  `type`

```ts
type Parsed<A> = {
    readonly ok: true;
    readonly value: A;
} | {
    readonly ok: false;
    readonly error: ManifestError;
};
```

### REPOSITORIES  `const`

```ts
const REPOSITORIES: ReadonlyArray<RepositoryEntry>;
```

### REPOSITORY_NAMES  `const`

```ts
const REPOSITORY_NAMES: ReadonlyArray<string>;
```

### REPOS_DIRECTORY  `const`

```ts
const REPOS_DIRECTORY = "repos";
```

### RepositoryEntry  `type`

```ts
type RepositoryEntry = {
    readonly name: string;
    readonly tier: Tier;
    readonly dependsOn: ReadonlyArray<string>;
    readonly devDependsOn: ReadonlyArray<string>;
    readonly responsibility: string;
};
```

### RepositoryRef  `type`

```ts
type RepositoryRef = string;
```

### SyncAction  `type`

```ts
type SyncAction = {
    readonly _tag: 'Clone';
    readonly name: string;
    readonly url: string;
    readonly ref: string;
} | {
    readonly _tag: 'Fetch';
    readonly name: string;
    readonly reason: 'ref-not-local' | 'unpinned';
} | {
    readonly _tag: 'Checkout';
    readonly name: string;
    readonly ref: string;
} | {
    readonly _tag: 'AlreadyAtRef';
    readonly name: string;
    readonly ref: string;
} | {
    readonly _tag: 'UpToDate';
    readonly name: string;
} | {
    readonly _tag: 'SkipDirty';
    readonly name: string;
};
```

### SyncSummary  `type`

```ts
type SyncSummary = {
    readonly cloned: ReadonlyArray<string>;
    readonly fetched: ReadonlyArray<string>;
    readonly checkedOut: ReadonlyArray<string>;
    readonly unchanged: ReadonlyArray<string>;
    readonly skippedDirty: ReadonlyArray<string>;
};
```

### Tier  `type`

```ts
type Tier = 'stable-library' | 'foundation' | 'experience' | 'composition' | 'workspace-tooling';
```

### UNPINNED  `const`

```ts
const UNPINNED = "unpinned";
```

### WORKSPACE_PACKAGES_GLOB  `const`

```ts
const WORKSPACE_PACKAGES_GLOB = "repos/*";
```

### WorkingCopyState  `type`

```ts
type WorkingCopyState = {
    readonly _tag: 'Absent';
} | {
    readonly _tag: 'Present';
    readonly head: string;
    readonly dirty: boolean;
    readonly hasPinnedRef: boolean;
    readonly fetchedThisRun: boolean;
};
```

### WorkspaceRunPlan  `type`

```ts
type WorkspaceRunPlan = {
    readonly status: WorkspaceStatus;
    readonly targets: ReadonlyArray<ManifestEntry>;
    readonly missing: ReadonlyArray<string>;
    readonly unmanaged: ReadonlyArray<string>;
    readonly unpinned: ReadonlyArray<string>;
};
```

### WorkspaceStatus  `type`

```ts
type WorkspaceStatus = 'empty' | 'partial' | 'complete';
```

### applyAction  `const`

```ts
const applyAction: (entry: ManifestEntry, state: WorkingCopyState, action: SyncAction) => WorkingCopyState;
```

### buildOrder  `const`

```ts
const buildOrder: () => ReadonlyArray<string> | undefined;
```

### defaultCloneUrl  `const`

```ts
const defaultCloneUrl: (repositoryName: string) => string;
```

### describeAction  `const`

```ts
const describeAction: (action: SyncAction) => string;
```

### describeManifestError  `const`

```ts
const describeManifestError: (error: ManifestError) => string;
```

### describeWorkspaceRun  `const`

```ts
const describeWorkspaceRun: (plan: WorkspaceRunPlan, command: string) => ReadonlyArray<string>;
```

### entryNamed  `const`

```ts
const entryNamed: (manifest: Manifest, name: string) => ManifestEntry | undefined;
```

### fetchesFromRemote  `const`

```ts
const fetchesFromRemote: (action: SyncAction) => boolean;
```

### gitCommandsFor  `const`

```ts
const gitCommandsFor: (action: SyncAction, directory: string) => ReadonlyArray<ReadonlyArray<string>>;
```

### isAllowedUrl  `const`

```ts
const isAllowedUrl: (url: string) => boolean;
```

### isDestructiveGitCommand  `const`

```ts
const isDestructiveGitCommand: (argv: ReadonlyArray<string>) => boolean;
```

### isNoOp  `const`

```ts
const isNoOp: (action: SyncAction) => boolean;
```

### isOptionLike  `const`

```ts
const isOptionLike: (value: string) => boolean;
```

### isPinned  `const`

```ts
const isPinned: (ref: RepositoryRef) => boolean;
```

### isValidRef  `const`

```ts
const isValidRef: (ref: RepositoryRef) => boolean;
```

### packageNameOf  `const`

```ts
const packageNameOf: (repositoryName: string) => string;
```

### parseManifest  `const`

```ts
const parseManifest: (raw: string) => Parsed<Manifest>;
```

### planAll  `const`

```ts
const planAll: (entries: ReadonlyArray<ManifestEntry>, observe: (entry: ManifestEntry) => WorkingCopyState) => ReadonlyArray<SyncAction>;
```

### planSync  `const`

```ts
const planSync: (entry: ManifestEntry, state: WorkingCopyState) => SyncAction;
```

### planWorkspaceRun  `const`

```ts
const planWorkspaceRun: (manifest: Manifest, presentDirectories: ReadonlyArray<string>) => WorkspaceRunPlan;
```

### repositoriesInTier  `const`

```ts
const repositoriesInTier: (tier: Tier) => ReadonlyArray<RepositoryEntry>;
```

### repositoryNameInUrl  `const`

```ts
const repositoryNameInUrl: (url: string) => string | undefined;
```

### repositoryNamed  `const`

```ts
const repositoryNamed: (name: string) => RepositoryEntry | undefined;
```

### serialiseManifest  `const`

```ts
const serialiseManifest: (manifest: Manifest) => string;
```

### settle  `const`

```ts
const settle: (entry: ManifestEntry, from: WorkingCopyState, maxRounds?: number) => {
    readonly actions: ReadonlyArray<SyncAction>;
    readonly state: WorkingCopyState;
};
```

### summarise  `const`

```ts
const summarise: (actions: ReadonlyArray<SyncAction>) => SyncSummary;
```

### unpinnedEntries  `const`

```ts
const unpinnedEntries: (manifest: Manifest) => ReadonlyArray<ManifestEntry>;
```

### validateAgainstRoster  `const`

```ts
const validateAgainstRoster: (manifest: Manifest, rosterNames: ReadonlyArray<string>) => Parsed<Manifest>;
```

### withPinnedRef  `const`

```ts
const withPinnedRef: (manifest: Manifest, name: string, ref: RepositoryRef) => Parsed<Manifest>;
```
