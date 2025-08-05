# Smart Docker Build

[![Tests](https://github.com/kengo-k/smart-docker-build/actions/workflows/unit-test.yml/badge.svg?branch=main)](https://github.com/kengo-k/smart-docker-build/actions/workflows/unit-test.yml)
[![Format](https://github.com/kengo-k/smart-docker-build/actions/workflows/format.yml/badge.svg?branch=main)](https://github.com/kengo-k/smart-docker-build/actions/workflows/format.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action that **intelligently** builds and pushes Docker images with zero configuration required. Automatically detects Dockerfiles, generates smart image names, and creates flexible tags using customizable templates.

## Key Features

- **Zero Configuration**: Works out-of-the-box for single Dockerfile projects
- **Smart Detection**: Automatically finds and processes all Dockerfiles (`Dockerfile` and `Dockerfile.*`)
- **Flexible Tagging**: Template-based tag generation with variables
- **Simple Configuration**: Only 2 ways to configure - project file or Dockerfile comments
- **Smart Change Detection**: Builds when relevant files change (customizable watch patterns)
- **Tag Protection**: Prevents accidental overwrite of existing image tags
- **GHCR Support**: Push to GitHub Container Registry (DockerHub coming soon)

## Quick Start

### Simple Project (Zero Configuration)

For projects with a single `Dockerfile` in the root:

```yaml
name: Build Docker Image
on:
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: kengo-k/smart-docker-build@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

**That's it!** The action will:
- Detect your `Dockerfile` automatically
- Use repository name as image name
- Build and push to `ghcr.io/username/repo-name`
- Generate tags like `main-202501291430-abc1234` (branch) or `v1.0.0` (release)

## Configuration Methods

There are only **2 simple ways** to configure this action:

### 1. Project Configuration File

Create `smart-docker-build.yml` in your project root for custom tag templates:

```yaml
# Image tag generation templates
imageTagsOnTagPushed: ["{tag}"]                           # Git tag pushes
imageTagsOnBranchPushed: ["{branch}-{timestamp}-{sha}", "latest"]  # Branch pushes

# File watching (optional)
watchFiles: ["package.json", "src/**/*", "Dockerfile*"]    # Build only when these files change
```

### 2. Dockerfile Comments

For projects with multiple Dockerfiles, add `# image:` comments to specify image names and optionally override tag configurations:

```dockerfile
# image: my-api-server
FROM node:18
WORKDIR /app
# ... rest of your Dockerfile
```
**Result**: Creates `my-api-server:v1.0.0` on tag push, `my-api-server:main-202501291430-abc1234` and `my-api-server:latest` on branch push

```dockerfile
# image: my-devcontainer
# imageTagsOnTagPushed: null
# imageTagsOnBranchPushed: ["v1.0"]
# watchFiles: ["Dockerfile", ".devcontainer/**/*"]
FROM mcr.microsoft.com/devcontainers/base:ubuntu
WORKDIR /workspace
# ... rest of your Dockerfile
```
**Result**: Creates `my-devcontainer:v1.0` on branch push only when Dockerfile or .devcontainer files change

## Tag Template Variables

Customize your image tags using these variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `{tag}` | Git tag name | `v1.0.0`, `release-2024` |
| `{branch}` | Branch name | `main`, `feature-auth` |
| `{sha}` | Short commit SHA | `abc1234` |
| `{timestamp}` | Build timestamp | `202501291430` |

### Tag Examples

```yaml
imageTagsOnTagPushed: ["{tag}"]                    # → v1.0.0
imageTagsOnTagPushed: ["{tag}", "latest"]          # → v1.0.0, latest
imageTagsOnBranchPushed: ["{branch}-{sha}"]        # → main-abc1234
imageTagsOnBranchPushed: ["{branch}-{timestamp}", "latest"]  # → main-202501291430, latest
```

## Action Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `token` | ✅ | - | GitHub token for repository access and GHCR push |
| `timezone` | ❌ | `UTC` | Timezone for `{timestamp}` variable |

### Custom Timezone Example

```yaml
- uses: kengo-k/smart-docker-build@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    timezone: 'Asia/Tokyo'  # Affects {timestamp} variable
```

## Image Name Detection

The action determines image names using this priority order:

1. **Dockerfile comment** (recommended for multiple Dockerfiles)
   ```dockerfile
   # image: my-custom-name
   FROM alpine:3.18
   ```

2. **Single Dockerfile fallback**
   - Repository name (only if exactly 1 Dockerfile exists)

3. **Error** (multiple Dockerfiles without names)
   ```
   Multiple Dockerfiles found but no image name specified for worker/Dockerfile
   Solutions:
      - Add comment: # image: my-worker
      - Create smart-docker-build.yml with explicit image configurations
   ```

## Project Structure Examples

### Single Service
```
my-app/
└── Dockerfile
```
**Result**: Image name `my-app` (automatic)

### Multi-Service
```
microservices/
├── api/
│   └── Dockerfile          # image: user-api
├── worker/
│   └── Dockerfile          # image: task-worker
└── web/
    ├── Dockerfile.prod     # image: frontend
    └── Dockerfile.dev      # image: frontend-dev
```
**Result**: Four images with specified names (supports `Dockerfile.*` patterns)

### Custom Configuration
```
hybrid-app/
├── smart-docker-build.yml  # Project-wide tag strategy
├── main/
│   └── Dockerfile          # image: main-app
└── devcontainer/
    └── Dockerfile          # image: my-devcontainer
                            # imageTagsOnTagPushed: null
```
**Result**: Custom tags + specified names

## Default Behavior

When no `smart-docker-build.yml` configuration file exists, the action uses these default settings:

```yaml
# Default configuration (equivalent to no config file)
imageTagsOnTagPushed: ["{tag}"]
imageTagsOnBranchPushed: ["{branch}-{timestamp}-{sha}", "latest"]
watchFiles: []  # Empty = always build
```

**Behavior**:
- **Branch pushes**: Always build, tag as `{branch}-{timestamp}-{sha}` and `latest`
- **Tag pushes**: Always build, tag as `{tag}`
- **File watching**: Always build (empty `watchFiles` means no file filtering)
- **Registry**: GitHub Container Registry (GHCR)
- **Timezone**: UTC

## How It Works

1. **Detection**: Scans repository for all Dockerfiles - files named `Dockerfile` or `Dockerfile.*` (e.g., `Dockerfile.prod`, `Dockerfile.dev`) while skipping `node_modules`, `.git`, etc.
2. **Naming**: Determines image names using priority rules
3. **Change Check**: For branch pushes, only builds if Dockerfile was modified
4. **Tag Generation**: Creates tags from templates with variable substitution
5. **Build & Push**: Uses Docker to build and push to GHCR

## Advanced Examples

### Release-Only Builds
```yaml
# smart-docker-build.yml
imageTagsOnBranchPushed: null  # Skip branch builds
imageTagsOnTagPushed: ["{tag}"]  # Only build on releases
```

### Multiple Tags per Push
```yaml
# smart-docker-build.yml
imageTagsOnTagPushed: ["{tag}", "stable"]
imageTagsOnBranchPushed: ["{branch}-{sha}", "latest", "{branch}-latest"]
```

### Development vs Production
```yaml
# smart-docker-build.yml
# Development builds
imageTagsOnBranchPushed: ["dev-{branch}-{timestamp}", "latest"]

# Production releases
imageTagsOnTagPushed: ["{tag}", "production"]

# Watch specific files for development workflow
watchFiles: ["package.json", "src/**/*", "Dockerfile*"]
```

## Contributing

Issues and pull requests are welcome! Please see our [contributing guidelines](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE) file for details.
