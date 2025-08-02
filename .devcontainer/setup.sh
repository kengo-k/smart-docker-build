#!/bin/bash

echo "🚀 Setting up development environment..."

# Install act (GitHub Actions local runner)
echo "📦 Installing act..."
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Make act available in PATH
sudo ln -sf /usr/local/bin/act /usr/bin/act

# Verify act installation
echo "✅ act version:"
act --version

# Install dependencies for the project
echo "📦 Installing project dependencies..."
cd /workspaces/smart-docker-build/internal/get
npm install

# Build the project
echo "🔨 Building project..."
npm run build

# Create act configuration
echo "⚙️ Creating act configuration..."
cd /workspaces/smart-docker-build

# Check if PERSONAL_ACCESS_TOKEN is available
if [ ! -z "$PERSONAL_ACCESS_TOKEN" ]; then
    echo "✅ GitHub token available from Codespaces secret"
    echo "   Use: act -s GITHUB_TOKEN=\$PERSONAL_ACCESS_TOKEN"
else
    echo "⚠️  PERSONAL_ACCESS_TOKEN not found. Please set it in Codespaces secrets"
    echo "   Or use: act -s GITHUB_TOKEN=your_token_here"
fi

cat > .actrc << EOF
# Use GitHub's ubuntu-latest image for better compatibility
-P ubuntu-latest=ghcr.io/catthehacker/ubuntu:act-latest
# Set default artifact server (optional)
--artifact-server-path /tmp/artifacts
# Use more verbose logging
--verbose
EOF

# Create sample workflow for testing
echo "📝 Creating sample test workflow..."
mkdir -p .github/workflows
cat > .github/workflows/test-action.yml << 'EOF'
name: Test Smart Docker Build Action

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test-action:
    runs-on: ubuntu-latest
    steps:
    - name: Checkout
      uses: actions/checkout@v4
      
    - name: Test smart-docker-build action
      uses: ./
      with:
        token: \${{ secrets.GITHUB_TOKEN }}
        timezone: 'UTC'
EOF

echo "🎉 Development environment setup complete!"
echo ""
echo "📋 Available commands:"
echo "  act                     - Run all workflows"
echo "  act -l                  - List available workflows"
echo "  act push                - Run push event workflows"
echo "  act pull_request        - Run pull request workflows"
echo "  act -j test-action      - Run specific job"
echo ""
echo "🔧 Development workflow:"
echo "  1. Make changes to your action code"
echo "  2. cd internal/get && npm run build"
echo "  3. act -j test-action (to test the action locally)"
echo ""
echo "💡 Tips:"
echo "  - Use 'act -n' for dry-run mode"
echo "  - Use 'act --list' to see all available jobs"
echo "  - Set GITHUB_TOKEN in .env file for API access"