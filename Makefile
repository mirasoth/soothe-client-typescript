# Makefile for @mirasoth/soothe-client
#
# Common developer and release tasks. Run `make help` to list targets.

SHELL := /bin/bash

PKG_NAME    := $(shell node -p "require('./package.json').name")
PKG_VERSION := $(shell node -p "require('./package.json').version")

.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show this help message
	@echo "$(PKG_NAME)@$(PKG_VERSION)"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# Install / clean
# ---------------------------------------------------------------------------

.PHONY: install
install: ## Install dependencies (npm ci if lockfile present)
	@if [ -f package-lock.json ]; then npm ci; else npm install; fi

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf dist

.PHONY: distclean
distclean: clean ## Remove build artifacts and node_modules
	rm -rf node_modules

# ---------------------------------------------------------------------------
# Build / typecheck
# ---------------------------------------------------------------------------

.PHONY: build
build: ## Compile to dist/ (ESM + CJS + .d.ts)
	npm run build

.PHONY: typecheck
typecheck: ## Run tsc --noEmit
	npm run typecheck

# ---------------------------------------------------------------------------
# Format / lint
# ---------------------------------------------------------------------------

.PHONY: format
format: ## Format source and tests with Prettier
	npm run format

.PHONY: format-check
format-check: ## Check formatting (for CI)
	npm run format:check

.PHONY: lint
lint: ## Lint source and tests with ESLint
	npm run lint

.PHONY: lint-fix
lint-fix: ## Auto-fix lint issues and re-format
	npm run lint:fix

# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

.PHONY: test
test: ## Run unit tests
	npm test

.PHONY: test-watch
test-watch: ## Run tests in watch mode
	npm run test:watch

.PHONY: test-integration
test-integration: ## Run integration tests (requires running daemon)
	npm run test:integration

# ---------------------------------------------------------------------------
# Pre-publish verification
# ---------------------------------------------------------------------------

.PHONY: verify
verify: clean install typecheck build test pack-check ## Full pre-publish verification suite
	@echo ""
	@echo "✓ All verification checks passed for $(PKG_NAME)@$(PKG_VERSION)"
	@echo "  Next: make publish-dry  (inspect tarball)"
	@echo "        make publish      (publish to npm)"

.PHONY: pack-check
pack-check: ## Show tarball contents that would be published
	@echo ">>> Tarball contents for $(PKG_NAME)@$(PKG_VERSION):"
	@npm pack --dry-run

.PHONY: publish-check
publish-check: ## Verify npm login and scope access
	@echo ">>> npm user:"
	@npm whoami
	@echo ">>> @mirasoth scope access:"
	@npm access list packages @mirasoth 2>&1 || echo "  (no packages yet, or no access)"

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

.PHONY: publish-dry
publish-dry: build ## Dry-run npm publish (no upload)
	npm publish --dry-run

# OTP can be passed as: make publish OTP=123456
OTP ?=

.PHONY: publish
publish: verify ## Publish to npm (use: make publish OTP=123456 if 2FA enabled)
	@echo ">>> Publishing $(PKG_NAME)@$(PKG_VERSION) to npm..."
	@if [ -n "$(OTP)" ]; then \
		npm publish --otp=$(OTP); \
	else \
		npm publish; \
	fi

.PHONY: version-patch
version-patch: ## Bump patch version (0.1.0 -> 0.1.1) and tag
	npm version patch

.PHONY: version-minor
version-minor: ## Bump minor version (0.1.0 -> 0.2.0) and tag
	npm version minor

.PHONY: version-major
version-major: ## Bump major version (0.1.0 -> 1.0.0) and tag
	npm version major
