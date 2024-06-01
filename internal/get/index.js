import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { load } from 'js-yaml'
import { z } from 'zod'

import { getInput, setFailed, setOutput } from '@actions/core'
import github from '@actions/github'
import { Octokit } from '@octokit/rest'

const schema = z.object({
  path: z.string(),
  name: z.string(),
  on_branch_changed: z.boolean().optional().default(true),
  on_branch_pushed: z.boolean().optional().default(true),
  on_tag_pushed: z.boolean().optional().default(true),
  include_branch_name: z.boolean().optional().default(true),
  include_timestamp: z.boolean().optional().default(true),
  include_commit_sha: z.boolean().optional().default(true),
})

async function main() {
  const token = getInput('token')
  const timezone = getInput('timezone')
  const args = load(getInput('args'))
  const argObjs = []
  for (const arg of args) {
    argObjs.push(schema.parse(arg))
  }

  console.log('timezone:', timezone)
  console.log('args:', argObjs)

  const octokit = new Octokit({ auth: token })
  const { repository, after, ref } = github.context.payload

  const compare = await octokit.repos.compareCommits({
    owner: repository.owner.login,
    repo: repository.name,
    base: after + '^',
    head: after,
  })

  let branch
  let tag

  if (ref.startsWith('refs/heads/')) {
    branch = ref.replace('refs/heads/', '')
  } else if (ref.startsWith('refs/tags/')) {
    tag = ref.replace('refs/tags/', '')
  } else {
    throw new Error(`Unsupported ref: ${ref}`)
  }

  const outputs = []
  for (const argObj of argObjs) {
    if (tag && argObj.on_tag_pushed) {
      outputs.push({
        path: argObj.path,
        name: argObj.name,
        tag,
      })
    }

    let buildRequired = false
    if (argObj.on_branch_changed) {
      const dockerfile = compare.data.files.find(
        (file) => file.filename === argObj.path,
      )
      if (dockerfile) {
        buildRequired = true
      }
    } else {
      buildRequired = true
    }

    if (!buildRequired) {
      console.log(`${argObj.path} has not changed, skipping build`)
      continue
    }

    if (branch && argObj.on_branch_pushed) {
      const imageTags = []
      if (argObj.include_branch_name) {
        imageTags.push(branch)
      }
      if (argObj.include_timestamp) {
        const now = new Date()
        const formattedDate = format(toZonedTime(now, timezone), 'yyyyMMddHHmm')
        imageTags.push(formattedDate)
      }
      if (argObj.include_commit_sha) {
        imageTags.push(after)
      }
      const tag = imageTags.join('-')

      outputs.push({
        path: argObj.path,
        name: argObj.name,
        tag,
      })
    }
  }
  setOutput('build_args', JSON.stringify(outputs))
}

try {
  await main()
} catch (error) {
  setFailed(error.message)
}
