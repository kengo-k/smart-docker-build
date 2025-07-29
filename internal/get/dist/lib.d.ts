import { Octokit } from '@octokit/rest'

export interface Config {
  tags: {
    tag_pushed: string[]
    branch_pushed: string[]
  }
  build: {
    on_branch_push: boolean
    on_tag_push: boolean
  }
}
export interface ImageSpec {
  dockerfile: string
  name: string
}
export interface BuildArg {
  path: string
  name: string
  tag: string
}
export interface GenerateBuildArgsResult {
  buildArgs: BuildArg[]
  validationErrors: string[]
}
export interface TemplateVariables {
  [key: string]: string
}
export interface GitRef {
  branch: string | null
  tag: string | null
}
export interface GitHubContext {
  payload: {
    repository?: {
      name: string
      owner: {
        login: string
      }
    }
    after?: string
    ref?: string
  }
}
export declare function loadProjectConfig(workingDir?: string): Config
export declare function findDockerfiles(workingDir?: string): Promise<string[]>
export declare function extractImageNameFromDockerfile(
  dockerfilePath: string,
  workingDir?: string,
): string | null
export declare function validateDockerfile(
  dockerfilePath: string,
  workingDir?: string,
): boolean
export declare function getRepositoryChanges(
  octokit: Octokit,
  repository: {
    owner: {
      login: string
    }
    name: string
  },
  after: string,
): Promise<
  import('@octokit/types').OctokitResponse<
    {
      url: string
      html_url: string
      permalink_url: string
      diff_url: string
      patch_url: string
      base_commit: import('@octokit/openapi-types').components['schemas']['commit']
      merge_base_commit: import('@octokit/openapi-types').components['schemas']['commit']
      status: 'diverged' | 'ahead' | 'behind' | 'identical'
      ahead_by: number
      behind_by: number
      total_commits: number
      commits: import('@octokit/openapi-types').components['schemas']['commit'][]
      files?: import('@octokit/openapi-types').components['schemas']['diff-entry'][]
    },
    200
  >
>
export declare function parseGitRef(ref: string): GitRef
export declare function shouldBuildForChanges(
  argObj: {
    on_branch_changed?: boolean
    path: string
  },
  changedFiles: {
    filename: string
  }[],
): boolean
export declare function generateImageTag(
  argObj: {
    include_branch_name?: boolean
    include_timestamp?: boolean
    include_commit_sha?: boolean
  },
  branch: string | null,
  timezone: string,
  after: string,
): string
export declare function generateTagsFromTemplates(
  templates: string[],
  variables: TemplateVariables,
): string[]
export declare function createTemplateVariables(
  branch: string | null,
  tag: string | null,
  timezone: string,
  sha: string,
  repositoryName: string,
): TemplateVariables
export declare function generateBuildArgs(
  token: string,
  timezone: string,
  tagsYaml: string,
  buildYaml: string,
  imagesYaml: string,
  githubContext: GitHubContext,
  workingDir?: string,
): Promise<GenerateBuildArgsResult>
