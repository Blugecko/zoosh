# SPDX-License-Identifier: Apache-2.0
"""Zoosh: edit a Home Assistant theme in a sidebar panel."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import logging
import os
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import (
    add_extra_js_url,
    async_remove_panel,
    remove_extra_js_url,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.loader import async_get_integration

from . import automation
from . import fileops
from . import images as img
from . import storage
from . import yaml_gen as yg
from .const import (
    DOMAIN,
    FX_FILE,
    BUNDLED_WALLPAPER_DIR,
    BUNDLED_WALLPAPER_URL,
    BUNDLED_WALLPAPERS,
    FX_URL,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_FILE,
    STATIC_URL,
    STORAGE_KEY,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
    THEME_FILE,
    WALLPAPER_DIR,
    WALLPAPER_URL,
)

_LOGGER = logging.getLogger(__name__)


# --------------------------------------------------------------------- schema
def _mode_schema() -> vol.Schema:
    fields: dict[Any, Any] = {}
    for key in yg.MODE_COLORS:
        fields[vol.Required(key)] = vol.All(str, yg.check_hex)
    for key, (lo, hi) in yg.MODE_RANGES.items():
        fields[vol.Required(key)] = yg.check_int_range(lo, hi)
    fields[vol.Required("img")] = vol.All(str, yg.check_image)
    return vol.Schema(fields)  # extra keys rejected by default


def _state_schema() -> vol.Schema:
    fields: dict[Any, Any] = {
        vol.Required("name"): vol.All(str, yg.check_name),
        vol.Required("light"): _mode_schema(),
        vol.Required("dark"): _mode_schema(),
    }
    for key, options in yg.CHOICES.items():
        fields[vol.Required(key)] = yg.check_choice(options)
    for key in yg.BOOLS:
        fields[vol.Required(key)] = yg.check_bool
    for key in yg.GLOBAL_COLORS:
        fields[vol.Required(key)] = vol.All(str, yg.check_hex)
    for key, (lo, hi) in yg.RANGES.items():
        fields[vol.Required(key)] = yg.check_int_range(lo, hi)
    return vol.Schema(fields)


# ------------------------------------------------------------- stored data
class _ZooshStore(Store):
    """Store with a real migration: version 1 (Zoosh 1.0.0) -> version 2 (Looks)."""

    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: Any
    ) -> Any:
        return storage.migrate(old_major_version, old_data)


def _domain_data(hass: HomeAssistant) -> dict[str, Any]:
    return hass.data.setdefault(DOMAIN, {})


def _theme_for(hass: HomeAssistant, look_id: str | None) -> str | None:
    data = _domain_data(hass).get("data")
    if not data or look_id is None:
        return None
    for look in data["looks"]:
        if look["id"] == look_id:
            return yg.theme_name(look["state"]["name"])
    return None


def _system_theme(hass: HomeAssistant) -> str | None:
    """The system default theme name. Reads a Home Assistant internal; None if unknown."""
    value = hass.data.get("frontend_default_theme")
    return value if isinstance(value, str) else None


async def _persist(hass: HomeAssistant) -> None:
    d = _domain_data(hass)
    await d["store"].async_save(d["data"])


def _loaded(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> dict[str, Any] | None:
    d = _domain_data(hass)
    if d.get("store") is None or d.get("data") is None:
        connection.send_error(msg["id"], "not_loaded", "Zoosh is not loaded")
        return None
    return d


async def _known_user_ids(hass: HomeAssistant) -> set[str] | None:
    """Ids of real Home Assistant users, or None when they cannot be listed (never raises)."""
    try:
        users = await hass.auth.async_get_users()
        return {u.id for u in users if getattr(u, "is_active", True) and not getattr(u, "system_generated", False)}
    except Exception as err:  # noqa: BLE001 - an auth API problem must never break Zoosh
        _LOGGER.debug("Could not list Home Assistant users: %s", err)
        return None


async def _restart_automation(hass: HomeAssistant) -> None:
    runtime = _domain_data(hass).get("automation")
    if runtime is not None:
        await runtime.async_start()


# ----------------------------------------------------------------- websocket
@websocket_api.websocket_command({vol.Required("type"): "zoosh/get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_get(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    d = _loaded(hass, connection, msg)
    if d is None:
        return
    files = await hass.async_add_executor_job(
        fileops.list_images, hass.config.path(WALLPAPER_DIR)
    )
    data = d["data"]
    connection.send_result(
        msg["id"],
        {
            "looks": data["looks"],
            "default_id": data["default_id"],
            "starters": yg.starter_looks(),
            "images": files,
            "rev": data.get("rev", 1),
            "upload_limits": {"files": img.MAX_UPLOAD_FILES, "bytes": img.MAX_UPLOAD_TOTAL},
            "bundled": list(BUNDLED_WALLPAPERS),
            "www_served": d.get("www_at_setup", False),
            "version": d.get("version", ""),
            "theme_prefix": yg.THEME_PREFIX,
            "max_looks": yg.MAX_LOOKS,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "zoosh/save_looks",
        vol.Required("looks"): vol.All(
            [{vol.Required("id"): str, vol.Required("state"): _state_schema()}],
            vol.Length(min=1, max=yg.MAX_LOOKS),
        ),
        vol.Required("default_id"): str,
        vol.Required("rev"): vol.All(int, vol.Range(min=1)),
        vol.Optional("apply_default", default=False): bool,
        vol.Optional("apply_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_looks(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    d = _loaded(hass, connection, msg)
    if d is None:
        return
    try:
        looks, default_id = yg.validate_looks(msg["looks"], msg["default_id"])
        text = yg.generate_looks_yaml([x["state"] for x in looks])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return

    runtime = d["automation"]
    notes: list[str] = []
    async with d["lock"]:
        if not storage.rev_matches(d["data"], msg["rev"]):
            connection.send_error(
                msg["id"], "stale",
                "Your Looks were changed somewhere else (another tab or admin). Reload before saving.",
            )
            return
        old_data = copy.deepcopy(d["data"])
        ids = {x["id"] for x in looks}
        # Store first, then the theme file. If the file cannot be written, put the old
        # data back so the Store and the file never disagree.
        d["data"].update(
            looks=looks,
            default_id=default_id,
            automation=storage.prune_automation(d["data"]["automation"], ids),
            rev=old_data.get("rev", 1) + 1,
        )
        await _persist(hass)
        path = hass.config.path(THEME_FILE)
        try:
            backup = await hass.async_add_executor_job(
                fileops.write_theme_file, path, text.encode("utf-8")
            )
        except OSError as err:
            _LOGGER.error("Could not write %s: %s", path, err)  # the path stays in the log only
            d["data"].clear()
            d["data"].update(old_data)
            await _persist(hass)
            connection.send_error(
                msg["id"], "write_failed",
                "Could not write the theme file. See the Home Assistant log for details.",
            )
            return
        if backup:
            _LOGGER.warning("An existing themes/zoosh.yaml not written by Zoosh was backed up as %s", backup)
            notes.append(f"An existing themes/zoosh.yaml was kept as {backup}.")
    try:
        await hass.services.async_call("frontend", "reload_themes", blocking=True)
    except HomeAssistantError as err:
        _LOGGER.warning("reload_themes failed: %s", err)
        notes.append("Theme file saved, but Home Assistant could not reload themes (see the log).")
    else:
        target = msg.get("apply_id") if msg.get("apply_id") in ids else None
        if target is None and msg["apply_default"]:
            target = default_id
        reason = "saved from the panel"
        if target is None:
            # A renamed or deleted Look that is in use must be re-pointed at its new name.
            target = storage.reapply_target(
                old_data["looks"], looks, default_id, runtime.active_id, _system_theme(hass)
            )
            reason = "renamed or deleted Look re-applied"
        if target is not None:
            try:
                await hass.services.async_call(
                    "frontend", "set_theme", {"name": _theme_for(hass, target)}, blocking=True
                )
            except (HomeAssistantError, vol.Invalid) as err:
                _LOGGER.warning("set_theme failed: %s", err)
                notes.append(
                    "Saved, but could not set it as the default theme. Check that "
                    "configuration.yaml has frontend: themes: !include_dir_merge_named themes"
                )
            else:
                runtime.mark_applied(target, reason)
    await _restart_automation(hass)
    connection.send_result(
        msg["id"],
        {
            "ok": True,
            "yaml": text,
            "path": THEME_FILE,
            "warning": " ".join(notes),
            "automation": d["data"]["automation"],
            "rev": d["data"]["rev"],
        },
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "zoosh/apply_look", vol.Required("look_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_apply_look(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    if _loaded(hass, connection, msg) is None:
        return
    name = _theme_for(hass, msg["look_id"])
    if name is None:
        connection.send_error(msg["id"], "not_found", "That Look is not saved yet. Save first.")
        return
    try:
        await hass.services.async_call("frontend", "set_theme", {"name": name}, blocking=True)
    except (HomeAssistantError, vol.Invalid) as err:
        _LOGGER.warning("apply_look failed: %s", err)
        connection.send_error(msg["id"], "apply_failed", "Could not apply the theme. See the Home Assistant log.")
        return
    connection.send_result(msg["id"], {"ok": True, "theme": name})


@websocket_api.websocket_command(
    {vol.Required("type"): "zoosh/export_look", vol.Required("state"): _state_schema()}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_export_look(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    try:
        code = yg.encode_share(msg["state"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    connection.send_result(msg["id"], {"code": code})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "zoosh/import_look",
        vol.Required("code"): vol.All(str, vol.Length(max=yg.MAX_SHARE_LEN)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_look(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    try:
        state = yg.decode_share(msg["code"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    connection.send_result(msg["id"], {"state": state})


# ---- automation
def _auto_payload(hass: HomeAssistant, d: dict[str, Any]) -> dict[str, Any]:
    runtime = d["automation"]
    return {
        "config": d["data"]["automation"],
        "status": runtime.status(),
        "looks": [{"id": x["id"], "name": x["state"]["name"]} for x in d["data"]["looks"]],
        "default_id": d["data"]["default_id"],
    }


@websocket_api.websocket_command({vol.Required("type"): "zoosh/automation_get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_automation_get(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    d = _loaded(hass, connection, msg)
    if d is None:
        return
    connection.send_result(msg["id"], _auto_payload(hass, d))


@websocket_api.websocket_command(
    {vol.Required("type"): "zoosh/automation_save", vol.Required("config"): dict}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_automation_save(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    d = _loaded(hass, connection, msg)
    if d is None:
        return
    known = await _known_user_ids(hass)
    async with d["lock"]:
        # Validate against the Looks as they are right now (same lock as save_looks).
        try:
            cfg = automation.validate_config(msg["config"], {x["id"] for x in d["data"]["looks"]})
        except ValueError as err:
            connection.send_error(msg["id"], "invalid_format", str(err))
            return
        d["data"]["automation"] = storage.prune_people(cfg, known)
        await _persist(hass)
    await _restart_automation(hass)
    connection.send_result(msg["id"], _auto_payload(hass, d))


@websocket_api.websocket_command(
    {vol.Required("type"): "zoosh/automation_pause", vol.Required("paused"): bool}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_automation_pause(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    d = _loaded(hass, connection, msg)
    if d is None:
        return
    async with d["lock"]:
        d["data"]["automation"]["paused"] = msg["paused"]
        await _persist(hass)
    d["automation"].request_eval("pause switch changed", immediate=True)
    d["automation"].record("Paused" if msg["paused"] else "Resumed")
    connection.send_result(msg["id"], _auto_payload(hass, d))


@websocket_api.websocket_command(
    {vol.Required("type"): "zoosh/automation_test", vol.Optional("look_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_automation_test(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    d = _loaded(hass, connection, msg)
    if d is None:
        return
    if "look_id" in msg:
        if not await d["automation"].async_test(msg["look_id"]):
            connection.send_error(msg["id"], "apply_failed", "Could not apply that Look. Is it saved?")
            return
    else:  # no look given: re-evaluate right now, ignoring the debounce
        d["automation"].request_eval("manual re-evaluate", immediate=True)
        await asyncio.sleep(0.3)
    connection.send_result(msg["id"], _auto_payload(hass, d))


@websocket_api.websocket_command({vol.Required("type"): "zoosh/my_look"})
@websocket_api.async_response
async def ws_my_look(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """Any signed-in user: returns only the caller's own Look name, nothing else."""
    d = _domain_data(hass)
    data = d.get("data")
    user = getattr(connection, "user", None)
    if not data or user is None or data["automation"]["paused"]:
        connection.send_result(msg["id"], {"theme": None, "sig": ""})
        return
    look_id = data["automation"]["people"].get(user.id)
    theme = _theme_for(hass, look_id)
    sig = hashlib.sha1(f"{look_id}:{theme}".encode()).hexdigest()[:12] if theme else ""
    connection.send_result(msg["id"], {"theme": theme, "sig": sig})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "zoosh/upload_image",
        vol.Optional("mode"): vol.In(("light", "dark", "both")),  # kept for older panels, unused
        vol.Optional("filename"): vol.All(str, vol.Length(max=255)),  # never stored
        vol.Required("data"): vol.All(str, vol.Length(max=img.MAX_B64_LEN)),
        vol.Required("content_type"): vol.In(tuple(img.ALLOWED_TYPES)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_upload_image(
    hass: HomeAssistant, connection: Any, msg: dict[str, Any]
) -> None:
    data = _loaded(hass, connection, msg)
    if data is None:
        return
    try:
        raw, ext = await hass.async_add_executor_job(
            img.decode_image, msg["data"], msg["content_type"]
        )
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_image", str(err))
        return
    name = img.content_name(raw, ext)
    folder = hass.config.path(WALLPAPER_DIR)
    try:
        async with data["lock"]:
            await hass.async_add_executor_job(fileops.store_upload, folder, name, raw)
    except ValueError as err:  # quota: a plain message without paths
        connection.send_error(msg["id"], "quota_exceeded", str(err))
        return
    except OSError as err:
        _LOGGER.error("Could not write upload %s: %s", name, err)
        connection.send_error(msg["id"], "write_failed", "Could not save the image. See the Home Assistant log.")
        return
    warning = ""
    if not data.get("www_at_setup", False):
        warning = (
            "The www folder did not exist when Home Assistant started, so "
            "/local is not served yet. Restart Home Assistant once for the image to load."
        )
    connection.send_result(
        msg["id"], {"path": f"{WALLPAPER_URL}/{name}", "name": name, "warning": warning}
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "zoosh/delete_upload", vol.Required("name"): vol.All(str, vol.Length(max=64))}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_upload(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    data = _loaded(hass, connection, msg)
    if data is None:
        return
    if not img.is_upload_name(msg["name"]):
        connection.send_error(msg["id"], "invalid_format", "Only wallpapers uploaded through Zoosh can be deleted.")
        return
    try:
        async with data["lock"]:
            deleted = await hass.async_add_executor_job(
                fileops.delete_upload, hass.config.path(WALLPAPER_DIR), msg["name"]
            )
    except ValueError:
        connection.send_error(msg["id"], "invalid_format", "Only wallpapers uploaded through Zoosh can be deleted.")
        return
    except OSError as err:
        _LOGGER.error("Could not delete upload %s: %s", msg["name"], err)
        connection.send_error(msg["id"], "write_failed", "Could not delete the image. See the Home Assistant log.")
        return
    connection.send_result(msg["id"], {"deleted": bool(deleted)})


# --------------------------------------------------------------- entry setup
async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = _domain_data(hass)
    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version)

    data["www_at_setup"] = await hass.async_add_executor_job(
        os.path.isdir, hass.config.path("www")
    )
    data["version"] = version
    data["lock"] = asyncio.Lock()
    data["store"] = _ZooshStore(
        hass, STORAGE_VERSION, STORAGE_KEY, private=True, minor_version=STORAGE_MINOR_VERSION
    )
    loaded, fresh, upgraded = storage.normalise_saved(await data["store"].async_load())
    loaded.pop(storage.UPGRADED_KEY, None)
    known = await _known_user_ids(hass)
    pruned = storage.prune_people(loaded["automation"], known)
    people_changed = pruned["people"] != loaded["automation"]["people"]
    loaded["automation"] = pruned
    data["data"] = loaded
    runtime = automation.ZooshAutomation(
        hass, data["data"], lambda look_id: _theme_for(hass, look_id)
    )
    data["automation"] = runtime

    if not data.get("static_registered"):
        base = Path(__file__).parent
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(STATIC_URL, str(base / STATIC_FILE), False),
                StaticPathConfig(FX_URL, str(base / FX_FILE), False),
                StaticPathConfig(BUNDLED_WALLPAPER_URL, str(base / BUNDLED_WALLPAPER_DIR), False),
            ]
        )
        data["static_registered"] = True

    # The effects script must load for every user (it applies the active theme), not
    # only for admins, so it is an extra module rather than part of the admin panel.
    if not data.get("fx_registered"):
        add_extra_js_url(hass, f"{FX_URL}?v={version}")
        data["fx_url"] = f"{FX_URL}?v={version}"
        data["fx_registered"] = True

    if not data.get("ws_registered"):
        for command in (
            ws_get, ws_save_looks, ws_apply_look, ws_export_look, ws_import_look,
            ws_upload_image, ws_delete_upload, ws_automation_get, ws_automation_save,
            ws_automation_pause, ws_automation_test, ws_my_look,
        ):
            websocket_api.async_register_command(hass, command)
        data["ws_registered"] = True

    if not data.get("panel_registered"):
        try:
            await async_register_panel(
                hass,
                frontend_url_path=PANEL_URL_PATH,
                webcomponent_name=PANEL_COMPONENT,
                sidebar_title=PANEL_TITLE,
                sidebar_icon=PANEL_ICON,
                module_url=f"{STATIC_URL}?v={version}",
                embed_iframe=False,
                require_admin=True,
            )
        except ValueError:
            _LOGGER.debug("Zoosh panel was already registered")
        data["panel_registered"] = True
    if fresh or upgraded:
        await _first_run(hass, data, upgraded)
    elif people_changed:
        await data["store"].async_save(data["data"])
    await runtime.async_start()
    return True


