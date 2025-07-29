# Smart Docker Build

[![Tests](https://github.com/kengo-k/smart-docker-build/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/kengo-k/smart-docker-build/actions/workflows/test.yml)
[![Format](https://github.com/kengo-k/smart-docker-build/actions/workflows/format.yml/badge.svg?branch=main)](https://github.com/kengo-k/smart-docker-build/actions/workflows/format.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action that **intelligently** builds and pushes Docker images with zero configuration required. Automatically detects Dockerfiles, generates smart image names, and creates flexible tags using customizable templates.

## 🚀 Key Features

- **🔍 Zero Configuration**: Works out-of-the-box for single Dockerfile projects
- **🧠 Smart Detection**: Automatically finds and processes all Dockerfiles
- **🏷️ Flexible Tagging**: Template-based tag generation with variables
- **⚙️ Easy Customization**: Optional configuration file for advanced control
- **🔄 Change Detection**: Only builds when Dockerfiles are modified (configurable)
- **📦 GHCR Support**: Push to GitHub Container Registry (DockerHub coming soon)

## 🎯 Quick Start

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
- 🔍 Detect your `Dockerfile` automatically
- 🏷️ Use repository name as image name
- 📦 Build and push to `ghcr.io/username/repo-name`
- 🏷️ Generate tags like `main-202501291430-abc1234` (branch) or `v1.0.0` (release)

## 📋 Usage Examples

### Multi-Service Projects

For projects with multiple Dockerfiles, add `# Image:` comments:

```dockerfile
# Image: my-api-server
FROM node:18
WORKDIR /app
# ... rest of your Dockerfile
```

```dockerfile
# Image: background-worker
FROM python:3.11
WORKDIR /app
# ... rest of your Dockerfile
```

### Custom Tag Templates

Create `smart-docker-build.yml` in your project root:

```yaml
tags:
  # Release tags: v1.0.0 + latest
  tag_pushed: ["{tag}", "latest"]

  # Branch tags: feature-auth-abc1234
  branch_pushed: ["{branch}-{sha}"]

build:
  on_branch_push: true   # Build on branch push (when Dockerfile changes)
  on_tag_push: true      # Build on tag/release (always)
```

### Advanced Configuration

```yaml
- uses: kengo-k/smart-docker-build@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    # Override default timezone for timestamps
    timezone: 'Asia/Tokyo'
    # Custom tag templates
    tags: |
      tag_pushed: ["{tag}", "latest", "stable"]
      branch_pushed: ["{branch}-{timestamp}"]
    # Custom build triggers
    build: |
      on_branch_push: false  # Only build on releases
      on_tag_push: true
    # Explicit image specification (highest priority)
    images: |
      - dockerfile: api/Dockerfile
        name: my-api
      - dockerfile: worker/Dockerfile.prod
        name: my-worker
```

## 🏷️ Tag Template Variables

Customize your image tags using these variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `{tag}` | Git tag name | `v1.0.0`, `release-2024` |
| `{branch}` | Branch name | `main`, `feature-auth` |
| `{sha}` | Short commit SHA | `abc1234` |
| `{timestamp}` | Build timestamp | `202501291430` |
| `{repo}` | Repository name | `my-awesome-app` |

### Tag Examples

```yaml
tags:
  tag_pushed: ["{tag}"]                    # → v1.0.0
  tag_pushed: ["{tag}", "latest"]          # → v1.0.0, latest
  branch_pushed: ["{branch}-{sha}"]        # → main-abc1234
  branch_pushed: ["{repo}-{timestamp}"]    # → my-app-202501291430
```

## 🎛️ Configuration Options

### Project Configuration File

Create `smart-docker-build.yml` in your project root:

```yaml
# Tag generation templates
tags:
  tag_pushed: ["{tag}", "latest"]                    # Git tag pushes
  branch_pushed: ["{branch}-{timestamp}-{sha}"]     # Branch pushes

# Build triggers
build:
  on_branch_push: true    # Build when branch is pushed (only if Dockerfile changed)
  on_tag_push: true       # Build when tag is pushed (always build)
```

### Action Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `token` | ✅ | - | GitHub token for repository access and GHCR push |
| `timezone` | ❌ | `UTC` | Timezone for `{timestamp}` variable |
| `tags` | ❌ | - | YAML string overriding tag templates |
| `build` | ❌ | - | YAML string overriding build triggers |
| `images` | ❌ | - | YAML array for explicit image specifications |

## 🔍 Image Name Detection

The action determines image names using this priority order:

1. **Explicit specification** (highest priority)
   ```yaml
   images: |
     - dockerfile: api/Dockerfile
       name: my-api-server
   ```

2. **Dockerfile comment**
   ```dockerfile
   # Image: my-custom-name
   FROM alpine:3.18
   ```

3. **Single Dockerfile fallback**
   - Repository name (only if exactly 1 Dockerfile exists)

4. **Error** (multiple Dockerfiles without names)
   ```
   ❌ Multiple Dockerfiles found but no image name specified for worker/Dockerfile
   💡 Solutions:
      - Add comment: # Image: my-worker
      - Use explicit images parameter
   ```

## 📁 Project Structure Examples

### Single Service
```
my-app/
└── Dockerfile
```
✅ **Result**: Image name `my-app` (automatic)

### Multi-Service
```
microservices/
├── api/
│   └── Dockerfile          # Image: user-api
├── worker/
│   └── Dockerfile          # Image: task-worker
└── web/
    └── Dockerfile.prod     # Image: frontend
```
✅ **Result**: Three images with specified names

### Mixed Configuration
```
hybrid-app/
├── smart-docker-build.yml  # Project-wide tag strategy
├── main/
│   └── Dockerfile          # Image: main-app
└── tools/
    └── Dockerfile          # Image: build-tools
```
✅ **Result**: Custom tags + specified names

## 🚀 Default Behavior

When no configuration file exists:

- **Branch pushes**: Build only when Dockerfile changes, tag as `{branch}-{timestamp}-{sha}`
- **Tag pushes**: Always build, tag as `{tag}`
- **Registry**: GitHub Container Registry (GHCR)
- **Timezone**: UTC

## 🔄 How It Works

1. **Detection**: Scans repository for all Dockerfiles (skips `node_modules`, `.git`, etc.)
2. **Naming**: Determines image names using priority rules
3. **Change Check**: For branch pushes, only builds if Dockerfile was modified
4. **Tag Generation**: Creates tags from templates with variable substitution
5. **Build & Push**: Uses Docker to build and push to GHCR

## 🛠️ Advanced Usage

### Custom Timezone
```yaml
- uses: kengo-k/smart-docker-build@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    timezone: 'America/New_York'  # Affects {timestamp} variable
```

### Release-Only Builds
```yaml
# smart-docker-build.yml
build:
  on_branch_push: false  # Skip branch builds
  on_tag_push: true      # Only build on releases
```

### Multiple Tags per Push
```yaml
tags:
  tag_pushed: ["{tag}", "latest", "stable"]
  branch_pushed: ["{branch}-{sha}", "{branch}-latest"]
```

## 🤝 Contributing

Issues and pull requests are welcome! Please see our [contributing guidelines](CONTRIBUTING.md).

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Made with ❤️ for the GitHub Actions community**
