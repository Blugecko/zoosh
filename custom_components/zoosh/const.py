# SPDX-License-Identifier: Apache-2.0
"""Constants for Zoosh."""

DOMAIN = "zoosh"

PANEL_URL_PATH = "zoosh"
PANEL_COMPONENT = "zoosh-panel"
PANEL_TITLE = "Zoosh"
PANEL_ICON = "mdi:palette-swatch"

STATIC_URL = "/zoosh_static/zoosh-panel.js"
STATIC_FILE = "frontend/zoosh-panel.js"
FX_URL = "/zoosh_static/zoosh-fx.js"
FX_FILE = "frontend/zoosh-fx.js"
# The two wallpapers that ship with Zoosh (folder served read-only).
BUNDLED_WALLPAPER_URL = "/zoosh_static/wallpapers"
BUNDLED_WALLPAPER_DIR = "wallpapers"
BUNDLED_WALLPAPERS = ("zoosh-light.jpg", "zoosh-dark.jpg")

THEME_FILE = "themes/zoosh.yaml"
WALLPAPER_DIR = "www/wallpapers"
WALLPAPER_URL = "/local/wallpapers"

STORAGE_KEY = "zoosh"
STORAGE_VERSION = 2
STORAGE_MINOR_VERSION = 1
