# SPDX-License-Identifier: Apache-2.0
"""Config flow for Zoosh: one click, no options."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class ZooshConfigFlow(ConfigFlow, domain=DOMAIN):
    """Single-step flow; single_config_entry in the manifest blocks duplicates."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="Zoosh", data={})
        return self.async_show_form(step_id="user")
