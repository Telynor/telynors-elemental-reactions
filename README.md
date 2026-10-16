# Telynor's Elemental Reactions

Foundry VTT v14 / dnd5e elemental reaction engine. Requires Midi-QOL and Dice So Nice.

## Elements and reaction builder

GM controls are accessible from the token controls rail:
- **Elemental Directory**: the reaction key. The GM may hide chosen elements from player-visible entries in **GM Element Controls → Player Key**.
- **GM Element Controls**: mass-apply/remove elemental states, character access and infusion, player key visibility.
- **Reaction Automation Builder**: opens the manager to edit all preprogrammed and custom elements, reactions, and variants.

Select **Reaction Builder**, click a reaction to edit or create one, then add **effect steps**. Steps execute top to bottom in listed order and may be reordered. Use the **Sub-bracket / sequence** step to nest an independent ordered list.

Supported builder action types: damage, healing, temporary HP, element application, summon Actor, clear assigned entity, detonate matching entities (with chained detonations), area zone, ability modifier, grant resistance, reduce resistance/immunity by one step, remove reaction effects, Annihilate Light/Dark fusion effects, and nested sequences.

Each damage/healing/effect step can choose the triggering creature, source, assigned entity, or a radius around the target/source/entity. Area targeting can include all creatures, enemies, or allies (based on token disposition relative to the source token).

For **Rimebud**, add a **Spawn assigned Actor** step and drag an Actor from the Actors sidebar/compendium into its Actor field. The token spawns in a random **unoccupied grid position within 5 feet of the target’s edge**, calculated using both token footprints and the scene bounds. If no legal position is available, the summon is skipped with a warning instead of overlapping a creature. Reaction names display once over the original target even when a reaction summons or damages several entities. Name the entity (e.g. `rimebud`), set quantity and lifetime, then optionally add nested actions to **Every initiative 0** and **When summon expires**. The entity reference works in **Clear Entity** and subsequent area actions. Clearing preserves its last position for later actions in the same sequence.

Variants use the same editor. Give a variant a matching pair of elements, a priority, an enabled state, and an optional condition. An eligible higher-priority variant takes precedence over the normal reaction. Unmatched variants never fire.

Elements have editable names, icons, primary/glow colors, description and damage type associations. Their persistent IDs cannot change after creation; Divine keeps special reaction semantics but its appearance is editable. The module applies elements on positive Midi-QOL damage, gated by infusion and approved damage types.

## Built-in automation and limitations

The module includes editable starter stacks for Frostburn, Enkindle, Rimebud, Sunshield, Sunder, Ice Aegis, Blizzard, Spriteshield, Prana, Germinate, Curse, Bless and Annihilate, plus the Wind-pair defaults. Starter configurations never intentionally replace customized reaction effect lists.

This remains an **alpha**. In particular, summoned Actors must be assigned by the GM; not all specialized tabletop edge rules are fully automated (for example, all timing edge cases, Physical weapon absorption and Divine multiplayer choice routing). Midi-QOL handles ordinary combat damage; the module handles reaction composition, tags and actions. Verify complex effects in a test scene before using them in live combat.

## Install/update

Install using the manifest URL:
`https://raw.githubusercontent.com/Telynor/telynors-elemental-reactions/main/module.json`

The GitHub Actions packaging workflow creates a Foundry-ready ZIP with `module.json`, `scripts/`, `styles/` and **`templates/`** at the root, checks JavaScript syntax and runs automation tests. Use Foundry Setup → Add-on Modules → Update to install the latest build.

Report issues with the Foundry, dnd5e, Midi-QOL and Dice So Nice versions plus browser-console errors.
