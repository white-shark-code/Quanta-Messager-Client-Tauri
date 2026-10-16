VERSION := $(shell node -p "require('./package.json').version")
DIST_DIR := dist
DEPLOY_DIR := deploy/stage
PKG_DIR := dist-pkg
BACKEND_URL ?= http://127.0.0.1:8000
# Privilege escalation for the deps-* targets. Override on systems
# without sudo: `make deps-pacman SUDO=doas`, or run make as root with
# `make deps-pacman SUDO=` (empty). Auto-detects root and drops sudo.
SUDO ?= $(shell if [ "$$(id -u)" = "0" ]; then echo ""; elif command -v sudo >/dev/null 2>&1; then echo "sudo"; elif command -v doas >/dev/null 2>&1; then echo "doas"; else echo "sudo"; fi)

.DEFAULT_GOAL := help

.PHONY: help install check web release-web nginx package tauri aur aur-check deps-apt deps-dnf deps-pacman clean distclean

help: ## Show this help message
	@grep -E '^[a-zA-Z0-9_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies with npm ci
	npm ci

check: ## Run typecheck, lint and tests
	npm run typecheck && npm run lint && npx vitest run

web: ## Build web frontend to dist/
	npm run build

release-web: check web ## Run checks then build web frontend

nginx: web ## Build web and stage dist copy plus rendered nginx conf
	mkdir -p $(DEPLOY_DIR)
	rm -rf $(DEPLOY_DIR)/dist $(DEPLOY_DIR)/quant.conf
	cp -r $(DIST_DIR) $(DEPLOY_DIR)/dist
	sed 's|$${BACKEND_URL}|$(BACKEND_URL)|g' deploy/nginx/quant.conf.template > $(DEPLOY_DIR)/quant.conf
	@echo "Staged web files in $(DEPLOY_DIR)/dist and nginx conf in $(DEPLOY_DIR)/quant.conf (BACKEND_URL=$(BACKEND_URL))"
	@echo "Next steps:"
	@echo "  1. scp -r $(DEPLOY_DIR)/dist/* <server>:/var/www/quant/   # or ship the tarball from 'make package'"
	@echo "  2. scp $(DEPLOY_DIR)/quant.conf <server>:/etc/nginx/conf.d/quant.conf"
	@echo "  3. ssh <server> 'sudo nginx -t && sudo systemctl reload nginx'"

package: nginx ## Build versioned web tarball with dist/ + quant.conf
	mkdir -p $(PKG_DIR)
	tar -czf $(PKG_DIR)/quant-web-$(VERSION).tar.gz -C $(DEPLOY_DIR) dist quant.conf
	@echo "Created $(PKG_DIR)/quant-web-$(VERSION).tar.gz"
	@echo "Next steps:"
	@echo "  1. scp $(PKG_DIR)/quant-web-$(VERSION).tar.gz <server>:/tmp/"
	@echo "  2. ssh <server> 'mkdir -p /tmp/quant-web && tar -xzf /tmp/quant-web-$(VERSION).tar.gz -C /tmp/quant-web && sudo cp -r /tmp/quant-web/dist/* /var/www/quant/ && sudo cp /tmp/quant-web/quant.conf /etc/nginx/conf.d/quant.conf && sudo nginx -t && sudo systemctl reload nginx'"

tauri: ## Build Tauri desktop app
	npm run build:tauri

aur: ## Build Arch package from deploy/arch/PKGBUILD
	mkdir -p $(PKG_DIR)
	cd deploy/arch && makepkg --printsrcinfo > .SRCINFO
	cd deploy/arch && makepkg -s --noconfirm
	cp deploy/arch/*.pkg.tar.zst $(PKG_DIR)/
	@echo "Copied Arch package(s) to $(PKG_DIR)/"

aur-check: ## Validate PKGBUILD with namcap (best-effort)
	@command -v namcap >/dev/null 2>&1 || { echo "warning: namcap not found, skipping aur-check" >&2; exit 0; }
	namcap deploy/arch/PKGBUILD

deps-apt: ## Install Tauri build deps on Debian/Ubuntu (apt)
	@echo "Installing Tauri build dependencies (apt)..."
	$(SUDO) apt-get update
	$(SUDO) apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

deps-dnf: ## Install Tauri build deps on Fedora (dnf)
	@echo "Installing Tauri build dependencies (dnf)..."
	$(SUDO) dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file libxdo-devel libayatana-appindicator-gtk3-devel librsvg2-devel
	@echo "Note: install Rust via rustup (https://rustup.rs) if not already installed."

deps-pacman: ## Install Tauri build deps on Arch Linux (pacman)
	@echo "Installing Tauri build dependencies (pacman)..."
	$(SUDO) pacman -Sy
	$(SUDO) pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl libayatana-appindicator librsvg nodejs npm rust
	@echo "Trying optional libxdo (missing on some Artix repos, non-fatal)..."
	-$(SUDO) pacman -S --needed libxdo

clean: ## Remove build, stage and packaging artifacts
	rm -rf $(DIST_DIR) $(DEPLOY_DIR) $(PKG_DIR)
	rm -f deploy/arch/*.pkg.tar.zst
	rm -rf deploy/arch/src deploy/arch/pkg

distclean: ## Remove ALL build garbage (incl. node_modules and Rust target)
	rm -rf $(DIST_DIR) $(DEPLOY_DIR) $(PKG_DIR)
	rm -f deploy/arch/*.pkg.tar.zst
	rm -rf deploy/arch/src deploy/arch/pkg
	rm -rf node_modules
	rm -rf src-tauri/target
	rm -rf coverage .vitest-exports
	rm -f tsconfig.tsbuildinfo src/tsconfig.tsbuildinfo
	@echo "Full purge done. Run 'make install' to fetch dependencies again."