async def _first_run(hass: HomeAssistant, data: dict[str, Any], upgraded: bool) -> None:
    """After a fresh install or a 1.0.0 upgrade: write the theme file and the Store once,
    reload themes and, only if the system theme was the old "Zoosh", switch it to the new
    "Zoosh - Glass". Failures are logged, never raised (setup must not fail on this)."""
    old_system = _system_theme(hass)
    looks = data["data"]["looks"]
    try:
        text = yg.generate_looks_yaml([x["state"] for x in looks])
        backup = await hass.async_add_executor_job(
            fileops.write_theme_file, hass.config.path(THEME_FILE), text.encode("utf-8")
        )
        if backup:
            _LOGGER.warning("An existing themes/zoosh.yaml not written by Zoosh was backed up as %s", backup)
        await data["store"].async_save(data["data"])
    except (OSError, ValueError) as err:
        _LOGGER.warning("Zoosh could not write its first theme file: %s", err)
        return
    try:
        await hass.services.async_call("frontend", "reload_themes", blocking=True)
        if upgraded and old_system == "Zoosh":
            await hass.services.async_call(
                "frontend", "set_theme", {"name": _theme_for(hass, data["data"]["default_id"])},
                blocking=True,
            )
    except (HomeAssistantError, vol.Invalid) as err:
        _LOGGER.warning("Zoosh first-run theme reload failed: %s", err)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = _domain_data(hass)
    if data.get("panel_registered"):
        async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
        data["panel_registered"] = False
    if data.get("fx_registered"):
        remove_extra_js_url(hass, data["fx_url"])
        data["fx_registered"] = False
    runtime = data.pop("automation", None)
    if runtime is not None:
        runtime.async_stop()
    data.pop("store", None)
    data.pop("data", None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Called when the integration is deleted: remove what Zoosh stored. Uploaded
    wallpapers are left alone (they are your files)."""
    store = _ZooshStore(
        hass, STORAGE_VERSION, STORAGE_KEY, private=True, minor_version=STORAGE_MINOR_VERSION
    )
    try:
        await store.async_remove()
    except Exception as err:  # noqa: BLE001 - removal must not fail the delete
        _LOGGER.warning("Could not remove Zoosh's stored data: %s", err)
    try:
        removed = await hass.async_add_executor_job(
            fileops.remove_theme_file, hass.config.path(THEME_FILE)
        )
        if removed:
            _LOGGER.info("Removed themes/zoosh.yaml written by Zoosh")
    except OSError as err:
        _LOGGER.warning("Could not remove themes/zoosh.yaml: %s", err)
    _LOGGER.info(
        "Zoosh removed its settings. Wallpapers you uploaded remain in www/wallpapers; "
        "delete them by hand if you do not want them."
    )
