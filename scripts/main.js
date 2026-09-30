const MODULE_ID = "telynors-elemental-reactions";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);

  game.settings.register(MODULE_ID, "debug", {
    name: "Debug Logging",
    hint: "Enable verbose console logging for Telynor's Elemental Reactions.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", () => {
  const required = ["midi-qol", "dice-so-nice"];
  const missing = required.filter((id) => !game.modules.get(id)?.active);

  if (missing.length) {
    ui.notifications.error(
      `Telynor's Elemental Reactions requires: ${missing.join(", ")}`
    );
    return;
  }

  if (game.settings.get(MODULE_ID, "debug")) {
    console.log(`${MODULE_ID} | Ready`);
  }
});
