# Docker Image Builder

[![Tests](https://github.com/kengo-k/smart-docker-build/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/kengo-k/smart-docker-build/actions/workflows/test.yml)
[![Format](https://github.com/kengo-k/smart-docker-build/actions/workflows/format.yml/badge.svg?branch=main)](https://github.com/kengo-k/smart-docker-build/actions/workflows/format.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This GitHub Action automatically builds Docker images and pushes them to the GitHub Container Registry (GHCR) whenever a Dockerfile is committed to a repository and a branch or tag is pushed.

## Usage

To use this action in your workflow, add the following step to your `.github/workflows/main.yml` file:

```yaml
name: 'Test to publish Docker image'
on:
  push:
    branches:
      - main
    tags:
      - '*'

jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - name: 'Test'
        uses: kengo-k/actions-docker-build@v1
        with:
          token: ${{ secrets.GHCR_TOKEN }}
          timezone: 'Asia/Tokyo'
          args: |
            - path: <path-to-your-Dockerfile>
              name: <your-image-name>
              on_branch_pushed: true
              on_branch_changed: true
              on_tag_pushed: true
              include_branch_name: true
              include_timestamp: true
              include_commit_sha: true
```

### Input Arguments

- `token` (required): A token with permissions to access the GitHub repository information and push images to GHCR.
- `timezone` (optional): The timezone used for generating timestamps in the image tags. Default is UTC.
- `args` (required): An array of objects specifying the configuration values for building Dockerfiles. Each object should contain the following properties:
  - `path` (required): The path to the Dockerfile.
  - `name` (required): The name of the built image.
  - `on_branch_pushed` (optional): Whether to build the image when a branch is pushed. Default is `true`.
  - `on_branch_changed` (optional): If `on_branch_pushed` is `true`, only build the image if the Dockerfile is included in the commit. Default is `true`.
  - `on_tag_pushed` (optional): Whether to build the image when a tag is pushed. Default is `true`.
  - `include_branch_name` (optional): Whether to include the branch name in the image tag when a branch is pushed. Default is `true`.
  - `include_timestamp` (optional): Whether to include a timestamp in the image tag when a branch is pushed. Default is `true`.
  - `include_commit_sha` (optional): Whether to include the commit ID in the image tag when a branch is pushed. Default is `true`.

## How It Works

When a branch or tag is pushed to the repository, this action will:

1. Check if a Dockerfile is present in the repository based on the provided `path` in the `args` configuration.
2. If `on_branch_pushed` is `true` and the push event is for a branch, build the Docker image.
3. If `on_branch_changed` is `true`, only build the image if the Dockerfile is included in the commit.
4. If `on_tag_pushed` is `true` and the push event is for a tag, build the Docker image.
5. Generate an image tag based on the specified options (`include_branch_name`, `include_timestamp`, `include_commit_sha`).
6. Build the Docker image using the provided Dockerfile and image name.
7. Push the built image to the GitHub Container Registry (GHCR) using the generated tag.

This action simplifies the process of building and pushing Docker images to GHCR, making it easier to automate your container deployment workflow.

---

## 🚧 Planned UX Improvements (Under Development)

The current version requires explicit configuration for each Dockerfile. We are working on a more user-friendly approach:

### Current Version (v1.0)
```yaml
- uses: kengo-k/smart-docker-build@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    args: |
      - path: api/Dockerfile
        name: my-api
      - path: worker/Dockerfile
        name: my-worker
```

### Planned Version (v1.1+) - Zero Configuration
```yaml
# Automatic Dockerfile detection and smart image naming
- uses: kengo-k/smart-docker-build@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    # That's it! Everything else is automatic
```

### Smart Image Naming Rules (Priority Order)
0. **Explicit args specification**: Highest priority, maintains backward compatibility
1. **Configuration file**: `.docker-image.yml` or `docker-image.json` in same directory
2. **Dockerfile comment**: `# Image: my-custom-image` at the top of Dockerfile
3. **Single Dockerfile fallback**: Repository name (only when repository contains exactly one Dockerfile)
4. **Multiple Dockerfiles**: Error if no explicit naming found

### Examples

#### Mixed Usage (Explicit + Automatic)
```yaml
- uses: kengo-k/smart-docker-build@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    args: |
      - path: api/Dockerfile
        name: explicit-api  # Explicit specification (priority 0)
      # worker/Dockerfile will be auto-detected and named automatically
```

#### Directory Structure Examples
```
my-repo/
└── Dockerfile  # No config → Image name: "my-repo" (fallback)

multi-service/
├── api/
│   ├── Dockerfile  # Image: api-server (comment)
│   └── .docker-image.yml  # name: custom-api (config file wins)
└── worker/Dockerfile  # No config → ERROR (multiple Dockerfiles)
```

#### Dockerfile Comment Examples

Add image name directly in your Dockerfile:

```dockerfile
# Image: my-api-server
FROM node:18

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```dockerfile
# Image: database-migration
FROM alpine:3.18

RUN apk add --no-cache postgresql-client
COPY scripts/ /scripts/
CMD ["/scripts/migrate.sh"]
```

This approach provides:
- **Zero configuration** for simple cases (single Dockerfile)
- **Explicit control** when needed (multiple services)
- **Predictable behavior** (no unexpected image names)
- **Clear error messages** with solution guidance

### Global Configuration File

Create `smart-docker-build.yml` in your project root for custom tag strategies:

```yaml
# Smart Docker Build Configuration
# Place this file in your project root

# Tag generation templates
tags:
  # Tags generated when a Git tag is pushed
  tag_pushed: ["{tag}", "latest"]
  
  # Tags generated when a branch is pushed  
  branch_pushed: ["{branch}-{timestamp}-{sha}"]

# Build triggers
build:
  # Build when branch is pushed (only if Dockerfile changed)
  on_branch_push: true
  
  # Build when tag is pushed (always build for releases)
  on_tag_push: true

# Available template variables:
# {tag}       - Git tag name (e.g., "v1.0.0") 
# {branch}    - Branch name (e.g., "main", "feature/auth")
# {sha}       - Short commit SHA (e.g., "abc1234")
# {timestamp} - Timestamp in YYYYMMDDHHMM format
# {repo}      - Repository name
```

### Default Behavior (No Configuration File)

When no `smart-docker-build.yml` exists, these defaults are used:

```yaml
tags:
  tag_pushed: ["{tag}"]                        # Simple tag names
  branch_pushed: ["{branch}-{timestamp}-{sha}"] # Detailed branch tags

build:
  on_branch_push: true  # Build on branch push (only if Dockerfile changed)
  on_tag_push: true     # Build on tag push (always build for releases)
```

**Complete zero-config example:**
```
my-app/
└── Dockerfile
```
- Image name: `my-app` (repository name)
- Tag examples: `v1.0.0` (on tag), `main-202501291430-abc1234` (on branch)
