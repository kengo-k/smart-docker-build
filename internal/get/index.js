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
  branch: z.string(),
  only_changed: z.boolean().optional().default(true),
  with_branch_name: z.boolean().optional().default(true),
  with_timestamp: z.boolean().optional().default(true),
  with_commit_sha: z.boolean().optional().default(true),
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
  const { repository, after } = github.context.payload

  const compare = await octokit.repos.compareCommits({
    owner: repository.owner.login,
    repo: repository.name,
    base: after + '^',
    head: after,
  })

  const outputs = []
  for (const argObj of argObjs) {
    let buildRequired = false
    if (argObj.only_changed) {
      const dockerfile = compare.data.files.find(
        (file) => file.filename === argObj.path,
      )
      if (dockerfile) {
        buildRequired = true
      }
    } else {
      buildRequired = true
    }
    if (buildRequired) {
      const imageTags = []
      if (argObj.with_branch_name) {
        imageTags.push(argObj.branch)
      }
      if (argObj.with_timestamp) {
        const now = new Date()
        const formattedDate = format(toZonedTime(now, timezone), 'yyyyMMddHHmm')
        imageTags.push(formattedDate)
      }
      if (argObj.with_commit_sha) {
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
  setOutput('docker_command', JSON.stringify(outputs))
}

try {
  await main()
} catch (error) {
  setFailed(error.message)
}
